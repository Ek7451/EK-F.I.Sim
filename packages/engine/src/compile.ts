/**
 * Compiles a validated Plan (cents, references by id) into the flat, dollar-denominated structure
 * the projection loop runs on. Nothing here depends on a particular return path.
 */
import type { Account, AccountType, Allocation, Coverage, Plan, YearRef } from './schema';
import { ASSET_CLASSES } from './schema';
import type { EngineData } from './data';
import { applyColas, claimFactor, computePia, fraMonths, awiFor } from './social-security';
// Circular by design: the M1 pre-pass runs one deterministic projection. Only used inside compilePlan at call time.

export const NC = ASSET_CLASSES.length;
export const enum Kind {
  Taxable,
  Cash,
  Pretax,
  Roth,
  Hsa,
  Edu,
  Deferred,
}

const KIND_OF: Record<AccountType, Kind> = {
  taxable: Kind.Taxable,
  cash: Kind.Cash,
  tBill: Kind.Cash,
  trad401k: Kind.Pretax,
  trad403b: Kind.Pretax,
  gov457b: Kind.Pretax,
  tradIra: Kind.Pretax,
  sepIra: Kind.Pretax,
  simpleIra: Kind.Pretax,
  solo401k: Kind.Pretax,
  inheritedIra: Kind.Pretax,
  roth401k: Kind.Roth,
  rothIra: Kind.Roth,
  hsa: Kind.Hsa,
  plan529: Kind.Edu,
  iBond: Kind.Deferred,
  annuity: Kind.Deferred,
};

export interface CAccount {
  id: string;
  name: string;
  type: AccountType;
  kind: Kind;
  /** Owner person index (joint accounts use person 0 for age rules). */
  owner: number;
  joint: boolean;
  balance: number;
  basis: number;
  rothContrib: number;
  rothLots: { year: number; amount: number }[];
  rothFirstYear: number;
  weights: number[];
  glide: { age: number; w: number[] }[] | null;
  fee: number;
  fixedYield: { rate: number; real: boolean } | null;
  src: Account;
  /** Synthetic accounts are created by the compiler (sweep account, conversion target). */
  synthetic: boolean;
}

export interface CPerson {
  id: string;
  name: string;
  birthYear: number;
  birthMonth: number;
  sex: 'male' | 'female';
  deathAge: number;
  stochasticLongevity: boolean;
  /** Year the person reaches 59 1/2. */
  year59Half: number;
  /** Annual Social Security benefit at claim, in plan-start dollars (0 if none). */
  ssAnnualToday: number;
  /** PIA (annual, plan-start dollars) before the claiming adjustment. */
  ssPiaAnnualToday: number;
  ssClaimYear: number;
  /** Fraction of the claim year in which benefits are paid. */
  ssFirstYearFraction: number;
  ssClaimMonths: number;
  ssFraMonths: number;
  /** Full retirement age for survivor benefits (the retirement FRA table shifted two birth years). */
  ssSurvivorFraMonths: number;
  /** Age in months when a spousal benefit can start: the later of this person's and the spouse's filing. */
  ssSpousalStartMonths: number;
  ssEstimated: boolean;
  rmdStartAge: number;
}

export interface Compiled {
  plan: Plan;
  data: EngineData;
  startYear: number;
  /** Longest possible horizon in years (to the latest fixed death age, or 110 when longevity is stochastic). */
  maxYears: number;
  people: CPerson[];
  accounts: CAccount[];
  accountIndex: Map<string, number>;
  incomeIndex: Map<string, number>;
  expenseIndex: Map<string, number>;
  milestoneIndex: Map<string, number>;
  /** Static firing year per milestone (NaN for condition milestones, resolved while running). */
  milestoneYear: number[];
  sweepAccount: number;
  conversionTarget: number[];
  /** Flow exponent for the timing convention: 1 = start, 0.5 = mid, 0 = end of year. */
  flowExponent: number;
  warnings: string[];
}

const dollars = (c: number | undefined): number => (c ?? 0) / 100;

export function weightsOf(a: Allocation): number[] {
  const w = ASSET_CLASSES.map((c) => a[c] ?? 0);
  const sum = w.reduce((x, y) => x + y, 0);
  if (sum <= 0) return [0, 0, 1, 0, 0];
  return w.map((x) => x / sum);
}

/** Resolve a YearRef to a calendar year using only static information; NaN if it depends on a condition milestone. */
export function staticYear(
  plan: Plan,
  ref: YearRef | undefined,
  fallback: number,
  milestoneYear?: number[],
  msIndex?: Map<string, number>,
): number {
  if (!ref) return fallback;
  if (ref.type === 'year') return ref.year;
  if (ref.type === 'age') {
    const p = plan.people.find((x) => x.id === ref.personId) ?? plan.people[0];
    return +p.birthDate.slice(0, 4) + ref.age;
  }
  if (milestoneYear && msIndex) {
    const i = msIndex.get(ref.milestoneId);
    if (i === undefined) return fallback;
    return milestoneYear[i] + ref.offset;
  }
  const m = plan.milestones.find((x) => x.id === ref.milestoneId);
  if (!m) return fallback;
  if (m.when.type === 'year') return m.when.year + ref.offset;
  if (m.when.type === 'age') {
    const w = m.when;
    const p = plan.people.find((x) => x.id === w.personId) ?? plan.people[0];
    return +p.birthDate.slice(0, 4) + w.age + ref.offset;
  }
  return NaN;
}

/**
 * Share of the year that has passed when a date tied to someone's age arrives: the birthday month and day in the
 * year they reach that age. Pay that ends at a retirement age is earned for this part of that year. Dates not tied
 * to an age (a calendar year, a condition) fall at the start of the year, so the share is 0.
 */
export function partYearBefore(plan: Pick<Plan, 'people' | 'milestones'>, ref: YearRef | undefined): number {
  let personId: string | undefined;
  if (ref?.type === 'age') personId = ref.personId;
  else if (ref?.type === 'milestone') {
    const m = plan.milestones.find((x) => x.id === ref.milestoneId);
    if (m?.when.type === 'age') personId = m.when.personId;
  }
  if (!personId) return 0;
  const p = plan.people.find((x) => x.id === personId) ?? plan.people[0];
  const month = +p.birthDate.slice(5, 7) || 1;
  const day = +p.birthDate.slice(8, 10) || 1;
  return Math.min(1, Math.max(0, (month - 1 + (day - 1) / 31) / 12));
}

export const isEarned = (inc: Plan['incomes'][number]): boolean =>
  inc.taxCharacter === 'earned' || inc.taxCharacter === 'selfEmployment';

/** True when a Social Security earnings projection depends on a condition milestone (so it needs a pre-pass). */
function earningsNeedConditionYears(plan: Plan): boolean {
  if (!plan.people.some((p) => p.socialSecurity.mode === 'earnings')) return false;
  const cond = new Set(plan.milestones.filter((m) => m.when.type === 'condition').map((m) => m.id));
  if (cond.size === 0) return false;
  const refsCond = (r: YearRef | undefined): boolean => r?.type === 'milestone' && cond.has(r.milestoneId);
  for (const inc of plan.incomes) {
    if (!isEarned(inc)) continue;
    if (refsCond(inc.start) || refsCond(inc.end)) return true;
    for (const m of plan.milestones)
      if (
        cond.has(m.id) &&
        m.effects.some(
          (e) => (e.type === 'stop' || e.type === 'start') && e.target === 'income' && e.targetId === inc.id,
        )
      )
        return true;
  }
  return false;
}

/**
 * Runs the deterministic projection of a compiled plan and returns the years its milestones fire. projection.ts
 * registers it when it loads; until then (code that only compiles, such as the app's main thread summarising
 * simulations) the Social Security earnings pre-pass for condition milestones is skipped.
 */
let conditionPrepass: ((c: Compiled) => Record<string, number>) | null = null;
export function registerConditionPrepass(fn: (c: Compiled) => Record<string, number>): void {
  conditionPrepass = fn;
}

export function compilePlan(
  plan: Plan,
  data: EngineData,
  opts: {
    stochasticLongevity?: boolean;
    /** Years condition milestones fired in a deterministic pre-pass (used for the Social Security earnings record). */
    conditionYears?: Record<string, number>;
  } = {},
): Compiled {
  // M1: when an earned income ends (or a milestone stops it) on a condition milestone, run the deterministic
  // projection once to find when it fires, then compile again with that year.
  if (!opts.conditionYears && conditionPrepass && earningsNeedConditionYears(plan)) {
    const first = compilePlan(plan, data, { ...opts, conditionYears: {} });
    return compilePlan(plan, data, { ...opts, conditionYears: conditionPrepass(first) });
  }
  const warnings: string[] = [];
  const startYear = plan.settings.startYear;
  const infl = plan.assumptions.inflation.rate;
  const wageGrowth = infl + plan.assumptions.realWageGrowth;

  const msIndex = new Map<string, number>();
  plan.milestones.forEach((m, i) => msIndex.set(m.id, i));
  const milestoneYear = plan.milestones.map((m) => {
    if (m.when.type === 'year') return m.when.year;
    if (m.when.type === 'age') {
      const w = m.when;
      const p = plan.people.find((x) => x.id === w.personId) ?? plan.people[0];
      return +p.birthDate.slice(0, 4) + w.age;
    }
    return NaN;
  });
  // Milestone years for the earnings projection: static years plus any condition years from the pre-pass.
  const earningsMsYear = plan.milestones.map((m, i) => opts.conditionYears?.[m.id] ?? milestoneYear[i]);

  const personIdx = (id: string): number => {
    const i = plan.people.findIndex((p) => p.id === id);
    return i < 0 ? 0 : i;
  };
  const claimAbsMonth = (p: Plan['people'][number]): number =>
    +p.birthDate.slice(0, 4) * 12 +
    (+p.birthDate.slice(5, 7) - 1) +
    p.socialSecurity.claimAge.years * 12 +
    p.socialSecurity.claimAge.months;

  // ------------------------------------------------------------ people + Social Security
  const people: CPerson[] = plan.people.map((p, pi) => {
    const birthYear = +p.birthDate.slice(0, 4);
    const birthMonth = +p.birthDate.slice(5, 7);
    const fra = fraMonths(data.ssSeries, birthYear);
    const claimMonths = p.socialSecurity.claimAge.years * 12 + p.socialSecurity.claimAge.months;
    let piaAnnualToday = 0;
    let estimated = false;
    if (p.socialSecurity.mode === 'pia') {
      piaAnnualToday = dollars(p.socialSecurity.piaMonthly) * 12;
    } else if (p.socialSecurity.mode === 'earnings') {
      const earnings: Record<number, number> = {};
      for (const e of p.socialSecurity.earnings) earnings[e.year] = dollars(e.amount);
      // Project future covered earnings from this person's earned-income streams.
      let currentEarned = 0;
      for (const inc of plan.incomes) {
        if (personIdx(inc.ownerId) !== pi) continue;
        if (!isEarned(inc)) continue;
        const s = staticYear(plan, inc.start, startYear, earningsMsYear, msIndex);
        const e = staticYear(plan, inc.end, birthYear + 67, earningsMsYear, msIndex);
        let from = Math.max(startYear, Number.isNaN(s) ? startYear : s);
        let to = Number.isNaN(e) ? birthYear + 67 : e;
        // Pay ending at an age runs to that birthday, so part of the final year is earned too.
        let lastPart = Number.isNaN(e) ? 0 : partYearBefore(plan, inc.end);
        // Milestone stop / start effects end or begin the income just as they do in the projection (M1).
        plan.milestones.forEach((m, mi) => {
          const my = earningsMsYear[mi];
          if (Number.isNaN(my)) return;
          for (const ef of m.effects) {
            if (ef.type !== 'stop' && ef.type !== 'start') continue;
            if (ef.target !== 'income' || ef.targetId !== inc.id) continue;
            if (ef.type === 'stop' && my <= to) {
              lastPart = partYearBefore(plan, { type: 'milestone', milestoneId: m.id, offset: 0 });
              to = my;
            } else if (ef.type === 'start') from = Math.max(startYear, Math.min(from, my));
          }
        });
        const g = inc.growth.basis === 'real' ? (1 + infl) * (1 + inc.growth.rate) - 1 : inc.growth.rate;
        for (let y = from; y < to && y < birthYear + 70; y++) {
          earnings[y] = (earnings[y] ?? 0) + dollars(inc.amount) * Math.pow(1 + g, y - startYear);
        }
        if (lastPart > 0 && to >= from && to < birthYear + 70)
          earnings[to] =
            (earnings[to] ?? 0) + lastPart * dollars(inc.amount) * Math.pow(1 + g, to - startYear);
        if (from === startYear) currentEarned += dollars(inc.amount);
      }
      if (p.socialSecurity.earnings.length === 0 && currentEarned > 0) {
        // No statement entered: back-cast the current wage with the wage index from age 22 (flagged as an estimate).
        estimated = true;
        const awiNow = awiFor(data.ssSeries, startYear, wageGrowth);
        for (let y = Math.max(birthYear + 22, 1951); y < startYear; y++) {
          earnings[y] = currentEarned * (awiFor(data.ssSeries, y, wageGrowth) / awiNow);
        }
        warnings.push(
          `Social Security for ${p.name} is estimated from current wages; enter the earnings record for a better figure.`,
        );
      }
      const r = computePia({ birthYear, earnings, series: data.ssSeries, futureWageGrowth: wageGrowth });
      const elig = r.eligibilityYear;
      // Express the PIA in plan-start dollars.
      const monthly =
        elig <= startYear
          ? applyColas(r.pia, data.ssSeries, elig, startYear - 1)
          : r.pia / Math.pow(1 + infl, elig - startYear);
      piaAnnualToday = monthly * 12;
    }
    const factor = claimFactor(claimMonths, fra);
    const ownClaimAbs = claimAbsMonth(p);
    const spouse = plan.people.length === 2 ? plan.people[pi === 0 ? 1 : 0] : undefined;
    const spousalStartMonths = Math.max(
      claimMonths,
      spouse ? claimAbsMonth(spouse) - (birthYear * 12 + (birthMonth - 1)) : claimMonths,
    );
    // Benefits are paid the month after entitlement.
    const firstPaidMonth = ownClaimAbs + 1;
    const ssClaimYear = Math.floor(firstPaidMonth / 12);
    const ssFirstYearFraction = (12 - (firstPaidMonth % 12)) / 12;
    const half = birthMonth <= 6 ? birthYear + 59 : birthYear + 60;
    let rmdAge = 75;
    for (const row of data.rmd.startAge) {
      if (row.bornThrough === null || birthYear <= row.bornThrough) {
        rmdAge = row.age;
        break;
      }
    }
    return {
      id: p.id,
      name: p.name,
      birthYear,
      birthMonth,
      sex: p.sex ?? (pi === 0 ? 'female' : 'male'),
      deathAge: p.longevity.age,
      stochasticLongevity: p.longevity.mode === 'stochastic' || !!opts.stochasticLongevity,
      year59Half: half,
      ssAnnualToday: piaAnnualToday * factor,
      ssPiaAnnualToday: piaAnnualToday,
      ssClaimYear,
      ssFirstYearFraction,
      ssClaimMonths: claimMonths,
      ssFraMonths: fra,
      ssSurvivorFraMonths: fraMonths(data.ssSeries, birthYear - 2),
      ssSpousalStartMonths: spousalStartMonths,
      ssEstimated: estimated,
      rmdStartAge: rmdAge,
    };
  });

  // ------------------------------------------------------------ accounts
  const glideById = new Map(
    plan.glidePaths.map((g) => [
      g.id,
      g.points.map((pt) => ({ age: pt.age, w: weightsOf(pt.allocation) })).sort((a, b) => a.age - b.age),
    ]),
  );
  const mk = (a: Account, synthetic = false): CAccount => {
    const kind = KIND_OF[a.type];
    const cashLike = kind === Kind.Cash || a.type === 'iBond';
    const bal = dollars(a.balance);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      kind,
      owner: personIdx(a.ownerId),
      joint: a.ownerId === 'joint',
      balance: bal,
      // A taxable account keeps a basis above its balance (an unrealized loss that can be harvested or realized).
      // 529s, annuities and I-bonds stay capped at the balance: their withdrawal rules only model gains.
      basis:
        kind === Kind.Taxable
          ? Math.max(0, dollars(a.costBasis ?? a.balance))
          : kind === Kind.Deferred || kind === Kind.Edu
            ? Math.min(bal, dollars(a.costBasis ?? a.balance))
            : 0,
      rothContrib: kind === Kind.Roth ? Math.min(bal, dollars(a.rothBasis?.contributions ?? a.balance)) : 0,
      rothLots:
        kind === Kind.Roth
          ? (a.rothBasis?.conversions ?? []).map((l) => ({ year: l.year, amount: dollars(l.amount) }))
          : [],
      rothFirstYear: a.rothBasis?.firstContributionYear ?? startYear - 5,
      weights: cashLike ? [0, 0, 1, 0, 0] : weightsOf(a.allocation),
      glide: !cashLike && a.glidePathId ? (glideById.get(a.glidePathId) ?? null) : null,
      fee: (a.fees?.expenseRatio ?? 0) + (a.fees?.advisory ?? 0),
      fixedYield: a.fixedYield ? { rate: a.fixedYield.rate, real: a.fixedYield.basis === 'real' } : null,
      src: a,
      synthetic,
    };
  };
  const accounts = plan.accounts.map((a) => mk(a));
  const synth = (id: string, name: string, type: AccountType, ownerId: string): number => {
    accounts.push(
      mk(
        {
          id,
          ownerId,
          name,
          type,
          balance: 0,
          allocation: { usStocks: 0.6, usBonds: 0.4, cash: 0, intlStocks: 0, reits: 0 },
          fees: { expenseRatio: 0, advisory: 0 },
          ruleOf55: false,
        } as Account,
        true,
      ),
    );
    return accounts.length - 1;
  };

  // Sweep account for leftover surplus.
  let sweep = plan.strategies.surplusDefaultAccountId
    ? accounts.findIndex((a) => a.id === plan.strategies.surplusDefaultAccountId)
    : -1;
  if (sweep < 0) sweep = accounts.findIndex((a) => a.kind === Kind.Taxable);
  if (sweep < 0) sweep = accounts.findIndex((a) => a.kind === Kind.Cash);
  if (sweep < 0) sweep = synth('__sweep', 'Savings (auto)', 'cash', plan.people[0].id);

  // Roth conversion / mega-backdoor target per person.
  const conversionTarget = plan.people.map((p, pi) => {
    const want = plan.strategies.rothConversion.targetAccountId;
    let t = want ? accounts.findIndex((a) => a.id === want && a.owner === pi) : -1;
    if (t < 0) t = accounts.findIndex((a) => a.type === 'rothIra' && a.owner === pi);
    // An income floor (healthcare MAGI target) is met by converting too, so it needs somewhere to convert into.
    const floor = plan.strategies.magiTarget;
    if (
      t < 0 &&
      (plan.strategies.rothConversion.mode !== 'none' ||
        plan.strategies.backdoorRoth ||
        (floor.enabled && floor.minFplPct > 0))
    )
      t = synth(`__roth_${p.id}`, `Roth IRA (${p.name})`, 'rothIra', p.id);
    return t;
  });

  const accountIndex = new Map<string, number>();
  accounts.forEach((a, i) => accountIndex.set(a.id, i));
  const incomeIndex = new Map<string, number>();
  plan.incomes.forEach((x, i) => incomeIndex.set(x.id, i));
  const expenseIndex = new Map<string, number>();
  plan.expenses.forEach((x, i) => expenseIndex.set(x.id, i));

  const anyStochastic = people.some((p) => p.stochasticLongevity);
  const maxYears = Math.max(
    1,
    ...people.map((p) => p.birthYear + (anyStochastic ? 110 : p.deathAge) - startYear + 1),
  );
  const flowExponent = plan.settings.timing === 'start' ? 1 : plan.settings.timing === 'mid' ? 0.5 : 0;

  return {
    plan,
    data,
    startYear,
    maxYears,
    people,
    accounts,
    accountIndex,
    incomeIndex,
    expenseIndex,
    milestoneIndex: msIndex,
    milestoneYear,
    sweepAccount: sweep,
    conversionTarget,
    flowExponent,
    warnings,
  };
}

/** Default coverage when the user has not entered a timeline: employer while working, marketplace after, Medicare at 65. */
export function defaultCoverage(hasEarnedIncome: boolean): Coverage['type'] {
  return hasEarnedIncome ? 'employer' : 'aca';
}

/**
 * The expected (geometric, nominal) annual return per asset class and the expected inflation the plan uses,
 * in class order [usStocks, usBonds, cash, intlStocks, reits]. Under "long-run historical averages" the US
 * classes and inflation are the compound averages of the bundled market history. The deterministic
 * projection and Monte Carlo both read this, so they centre on the same outlook.
 */
export function expectedMeans(c: Pick<Compiled, 'plan' | 'data'>): { classes: number[]; inflation: number } {
  const A = c.plan.assumptions;
  const r = A.returns.fixed;
  if (A.returns.mode !== 'historicalAverage')
    return { classes: [r.usStocks, r.usBonds, r.cash, r.intlStocks, r.reits], inflation: A.inflation.rate };
  const m = c.data.market;
  const geo = (xs: number[]): number => Math.exp(xs.reduce((a, x) => a + Math.log(1 + x), 0) / xs.length) - 1;
  return {
    classes: [geo(m.usStocks), geo(m.usBonds), geo(m.cash), r.intlStocks, r.reits],
    inflation: geo(m.inflation),
  };
}

/** Default withdrawal rank by account kind: cash, taxable, tax-deferred, pre-tax, Roth, HSA, then the rest. */
export function withdrawalRank(kind: Kind, bracketTargeted = false): number {
  switch (kind) {
    case Kind.Cash:
      return 0;
    case Kind.Taxable:
      return 1;
    case Kind.Deferred:
      return 2;
    case Kind.Pretax:
      return bracketTargeted ? -1 : 3;
    case Kind.Roth:
      return 4;
    case Kind.Hsa:
      return 5;
    default:
      return 6;
  }
}

/**
 * The account order a custom withdrawal order resolves to: the accounts the user placed, in their order (removed
 * accounts dropped), then any accounts added since, in the default order. The engine and the Strategy screen both
 * use this, so what is shown is what runs.
 */
export function resolvedCustomOrder(plan: Pick<Plan, 'accounts' | 'strategies'>): string[] {
  const ids = new Set(plan.accounts.map((a) => a.id));
  const placed = plan.strategies.withdrawalOrder.customOrder.filter(
    (id, i, xs) => ids.has(id) && xs.indexOf(id) === i,
  );
  const rest = plan.accounts
    .map((a, i) => ({ id: a.id, i, r: withdrawalRank(KIND_OF[a.type]) }))
    .filter((x) => !placed.includes(x.id))
    .sort((x, z) => x.r - z.r || x.i - z.i)
    .map((x) => x.id);
  return [...placed, ...rest];
}
