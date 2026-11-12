/** Results assembler: deterministic projection, summaries, "how this is calculated" entries, CSV. */
import type { DataHeader } from '@fisim/data';
import { compilePlan, type Compiled } from './compile';
import type { EngineData } from './data';
import { fixedPath, runPath, toReal, type PathResult, type YearRecord } from './projection';
import { applyScenario, type Plan } from './schema';

export interface ProjectionSummary {
  startYear: number;
  endYear: number;
  success: boolean;
  failedYear: number | null;
  /** Year investable assets first reach 25x that year’s spending, see fiSpending (or the plan's FI milestone). */
  fiYear: number | null;
  retirementYear: number | null;
  endingNetWorthReal: number;
  peakNetWorthReal: number;
  lifetimeTaxReal: number;
  lifetimeSpendingReal: number;
  currentNetWorth: number;
  savingsRate: number;
  averageEffectiveTaxRate: number;
  /** Ending net-worth goal in today's dollars (0 = none), and whether the expected path meets it. */
  legacyGoalReal: number;
  legacyGoalMet: boolean;
}

export interface ProjectionResult {
  planId: string;
  scenarioId: string | null;
  dataRelease: string;
  records: YearRecord[];
  summary: ProjectionSummary;
  estate: PathResult['estate'];
  milestoneYears: Record<string, number>;
  warnings: string[];
  solver: PathResult['solver'];
}

/**
 * The spending the 25x (4% rule) independence test covers: living costs, housing, debt payments and healthcare.
 * Taxes and one-off purchases are left out.
 */
export function fiSpending(r: YearRecord): number {
  return r.expenses.living + r.expenses.housing + r.expenses.debtService + r.expenses.healthcare.total;
}

export function project(plan: Plan, data: EngineData, scenarioId: string | null = null): ProjectionResult {
  const p = applyScenario(plan, scenarioId);
  const c = compilePlan(p, data);
  return projectCompiled(c, scenarioId);
}

export function projectCompiled(c: Compiled, scenarioId: string | null = null): ProjectionResult {
  const res = runPath(c, fixedPath(c), { detail: true });
  const recs = res.records!;
  const plan = c.plan;
  let fiYear: number | null = null;
  let peak = 0;
  let spend = 0;
  let taxSum = 0;
  let grossSum = 0;
  for (const r of recs) {
    const real = toReal(r.netWorth, r);
    if (real > peak) peak = real;
    spend += toReal(r.expenses.total, r, 'flow');
    const fiSpend = fiSpending(r);
    if (fiYear === null && fiSpend > 0 && r.investable >= 25 * fiSpend) fiYear = r.year;
    taxSum += r.taxes.total;
    grossSum += r.income.total + r.withdrawals.pretax + r.rothConversion;
  }
  let retirementYear: number | null = null;
  for (const m of plan.milestones) {
    const y = res.milestoneYears[m.id];
    if (m.kind === 'retirement' && y !== undefined)
      retirementYear = retirementYear === null ? y : Math.min(retirementYear, y);
    if (m.kind === 'fi' && y !== undefined) fiYear = y;
  }
  const first = recs[0];
  const last = recs[recs.length - 1];
  const saved0 = first ? first.contributions.total - first.contributions.employer : 0;
  return {
    planId: plan.id,
    scenarioId,
    dataRelease: c.data.release,
    records: recs,
    summary: {
      startYear: c.startYear,
      endYear: last ? last.year : c.startYear,
      success: res.success,
      failedYear: res.failedYear,
      fiYear,
      retirementYear,
      endingNetWorthReal: last ? toReal(last.netWorth, last) : 0,
      peakNetWorthReal: peak,
      lifetimeTaxReal: res.lifetimeTax,
      lifetimeSpendingReal: spend,
      currentNetWorth: first ? first.check.opening + first.assets - first.debts : 0,
      savingsRate: first && first.income.total > 0 ? Math.max(0, saved0) / first.income.total : 0,
      averageEffectiveTaxRate: grossSum > 0 ? taxSum / grossSum : 0,
      legacyGoalReal: plan.strategies.estate.legacyGoal / 100,
      legacyGoalMet:
        (last ? toReal(last.netWorth, last) : 0) >= plan.strategies.estate.legacyGoal / 100 - 0.5,
    },
    estate: res.estate,
    milestoneYears: res.milestoneYears,
    warnings: res.warnings,
    solver: res.solver,
  };
}

/** One line of an explanation: a label and a signed amount, in the unit the explanation was asked for. */
export interface ExplainLine {
  label: string;
  amount: number;
}

/**
 * Which dollars an explanation is in. Nominal is the money of that year; real is today's dollars, using the
 * same convention as the rest of the app (flows by that year’s price level, year-end balances by the
 * year-end price level), so the lines add up to the figure shown beside them.
 */
export type ExplainUnit = 'nominal' | 'real';

const scaleLines = (lines: ExplainLine[], k: number): ExplainLine[] =>
  lines.map((l) => ({ label: l.label, amount: l.amount / k }));

/** Break a year’s cash flow into the pieces behind it (UX-04 tooltips, RPT-06). */
export function explainCashFlow(
  r: YearRecord,
  unit: ExplainUnit = 'nominal',
): { result: number; lines: ExplainLine[] } {
  let lines: ExplainLine[] = [];
  const add = (label: string, amount: number): void => {
    if (Math.abs(amount) >= 0.5) lines.push({ label, amount });
  };
  add('Wages and self-employment', r.income.wages + r.income.selfEmployment);
  add('Social Security', r.income.socialSecurity);
  add('Pensions and annuities', r.income.pension + r.income.annuity);
  add('Other income', r.income.rental + r.income.other + r.income.assetSales);
  add('Withdrawals from accounts', r.withdrawals.total);
  add(
    'Payroll savings (401(k), HSA)',
    -(r.contributions.pretax + r.contributions.roth + r.contributions.hsa),
  );
  add('Federal income tax', -r.taxes.federalIncome);
  add('Payroll taxes', -(r.taxes.fica + r.taxes.selfEmployment));
  add('State income tax', -r.taxes.state);
  add('Penalties', -r.taxes.penalties);
  add('Premium tax credit', r.taxes.ptc);
  add('Living expenses', -r.expenses.living);
  add('Housing and debt payments', -(r.expenses.housing + r.expenses.debtService + r.expenses.purchases));
  add('Healthcare', -r.expenses.healthcare.total);
  if (unit === 'real') lines = scaleLines(lines, r.cpi);
  const result = lines.reduce((s, l) => s + l.amount, 0);
  return { result, lines };
}

/**
 * Year-end net worth from the start-of-year investments. In today's dollars the opening balance is valued at
 * the start-of-year price level and everything else at the year-end level, so a line for the year’s inflation
 * keeps the sum equal to year-end net worth in today's dollars.
 */
export function explainNetWorth(
  r: YearRecord,
  unit: ExplainUnit = 'nominal',
): { result: number; lines: ExplainLine[] } {
  const k = unit === 'real' ? r.cpiEnd : 1;
  const raw: ExplainLine[] = [
    {
      label: 'Investments at start of year',
      amount: unit === 'real' ? r.check.opening / r.cpi : r.check.opening,
    },
    ...(unit === 'real'
      ? [{ label: 'Inflation during the year', amount: r.check.opening / r.cpiEnd - r.check.opening / r.cpi }]
      : []),
    { label: 'Added', amount: r.check.deposits / k },
    { label: 'Withdrawn', amount: -r.check.withdrawals / k },
    { label: 'Investment returns', amount: r.returns / k },
    { label: 'Fees', amount: -r.fees / k },
    { label: 'Property and other assets', amount: r.assets / k },
    { label: 'Debts', amount: -r.debts / k },
  ];
  return { result: r.netWorth / k, lines: raw.filter((l) => Math.abs(l.amount) >= 0.5) };
}

export function explainTax(
  r: YearRecord,
  unit: ExplainUnit = 'nominal',
): { result: number; lines: ExplainLine[] } {
  const t = r.taxes;
  const lines: ExplainLine[] = [
    { label: 'Tax at ordinary rates', amount: t.ordinaryTax },
    { label: 'Tax on gains and qualified dividends', amount: t.capitalGainsTax },
    { label: 'Alternative minimum tax', amount: t.amt },
    { label: 'Net investment income tax', amount: t.niit },
    { label: 'Credits', amount: t.federalIncome - t.ordinaryTax - t.capitalGainsTax - t.amt - t.niit },
    { label: 'Payroll taxes', amount: t.fica + t.selfEmployment },
    { label: 'State income tax', amount: t.state },
    { label: 'Early-withdrawal penalties', amount: t.penalties },
    { label: 'Premium tax credit', amount: -t.ptc },
  ].filter((l) => Math.abs(l.amount) >= 0.5);
  return unit === 'real'
    ? { result: t.total / r.cpi, lines: scaleLines(lines, r.cpi) }
    : { result: t.total, lines };
}

// ------------------------------------------------------------------ methodology (RPT-06)

export interface MethodEntry {
  id: string;
  title: string;
  featureIds: string[];
  summary: string;
  formula: string;
  sources: { label: string; header: DataHeader }[];
}

export function methodology(data: EngineData, year: number): MethodEntry[] {
  const pick = <T extends { header: DataHeader }>(rec: Record<number, T>): T => {
    const ys = Object.keys(rec)
      .map(Number)
      .sort((a, b) => a - b);
    let y = ys[0];
    for (const k of ys) if (k <= year) y = k;
    return rec[y];
  };
  const src = (
    label: string,
    h: { header: DataHeader } | undefined,
  ): { label: string; header: DataHeader }[] => (h ? [{ label, header: h.header }] : []);
  return [
    {
      id: 'order-of-operations',
      title: 'How each year is worked out',
      featureIds: ['SIM-01'],
      summary:
        'Every year runs the same steps: ages and milestones, income, payroll savings, spending, then a solve for withdrawals and tax, then savings, market returns and fees.',
      formula: 'closing balance = opening + deposits − withdrawals + returns − fees',
      sources: [],
    },
    {
      id: 'tax-solver',
      title: 'Withdrawals and tax are solved together',
      featureIds: ['SIM-01', 'TAX-09'],
      summary:
        'A withdrawal raises tax, and tax raises the withdrawal you need. The engine repeats the calculation until the two agree to within $1, switching to bisection if it oscillates (25 passes at most).',
      formula: 'find W so that income + W − tax(W) − spending = 0',
      sources: [],
    },
    {
      id: 'federal-tax',
      title: 'Federal income tax',
      featureIds: ['TAX-01', 'TAX-02', 'TAX-04', 'TAX-12', 'TAX-13'],
      summary:
        'Ordinary brackets after the standard or itemized deduction, preferential rates on long-term gains and qualified dividends stacked on top, the taxable share of Social Security from provisional income, plus NIIT and an AMT estimate. Years beyond the last published tables are indexed for inflation and marked projected.',
      formula: 'tax = brackets(taxable income − gains) + gains rates(gains) + NIIT + AMT − credits',
      sources: src('Federal tax parameters', pick(data.federal)),
    },
    {
      id: 'payroll-tax',
      title: 'Payroll and self-employment tax',
      featureIds: ['TAX-03'],
      summary:
        'Social Security tax up to the wage base, Medicare tax on all earnings, the 0.9% additional Medicare tax above the threshold, and self-employment tax on 92.35% of net profit.',
      formula: 'FICA = 6.2% × min(wages, wage base) + 1.45% × wages',
      sources: src('Federal tax parameters', pick(data.federal)),
    },
    {
      id: 'state-tax',
      title: 'State income tax',
      featureIds: ['TAX-05'],
      summary:
        'State brackets applied to federal income after that state’s deductions, exemptions and retirement-income exclusions. Moving states switches tables from that year.',
      formula: 'state tax = brackets(federal AGI − exclusions − deductions)',
      sources: Object.values(data.states)
        .slice(0, 60)
        .map((ys) => ({ label: `${pick(ys).name} tax tables`, header: pick(ys).header })),
    },
    {
      id: 'rmd',
      title: 'Required minimum distributions',
      featureIds: ['TAX-06'],
      summary:
        'From age 73 (75 if born 1960 or later), each pre-tax account must pay out last year-end balance divided by the IRS Uniform Lifetime factor. Inherited IRAs follow the 10-year rule. Roth accounts have none.',
      formula: 'RMD = prior year-end balance ÷ life-expectancy factor',
      sources: src('IRS life-expectancy tables', data.rmd),
    },
    {
      id: 'roth',
      title: 'Roth conversions and early access',
      featureIds: ['TAX-07', 'PLAN-12'],
      summary:
        'Conversions are taxed as ordinary income and tracked as lots. A lot can be withdrawn without the 10% penalty after five tax years or after 59½. Bracket-filling converts just enough to reach the top of the bracket you choose.',
      formula: 'conversion = top of target bracket − ordinary taxable income',
      sources: src('Federal tax parameters', pick(data.federal)),
    },
    {
      id: 'social-security',
      title: 'Social Security',
      featureIds: ['PLAN-06'],
      summary:
        'Earnings are indexed to the year you turn 60, the best 35 years are averaged into a monthly figure, and the bend-point formula gives the benefit at full retirement age. Claiming early reduces it; waiting to 70 raises it. Spousal and survivor rules and the earnings test apply.',
      formula: 'PIA = 90% × first tier + 32% × second tier + 15% × the rest',
      sources: [
        ...src('SSA wage index and bend points', data.ssSeries),
        ...src('SSA annual parameters', pick(data.socialSecurity)),
      ],
    },
    {
      id: 'aca',
      title: 'Marketplace premiums and the premium tax credit',
      featureIds: ['HC-02', 'HC-03', 'HC-04', 'HC-05', 'STRAT-02'],
      summary:
        'The benchmark is the second-lowest-cost silver plan for your county, scaled by each person’s age. The credit covers the gap between that benchmark and a set share of your income. Under current law there is no credit above 400% of the poverty line. Below 138% in expansion states the plan assumes Medicaid.',
      formula: 'credit = benchmark premium − applicable % × MAGI',
      sources: [
        ...src('Applicable percentage table', pick(data.applicablePct)),
        ...src('Poverty guidelines', pick(data.fpl)),
        ...src('Age rating curve', data.ageCurve),
        ...src('Cost sharing', pick(data.costSharing)),
      ],
    },
    {
      id: 'medicare',
      title: 'Medicare and IRMAA',
      featureIds: ['HC-09', 'TAX-10'],
      summary:
        'Part B and Part D premiums rise in steps with income from two years earlier. If you choose to appeal after retiring, the year’s own income is used once household pay drops by 10% or more (a life-changing event, form SSA-44). Supplement, drug-plan and dental figures start from typical values that you can edit.',
      formula: 'premium tier(year) = table lookup of MAGI(year − 2)',
      sources: src('Medicare premiums and IRMAA', pick(data.medicare)),
    },
    {
      id: 'health-inflation',
      title: 'Healthcare inflation and long-term care',
      featureIds: ['HC-10', 'HC-11', 'SIM-09'],
      summary:
        'Health costs grow faster than general prices by a set margin, which varies from year to year in Monte Carlo runs. Long-term care is an optional cost event with its own duration.',
      formula: 'health index = (1 + inflation + excess) compounded',
      sources: [
        ...src('CMS health spending projections', data.healthInflation),
        ...src('Long-term care costs', data.ltc),
      ],
    },
    {
      id: 'monte-carlo',
      title: 'Chance of success',
      featureIds: ['SIM-02', 'SIM-03', 'SIM-10'],
      summary:
        'Each run strings together blocks of real historical years (stocks, bonds, cash and inflation move together as they did), or draws from a correlated lognormal model. Both centre on the same expected returns as the single projection, unless you choose to replay history with its own averages. Success means every year’s spending was funded, and, if you ask for it, that the plan ends with at least your goal. The same seed always gives the same answer.',
      formula: 'success rate = runs with no shortfall ÷ runs',
      sources: [...src('Market history', data.market), ...src('Return assumptions', data.returnAssumptions)],
    },
    {
      id: 'spending-rules',
      title: 'Flexible spending and essential costs',
      featureIds: ['STRAT-01'],
      summary:
        'A flexible rule (guardrails, a share of the portfolio, or a floor and ceiling) sets a target for the year. A cut never touches expenses marked essential: the flexible expenses absorb it, down to nothing. A raise applies to everything.',
      formula: 'flexible × k = target − essential, k ≥ 0',
      sources: [],
    },
    {
      id: 'fi',
      title: 'Financially independent',
      featureIds: ['SIM-01'],
      summary:
        'The first year investments reach 25 times that year’s spending on living costs, housing, debt payments and healthcare (taxes and one-off purchases left out), the common 4% rule of thumb. A financial-independence milestone, if you set one, takes its place.',
      formula: 'investments ≥ 25 × (living + housing + debt payments + healthcare)',
      sources: [],
    },
    {
      id: 'part-year',
      title: 'Pay that ends at a birthday',
      featureIds: ['SIM-01'],
      summary:
        'Pay that ends at an age (directly or through a retirement milestone set by age) runs up to that birthday, so the final year earns the share of the year before the birthday. The Social Security earnings record uses the same share.',
      formula: 'final-year pay = yearly pay × (birth month − 1 + day ÷ 31) ÷ 12',
      sources: [],
    },
    {
      id: 'backtest',
      title: 'Testing against history',
      featureIds: ['SIM-04'],
      summary:
        'The plan is replayed from every historical start year using the returns and inflation that followed. Start years without enough history to finish are reported separately.',
      formula: 'one run per start year',
      sources: src('Market history', data.market),
    },
    {
      id: 'longevity',
      title: 'How long the plan runs',
      featureIds: ['SIM-08'],
      summary:
        'Plans run to a fixed age, or draw each person’s lifespan from the Social Security period life table so that couples get a joint survival pattern.',
      formula: 'P(alive at x+1) = P(alive at x) × (1 − q(x))',
      sources: src('SSA period life table', data.mortality),
    },
    {
      id: 'estate',
      title: 'Estate and heirs',
      featureIds: ['STRAT-03', 'TAX-14'],
      summary:
        'What is left at the end, less federal estate tax above the exemption and the income tax heirs would owe on inherited pre-tax accounts. Taxable holdings get a stepped-up basis.',
      formula: 'net to heirs = estate − estate tax − heir rate × pre-tax balances',
      sources: src('Federal tax parameters', pick(data.federal)),
    },
  ];
}

// ------------------------------------------------------------------ CSV (RPT-05)

const CSV_COLUMNS: [string, (r: YearRecord) => number | string][] = [
  ['year', (r) => r.year],
  ['age_1', (r) => r.ages[0]],
  ['age_2', (r) => r.ages[1] ?? ''],
  ['filing_status', (r) => r.filingStatus],
  ['state', (r) => r.state],
  ['tax_data', (r) => r.dataStatus],
  ['cpi_factor', (r) => r.cpi.toFixed(6)],
  ['cpi_end_factor', (r) => r.cpiEnd.toFixed(6)],
  ['income_total', (r) => r.income.total],
  ['wages', (r) => r.income.wages + r.income.selfEmployment],
  ['social_security', (r) => r.income.socialSecurity],
  ['pension_annuity', (r) => r.income.pension + r.income.annuity],
  ['withdrawals', (r) => r.withdrawals.total],
  ['rmd', (r) => r.withdrawals.rmd],
  ['roth_conversion', (r) => r.rothConversion],
  ['contributions', (r) => r.contributions.total],
  ['expenses_total', (r) => r.expenses.total],
  ['living', (r) => r.expenses.living],
  ['housing_debt', (r) => r.expenses.housing + r.expenses.debtService],
  ['healthcare', (r) => r.expenses.healthcare.total],
  ['tax_total', (r) => r.taxes.total],
  ['tax_federal_income', (r) => r.taxes.federalIncome],
  ['tax_state', (r) => r.taxes.state],
  ['tax_payroll', (r) => r.taxes.fica + r.taxes.selfEmployment],
  ['premium_tax_credit', (r) => r.taxes.ptc],
  ['agi', (r) => r.taxes.agi],
  ['magi', (r) => r.taxes.magi],
  ['taxable_income', (r) => r.taxes.taxableIncome],
  ['marginal_rate', (r) => r.taxes.marginalRate],
  ['investable', (r) => r.investable],
  ['taxable_accounts', (r) => r.byKind.taxable + r.byKind.cash],
  ['pretax_accounts', (r) => r.byKind.pretax],
  ['roth_accounts', (r) => r.byKind.roth],
  ['hsa', (r) => r.byKind.hsa],
  ['other_assets', (r) => r.assets],
  ['debts', (r) => r.debts],
  ['net_worth', (r) => r.netWorth],
  ['net_worth_todays_dollars', (r) => toReal(r.netWorth, r)],
  ['shortfall', (r) => r.shortfall],
];

/** Per-year detail as CSV; money is rounded to cents here and nowhere earlier. */
export function recordsToCsv(records: YearRecord[]): string {
  const rows = [CSV_COLUMNS.map((c) => c[0]).join(',')];
  for (const r of records) {
    rows.push(
      CSV_COLUMNS.map(([, f]) => {
        const v = f(r);
        return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v;
      }).join(','),
    );
  }
  return rows.join('\n') + '\n';
}
