/**
 * Plan schema v1 (build plan §5). Money in the plan file is nominal USD **cents** (integers).
 * The engine converts to float dollars when it compiles a plan and rounds only at display/export.
 * The JSON Schema in schema/plan.v1.json is emitted from these Zod types (scripts/emit-schema.ts).
 */
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

const cents = z.number().int();
const id = z.string().min(1);
const rate = z.number().min(-1).max(10);

export const ASSET_CLASSES = ['usStocks', 'usBonds', 'cash', 'intlStocks', 'reits'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const FilingStatusZ = z.enum(['single', 'mfj', 'mfs', 'hoh', 'qss']);

/** A point in time: a calendar year, a person's age, or a milestone (plus an offset in years). */
export const YearRefZ = z.discriminatedUnion('type', [
  z.object({ type: z.literal('year'), year: z.number().int() }),
  z.object({ type: z.literal('age'), personId: id, age: z.number().int().min(0).max(130) }),
  z.object({ type: z.literal('milestone'), milestoneId: id, offset: z.number().int().default(0) }),
]);
export type YearRef = z.infer<typeof YearRefZ>;

/** Growth rate, either real (on top of the relevant inflation index) or nominal. */
export const GrowthZ = z.object({ rate, basis: z.enum(['real', 'nominal']).default('real') });

export const AllocationZ = z.object({
  usStocks: z.number().min(0).max(1).default(0),
  usBonds: z.number().min(0).max(1).default(0),
  cash: z.number().min(0).max(1).default(0),
  intlStocks: z.number().min(0).max(1).default(0),
  reits: z.number().min(0).max(1).default(0),
});
export type Allocation = z.infer<typeof AllocationZ>;

export const PersonZ = z.object({
  id,
  name: z.string(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(['male', 'female']).optional(),
  longevity: z
    .object({
      mode: z.enum(['fixed', 'stochastic']).default('fixed'),
      age: z.number().int().min(50).max(120).default(95),
    })
    .default({}),
  /** State residence over time (PLAN-01). */
  residence: z
    .array(
      z.object({
        state: z.string().length(2),
        countyFips: z.string().optional(),
        fromYear: z.number().int(),
      }),
    )
    .default([]),
  socialSecurity: z
    .object({
      /** 'earnings' = compute PIA from the earnings record; 'pia' = user-entered PIA; 'none'. */
      mode: z.enum(['earnings', 'pia', 'none']).default('earnings'),
      earnings: z.array(z.object({ year: z.number().int(), amount: cents })).default([]),
      /** Monthly PIA in today's dollars when mode = 'pia'. */
      piaMonthly: cents.default(0),
      claimAge: z
        .object({ years: z.number().int().min(62).max(70), months: z.number().int().min(0).max(11) })
        .default({ years: 67, months: 0 }),
    })
    .default({}),
});
export type Person = z.infer<typeof PersonZ>;

export const ACCOUNT_TYPES = [
  'taxable',
  'cash',
  'trad401k',
  'trad403b',
  'gov457b',
  'tradIra',
  'sepIra',
  'simpleIra',
  'solo401k',
  'roth401k',
  'rothIra',
  'hsa',
  'plan529',
  'inheritedIra',
  'iBond',
  'tBill',
  'annuity',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const AccountZ = z.object({
  id,
  ownerId: id,
  name: z.string(),
  type: z.enum(ACCOUNT_TYPES),
  balance: cents,
  /** Taxable / annuity / I-bond cost basis. */
  costBasis: cents.optional(),
  /** Roth basis: direct contributions plus each conversion lot with its year (PLAN-12 five-year rules). */
  rothBasis: z
    .object({
      contributions: cents.default(0),
      conversions: z.array(z.object({ year: z.number().int(), amount: cents })).default([]),
      firstContributionYear: z.number().int().optional(),
    })
    .optional(),
  allocation: AllocationZ.default({ usStocks: 0.6, usBonds: 0.4 }),
  glidePathId: id.optional(),
  fees: z.object({ expenseRatio: rate.default(0), advisory: rate.default(0) }).default({}),
  /** Payroll-level contributions (step 4 of the annual order of operations). */
  contribution: z
    .object({
      incomeId: id.optional(),
      /** Employee deferral as a fraction of the linked income, or a flat annual amount (today's dollars). 'max' = the legal limit. */
      employeePct: z.number().min(0).max(1).default(0),
      employeeAmount: cents.default(0),
      maxOut: z.boolean().default(false),
      /** Employer match tiers: match `matchPct` of deferrals up to `upToPctOfSalary`. */
      employerMatch: z
        .array(z.object({ matchPct: z.number().min(0), upToPctOfSalary: z.number().min(0).max(1) }))
        .default([]),
      /** Non-elective employer contribution as a fraction of salary. */
      employerFixedPct: z.number().min(0).max(1).default(0),
      /** Mega-backdoor: after-tax contributions up to the 415(c) limit, converted in-plan to Roth (PLAN-13). */
      megaBackdoor: z.boolean().default(false),
      megaBackdoorRothAccountId: id.optional(),
    })
    .optional(),
  /** 401(k)/403(b) from the employer the owner separates from at 55+ (Rule of 55). */
  ruleOf55: z.boolean().default(false),
  inherited: z
    .object({ yearOfDeath: z.number().int(), decedentHadStartedRmds: z.boolean().default(false) })
    .optional(),
  /** Fixed nominal yield for cash-like instruments (cash/HYSA override, T-bills, I-bond fixed rate is real). */
  fixedYield: GrowthZ.optional(),
  /** 529: beneficiary dependent and the year the account was opened (529-to-Roth needs 15 years). */
  plan529: z
    .object({
      openedYear: z.number().int(),
      rothRolloverAccountId: id.optional(),
      rollToRoth: z.boolean().default(false),
    })
    .optional(),
});
export type Account = z.infer<typeof AccountZ>;

export const AssetZ = z.object({
  id,
  ownerId: id,
  name: z.string(),
  kind: z.enum(['primaryHome', 'rental', 'vehicle', 'other']),
  value: cents,
  costBasis: cents.optional(),
  /** Appreciation (negative for vehicle depreciation). */
  appreciation: GrowthZ.default({ rate: 0 }),
  property: z
    .object({
      propertyTaxRate: rate.default(0.011),
      insuranceAnnual: cents.default(0),
      maintenanceRate: rate.default(0.01),
      hoaAnnual: cents.default(0),
    })
    .optional(),
  /** Future purchase. If absent the asset is owned at plan start. */
  purchase: z
    .object({
      when: YearRefZ,
      downPaymentPct: z.number().min(0).max(1).default(0.2),
      closingCostPct: z.number().min(0).max(0.2).default(0.03),
      mortgageRate: rate.default(0.065),
      mortgageTermYears: z.number().int().min(1).max(40).default(30),
    })
    .optional(),
  sale: z
    .object({
      when: YearRefZ,
      sellingCostPct: z.number().min(0).max(0.2).default(0.06),
      proceedsToAccountId: id.optional(),
    })
    .optional(),
});
export type Asset = z.infer<typeof AssetZ>;

export const DebtZ = z.object({
  id,
  ownerId: id,
  name: z.string(),
  kind: z.enum(['mortgage', 'auto', 'student', 'personal', 'revolving', 'other']),
  principal: cents,
  rate,
  /** Monthly payment. If 0, computed from `termMonths`. Revolving debt pays interest plus `revolvingPayPct` of principal. */
  payment: cents.default(0),
  termMonths: z.number().int().min(0).default(0),
  revolvingPayPct: z.number().min(0).max(1).default(0.02),
  linkedAssetId: id.optional(),
  /** Interest counts as an itemized deduction. When absent, home mortgages are deductible and other debts are not. */
  interestDeductible: z.boolean().optional(),
  start: YearRefZ.optional(),
  refinance: z
    .array(
      z.object({
        when: YearRefZ,
        rate,
        termYears: z.number().int().min(1).max(40),
        costPct: z.number().min(0).max(0.1).default(0.02),
      }),
    )
    .default([]),
});
export type Debt = z.infer<typeof DebtZ>;

export const IncomeZ = z.object({
  id,
  ownerId: id,
  name: z.string(),
  kind: z.enum(['wages', 'bonus', 'selfEmployment', 'rental', 'pension', 'annuity', 'other']),
  /**
   * Annual amount in today's (plan-start) dollars, grown by `growth` from the plan start. Pensions differ: the amount
   * is the annual benefit in its first year of payment. With a nominal COLA it is that year's nominal amount; with a
   * real COLA it is in today's dollars and is carried to the start year by inflation. The COLA compounds from the
   * year the pension starts.
   */
  amount: cents,
  growth: GrowthZ.default({ rate: 0 }),
  start: YearRefZ.optional(),
  end: YearRefZ.optional(),
  taxCharacter: z
    .enum(['earned', 'selfEmployment', 'ordinary', 'qualifiedDividend', 'capitalGain', 'taxFree'])
    .default('earned'),
  pension: z
    .object({
      cola: GrowthZ.default({ rate: 0, basis: 'nominal' }),
      survivorPct: z.number().min(0).max(1).default(0.5),
    })
    .optional(),
  /** Fraction of each annuity payment that is return of basis (not taxed). */
  annuityExclusionRatio: z.number().min(0).max(1).default(0),
  linkedAssetId: id.optional(),
});
export type Income = z.infer<typeof IncomeZ>;

export const ExpenseZ = z.object({
  id,
  name: z.string(),
  category: z.enum([
    'housing',
    'food',
    'transport',
    'travel',
    'healthcare',
    'education',
    'childcare',
    'insurance',
    'giving',
    'discretionary',
    'other',
  ]),
  /** Annual amount (or the one-time amount) in today's dollars. */
  amount: cents,
  inflationIndex: z.enum(['cpi', 'healthcare', 'education', 'custom', 'none']).default('cpi'),
  customRate: rate.default(0),
  essential: z.boolean().default(true),
  /** If true, the go-go / slow-go / no-go phase multipliers apply. */
  followsPhases: z.boolean().default(false),
  recurrence: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('annual') }),
      z.object({ type: z.literal('once') }),
      z.object({ type: z.literal('interval'), everyYears: z.number().int().min(1) }),
    ])
    .default({ type: 'annual' }),
  start: YearRefZ.optional(),
  end: YearRefZ.optional(),
});
export type Expense = z.infer<typeof ExpenseZ>;

export const MilestoneEffectZ = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), target: z.enum(['income', 'expense']), targetId: id }),
  z.object({ type: z.literal('stop'), target: z.enum(['income', 'expense', 'contribution']), targetId: id }),
  z.object({
    type: z.literal('setAmount'),
    target: z.enum(['income', 'expense']),
    targetId: id,
    amount: cents,
  }),
  z.object({
    type: z.literal('scaleAmount'),
    target: z.enum(['income', 'expense']),
    targetId: id,
    factor: z.number().min(0),
  }),
  z.object({
    type: z.literal('windfall'),
    accountId: id,
    amount: cents,
    taxable: z.boolean().default(false),
  }),
  z.object({ type: z.literal('relocate'), state: z.string().length(2), countyFips: z.string().optional() }),
  z.object({ type: z.literal('filingStatus'), status: FilingStatusZ }),
]);
export type MilestoneEffect = z.infer<typeof MilestoneEffectZ>;

export const MilestoneZ = z.object({
  id,
  name: z.string(),
  kind: z.enum([
    'retirement',
    'homePurchase',
    'child',
    'college',
    'relocation',
    'careerChange',
    'sabbatical',
    'windfall',
    'fi',
    'custom',
  ]),
  personId: id.optional(),
  when: z.discriminatedUnion('type', [
    z.object({ type: z.literal('year'), year: z.number().int() }),
    z.object({ type: z.literal('age'), personId: id, age: z.number().int() }),
    /** Fires the first year the condition holds at the start of the year. `fi`: investable assets >= fiMultiple x annual spending. */
    z.object({
      type: z.literal('condition'),
      metric: z.enum(['netWorth', 'investable', 'fi']),
      value: cents.default(0),
      fiMultiple: z.number().default(25),
    }),
  ]),
  effects: z.array(MilestoneEffectZ).default([]),
});
export type Milestone = z.infer<typeof MilestoneZ>;

export const WaterfallStepZ = z.discriminatedUnion('type', [
  /** Fill a cash account to N months of spending. */
  z.object({ type: z.literal('emergencyFund'), accountId: id, months: z.number().min(0).default(6) }),
  /** Contribute to an account up to its legal limit (or `maxAnnual` if set, today's dollars). */
  z.object({ type: z.literal('account'), accountId: id, maxAnnual: cents.optional() }),
  /** Extra principal on a debt. */
  z.object({ type: z.literal('debt'), debtId: id, maxAnnual: cents.optional() }),
]);
export type WaterfallStep = z.infer<typeof WaterfallStepZ>;

export const StrategiesZ = z.object({
  surplusWaterfall: z.array(WaterfallStepZ).default([]),
  /** Where leftover surplus goes when the waterfall is exhausted. */
  surplusDefaultAccountId: id.optional(),
  withdrawalOrder: z
    .object({
      strategy: z.enum(['taxableFirst', 'proportional', 'bracketTargeted', 'custom']).default('taxableFirst'),
      customOrder: z.array(id).default([]),
      /** bracketTargeted: fill ordinary income up to the top of this bracket with pre-tax withdrawals first. */
      bracketRate: z.number().default(0.12),
    })
    .default({}),
  rothConversion: z
    .object({
      mode: z.enum(['none', 'fixed', 'fillBracket', 'magiTarget', 'ladder']).default('none'),
      /** fixed / ladder: annual amount in today's dollars. */
      amount: cents.default(0),
      bracketRate: z.number().default(0.12),
      start: YearRefZ.optional(),
      end: YearRefZ.optional(),
      targetAccountId: id.optional(),
    })
    .default({}),
  gainHarvest: z.object({ enabled: z.boolean().default(false) }).default({}),
  lossHarvest: z.object({ enabled: z.boolean().default(false) }).default({}),
  spendingRule: z
    .object({
      type: z.enum(['fixed', 'guardrails', 'percentOfPortfolio', 'floorCeiling']).default('fixed'),
      /** percentOfPortfolio / floorCeiling: fraction of the portfolio spent each year. */
      pct: z.number().min(0).max(1).default(0.04),
      /** Guyton-Klinger: guardrails at initialRate x (1 +/- band); spending cut/raised by `adjust`. */
      guardrailBand: z.number().min(0).max(1).default(0.2),
      guardrailAdjust: z.number().min(0).max(1).default(0.1),
      /** floor / ceiling as multiples of planned (inflation-adjusted) spending. */
      floor: z.number().min(0).max(1).default(0.85),
      ceiling: z.number().min(1).max(5).default(1.25),
      /** Rules start at this point (default: first retirement milestone). */
      start: YearRefZ.optional(),
    })
    .default({}),
  /** STRAT-02: keep MAGI within an FPL band while on ACA coverage. */
  magiTarget: z
    .object({
      enabled: z.boolean().default(false),
      maxFplPct: z.number().default(3.99),
      /** Keep MAGI above this multiple to stay out of Medicaid / the coverage gap (0 = off). */
      minFplPct: z.number().default(0),
    })
    .default({}),
  rebalance: z
    .object({
      mode: z.enum(['none', 'annual', 'threshold']).default('annual'),
      band: z.number().min(0).max(1).default(0.05),
    })
    .default({}),
  /** 72(t) SEPP schedules (fixed amortization). */
  sepp: z.array(z.object({ accountId: id, start: YearRefZ, interestRate: rate.default(0.05) })).default([]),
  spendingPhases: z
    .array(z.object({ name: z.string(), fromAge: z.number().int(), multiplier: z.number().min(0).max(3) }))
    .default([]),
  /** Spending multiplier after the first death in a couple. */
  survivorSpendingPct: z.number().min(0).max(1.5).default(1),
  backdoorRoth: z.boolean().default(false),
  /** HSA: 'spend' pays medical out-of-pocket from the HSA; 'save' leaves it invested. */
  hsaUse: z.enum(['spend', 'save']).default('spend'),
  /** STRAT-03: marginal rate heirs are assumed to pay on inherited pre-tax accounts. */
  estate: z.object({ heirMarginalRate: z.number().min(0).max(1).default(0.24) }).default({}),
});
export type Strategies = z.infer<typeof StrategiesZ>;

export const CoverageZ = z.object({
  type: z.enum(['employer', 'spouseEmployer', 'cobra', 'aca', 'medicaid', 'medicare', 'none']),
  from: YearRefZ,
  /** employer: employee share of the annual premium (today's dollars). cobra: full annual premium before the 2% fee. */
  premiumAnnual: cents.optional(),
  hdhp: z.boolean().default(false),
  metal: z.enum(['catastrophic', 'bronze', 'silver', 'gold', 'platinum']).default('silver'),
  cobraMonths: z.number().int().min(1).max(36).default(18),
});
export type Coverage = z.infer<typeof CoverageZ>;

export const HealthcareZ = z.object({
  enabled: z.boolean().default(true),
  people: z
    .array(
      z.object({
        personId: id,
        coverage: z.array(CoverageZ).default([]),
        utilization: z.enum(['low', 'typical', 'high']).default('typical'),
        tobacco: z.boolean().default(false),
        medicare: z
          .object({
            partAPremiumFree: z.boolean().default(true),
            supplement: z.enum(['medigapG', 'medigapN', 'advantage', 'none']).default('medigapG'),
            dentalVisionHearing: z.boolean().default(true),
            /** Life-changing-event appeal: use current-year MAGI for IRMAA in the first two Medicare years. */
            irmaaAppeal: z.boolean().default(false),
          })
          .default({}),
        ltc: z
          .object({
            mode: z.enum(['none', 'expected', 'stochastic']).default('none'),
            careType: z
              .enum(['homeCare', 'assistedLiving', 'nursingHomeSemiPrivate', 'nursingHomePrivate'])
              .default('assistedLiving'),
            onsetAge: z.number().int().default(85),
            years: z.number().min(0).max(20).default(3),
            insurance: z
              .object({
                premiumAnnual: cents.default(0),
                annualBenefit: cents.default(0),
                benefitYears: z.number().default(3),
              })
              .optional(),
          })
          .default({}),
      }),
    )
    .default([]),
  /** User-entered monthly SLCSP for a 21-year-old (state-based-exchange states or to override; flagged in results). */
  slcspOverrideAge21Monthly: cents.optional(),
  /**
   * IRMAA lookback for the first two plan years: modified AGI from two years and one year before the plan start
   * (nominal cents). When absent, the plan's own first-year MAGI estimate is used.
   */
  irmaaPriorMagi: z.object({ twoYearsBefore: cents.optional(), oneYearBefore: cents.optional() }).optional(),
});
export type Healthcare = z.infer<typeof HealthcareZ>;

export const AssumptionsZ = z.object({
  returns: z
    .object({
      /** Deterministic projection return model. */
      mode: z.enum(['fixed', 'historicalAverage']).default('fixed'),
      /** Expected returns per asset class: GEOMETRIC (compound) nominal annual rates at the plan's inflation rate. */
      fixed: z
        .object({
          usStocks: rate.default(0.07),
          usBonds: rate.default(0.04),
          cash: rate.default(0.03),
          intlStocks: rate.default(0.07),
          reits: rate.default(0.065),
        })
        .default({}),
      /** Optional user-defined volatility / correlation for parametric Monte Carlo (SIM-05). */
      stdDev: z.record(z.number()).optional(),
      correlation: z.array(z.array(z.number())).optional(),
    })
    .default({}),
  inflation: z.object({ rate: rate.default(0.025), educationExcess: rate.default(0.02) }).default({}),
  healthcareInflation: z
    .object({
      excessOverCpi: rate.default(0.02),
      stochastic: z.boolean().default(true),
      stdDev: rate.default(0.015),
    })
    .default({}),
  /** Real wage growth used to index future Social Security bend points / AWI. */
  realWageGrowth: rate.default(0.01),
  dividendYield: rate.default(0.018),
  qualifiedDividendPct: z.number().min(0).max(1).default(0.9),
  bondYield: rate.default(0.04),
  monteCarlo: z
    .object({
      method: z.enum(['bootstrap', 'parametric']).default('bootstrap'),
      runs: z.number().int().min(10).max(10000).default(1000),
      seed: z.number().int().default(20261110),
      blockLength: z.number().int().min(1).max(30).default(5),
      /** Forward runs: 'fixed' inflation or historically 'sampled' with the returns (SIM-07). */
      inflation: z.enum(['fixed', 'sampled']).default('sampled'),
      stochasticLongevity: z.boolean().default(false),
      /**
       * Bootstrap only: 'assumptions' re-centres history on the expected returns and inflation above (keeping its
       * volatility, correlation and sequence); 'historical' replays raw history with its own averages.
       */
      bootstrapMeans: z.enum(['assumptions', 'historical']).default('assumptions'),
    })
    .default({}),
  /**
   * Annual improvement in death rates after the life table's year (cohort adjustment for stochastic longevity).
   * 0 uses the SSA period table as published; about 0.008 is close to the Trustees' intermediate assumption.
   */
  mortalityImprovement: z.number().min(0).max(0.03).default(0),
  /** PLAN-06: optional trust-fund-shortfall scenario. */
  socialSecurityCut: z
    .object({
      enabled: z.boolean().default(false),
      /** Defaults follow the bundled 2026 Trustees Report (combined OASDI: reserves depleted 2034, 83% payable). */
      fromYear: z.number().int().default(2034),
      payablePct: z.number().min(0).max(1).default(0.83),
    })
    .default({}),
});
export type Assumptions = z.infer<typeof AssumptionsZ>;

export const GlidePathZ = z.object({
  id,
  name: z.string(),
  /** Allocation targets by owner age, linearly interpolated. */
  points: z.array(z.object({ age: z.number().int(), allocation: AllocationZ })).min(1),
});

/** A scenario/variant is a named set of overrides applied to the base plan (RPT-02). */
export const ScenarioZ = z.object({
  id,
  name: z.string(),
  patches: z
    .array(z.object({ path: z.array(z.union([z.string(), z.number()])), value: z.unknown() }))
    .default([]),
});
export type Scenario = z.infer<typeof ScenarioZ>;

export const ActualZ = z.object({ date: z.string(), balances: z.record(cents) });

export const PlanZ = z.object({
  id,
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.object({
    startYear: z.number().int(),
    /** start / mid / end of year cash-flow timing (§6.4). */
    timing: z.enum(['start', 'mid', 'end']).default('mid'),
    display: z.enum(['real', 'nominal']).default('real'),
    dataYearPolicy: z.enum(['latest']).default('latest'),
  }),
  people: z.array(PersonZ).min(1).max(2),
  household: z
    .object({
      filingStatus: z.array(z.object({ fromYear: z.number().int(), status: FilingStatusZ })).default([]),
      dependents: z.array(z.object({ name: z.string(), birthYear: z.number().int() })).default([]),
    })
    .default({}),
  accounts: z.array(AccountZ).default([]),
  assets: z.array(AssetZ).default([]),
  debts: z.array(DebtZ).default([]),
  incomes: z.array(IncomeZ).default([]),
  expenses: z.array(ExpenseZ).default([]),
  milestones: z.array(MilestoneZ).default([]),
  glidePaths: z.array(GlidePathZ).default([]),
  strategies: StrategiesZ.default({}),
  healthcare: HealthcareZ.default({}),
  assumptions: AssumptionsZ.default({}),
  scenarios: z.array(ScenarioZ).default([]),
  actuals: z.array(ActualZ).default([]),
});
export type Plan = z.infer<typeof PlanZ>;
export type PlanInput = z.input<typeof PlanZ>;

/** Parse (and default-fill) a plan object that is already at the current schema version. */
export function parsePlan(raw: unknown): Plan {
  return PlanZ.parse(raw);
}

/** Apply a scenario's overrides to a plan and return the patched, re-validated plan. */
export function applyScenario(plan: Plan, scenarioId: string | null | undefined): Plan {
  if (!scenarioId) return plan;
  const sc = plan.scenarios.find((s) => s.id === scenarioId);
  if (!sc) return plan;
  const copy = structuredClone(plan) as unknown as Record<string | number, unknown>;
  for (const p of sc.patches) {
    let node: Record<string | number, unknown> = copy;
    for (let i = 0; i < p.path.length - 1; i++) {
      const next = node[p.path[i]];
      if (next === null || typeof next !== 'object') {
        node = null as never;
        break;
      }
      node = next as Record<string | number, unknown>;
    }
    if (node) node[p.path[p.path.length - 1]] = structuredClone(p.value);
  }
  return PlanZ.parse(copy);
}
