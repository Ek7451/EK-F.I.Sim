/** Results assembler: deterministic projection, summaries, "how this is calculated" entries, CSV. */
import type { DataHeader } from '@fisim/data';
import { compilePlan, type Compiled } from './compile';
import type { EngineData } from './data';
import { fixedPath, runPath, type PathResult, type YearRecord } from './projection';
import { applyScenario, type Plan } from './schema';

export interface ProjectionSummary {
  startYear: number;
  endYear: number;
  success: boolean;
  failedYear: number | null;
  /** Year investable assets first reach 25x living expenses (or the plan's FI milestone). */
  fiYear: number | null;
  retirementYear: number | null;
  endingNetWorthReal: number;
  peakNetWorthReal: number;
  lifetimeTaxReal: number;
  lifetimeSpendingReal: number;
  currentNetWorth: number;
  savingsRate: number;
  averageEffectiveTaxRate: number;
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
    const real = r.netWorth / r.cpi;
    if (real > peak) peak = real;
    spend += r.expenses.total / r.cpi;
    if (fiYear === null && r.expenses.living > 0 && r.investable >= 25 * r.expenses.living) fiYear = r.year;
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
      endingNetWorthReal: last ? last.netWorth / last.cpi : 0,
      peakNetWorthReal: peak,
      lifetimeTaxReal: res.lifetimeTax,
      lifetimeSpendingReal: spend,
      currentNetWorth: first ? first.check.opening + first.assets - first.debts : 0,
      savingsRate: first && first.income.total > 0 ? Math.max(0, saved0) / first.income.total : 0,
      averageEffectiveTaxRate: grossSum > 0 ? taxSum / grossSum : 0,
    },
    estate: res.estate,
    milestoneYears: res.milestoneYears,
    warnings: res.warnings,
    solver: res.solver,
  };
}

/** One line of an explanation: a label and a signed amount in nominal dollars. */
export interface ExplainLine {
  label: string;
  amount: number;
}

/** Break a year's cash flow into the pieces behind it (UX-04 tooltips, RPT-06). */
export function explainCashFlow(r: YearRecord): { result: number; lines: ExplainLine[] } {
  const lines: ExplainLine[] = [];
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
  const result = lines.reduce((s, l) => s + l.amount, 0);
  return { result, lines };
}

export function explainNetWorth(r: YearRecord): { result: number; lines: ExplainLine[] } {
  const lines: ExplainLine[] = [
    { label: 'Investments at start of year', amount: r.check.opening },
    { label: 'Added', amount: r.check.deposits },
    { label: 'Withdrawn', amount: -r.check.withdrawals },
    { label: 'Investment returns', amount: r.returns },
    { label: 'Fees', amount: -r.fees },
    { label: 'Property and other assets', amount: r.assets },
    { label: 'Debts', amount: -r.debts },
  ].filter((l) => Math.abs(l.amount) >= 0.5);
  return { result: r.netWorth, lines };
}

export function explainTax(r: YearRecord): { result: number; lines: ExplainLine[] } {
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
  return { result: t.total, lines };
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
        'Part B and Part D premiums rise in steps with income from two years earlier. Supplement, drug-plan and dental figures start from typical values that you can edit.',
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
        'Each run strings together blocks of real historical years (stocks, bonds, cash and inflation move together as they did), or draws from a correlated lognormal model. Success means every year’s spending was funded. The same seed always gives the same answer.',
      formula: 'success rate = runs with no shortfall ÷ runs',
      sources: [...src('Market history', data.market), ...src('Return assumptions', data.returnAssumptions)],
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
  ['net_worth_todays_dollars', (r) => r.netWorth / r.cpi],
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
