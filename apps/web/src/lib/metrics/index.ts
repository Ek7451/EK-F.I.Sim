import { toReal, type ProjectionResult, type YearRecord } from '@fisim/engine';

export type DollarBasis = 'real' | 'nominal';

/** Definitions shared by explanations and consumers. Signed changes are neutral by default. */
export const metricDefinitions = {
  currentNetWorth: {
    source: 'ProjectionSummary.currentNetWorth',
    unit: 'USD',
    time: 'Opening balance',
    aggregation: 'Accounts + assets − debts',
    explanation: '/plan/snapshot',
  },
  endingWealth: {
    source: 'ProjectionSummary.endingNetWorthReal',
    unit: 'start-year USD',
    time: 'Final year end',
    aggregation: 'Final net worth / cpiEnd',
    explanation: '/explore/projection',
  },
  investable: {
    source: 'YearRecord.investable',
    unit: 'USD',
    time: 'Year end',
    aggregation: 'Sum of account balances; excludes property',
    explanation: '/plan/snapshot',
  },
  fiYear: {
    source: 'ProjectionSummary.fiYear',
    unit: 'year or not reached',
    time: 'First qualifying year',
    aggregation: '25× modeled recurring spending or named FI milestone',
    explanation: '/plan/timeline',
  },
  retirement: {
    source: 'ProjectionSummary.retirementYear',
    unit: 'year or not reached',
    time: 'Earliest retirement milestone',
    aggregation: 'Minimum resolved retirement year',
    explanation: '/plan/timeline',
  },
  savingsRate: {
    source: 'ProjectionSummary.savingsRate',
    unit: 'ratio',
    time: 'First year',
    aggregation: 'Employee contributions / gross income; excludes employer contributions',
    explanation: '/plan/snapshot',
  },
  spendingCoverage: {
    source: 'ProjectionSummary.success, failedYear',
    unit: 'funded / first shortfall year',
    time: 'Expected path',
    aggregation: 'No unfunded spending in any year',
    explanation: '/explore/cashflow',
  },
  successProbability: {
    source: 'McSummary.successRate',
    unit: 'ratio',
    time: 'Completed simulation runs',
    aggregation: 'Successful / completed runs; optional legacy goal included',
    explanation: '/explore/success',
  },
  percentileWealth: {
    source: 'McSummary.bands, endingPercentiles',
    unit: 'start-year USD',
    time: 'Annual / final investment balance',
    aggregation: 'Quantiles of runs; annual bands exclude ended lives',
    explanation: '/explore/success',
  },
  taxes: {
    source: 'YearRecord.taxes.total, ProjectionSummary.lifetimeTaxReal',
    unit: 'USD',
    time: 'Annual flow / lifetime',
    aggregation: 'Modeled tax after credits; sum flows / cpi for lifetime real tax',
    explanation: '/explore/taxes',
  },
  healthcare: {
    source: 'YearRecord.expenses.healthcare.total, taxes.ptc',
    unit: 'USD',
    time: 'Annual flow',
    aggregation: 'Gross cost minus premium credit; HSA is funding, not another cost',
    explanation: '/plan/healthcare',
  },
  legacy: {
    source: 'ProjectionResult.estate.netToHeirs',
    unit: 'USD',
    time: 'Final year end',
    aggregation: 'Estate minus estate tax and heirs’ pre-tax tax drag; / cpiEnd for real',
    explanation: '/explore/estate',
  },
  scenarioDifference: {
    source: 'outcomeDelta / aligned YearRecord values',
    unit: 'USD, years or percentage points',
    time: 'Aligned horizon / base year',
    aggregation: 'Candidate − baseline; missing is not zero',
    explanation: '/compare',
  },
  spendingResilience: {
    source: 'McSummary.spendingCuts',
    unit: 'ratio / years',
    time: 'Across completed runs',
    aggregation: 'Frequency, duration and lowest actual/planned spending',
    explanation: '/explore/success',
  },
} as const;
export interface AnnualMetric {
  label: string;
  kind: 'balance' | 'flow';
  description: string;
  nominal: (record: YearRecord) => number;
}
export const annualMetrics = {
  netWorth: {
    label: 'Net worth',
    kind: 'balance',
    description: 'Year-end accounts plus property, less debt.',
    nominal: (r: YearRecord) => r.netWorth,
  },
  investable: {
    label: 'Investable assets',
    kind: 'balance',
    description: 'Investment accounts, excluding property. This is not immediately accessible cash.',
    nominal: (r: YearRecord) => r.investable,
  },
  spending: {
    label: 'Spending',
    kind: 'flow',
    description: 'Annual expenses, including healthcare and housing.',
    nominal: (r: YearRecord) => r.expenses.total,
  },
  taxes: {
    label: 'Taxes',
    kind: 'flow',
    description: 'Total modeled annual taxes after credits.',
    nominal: (r: YearRecord) => r.taxes.total,
  },
  housing: {
    label: 'Housing and debt',
    kind: 'flow',
    description: 'Housing, debt service and one-off purchases.',
    nominal: (r: YearRecord) => r.expenses.housing + r.expenses.debtService + r.expenses.purchases,
  },
  taxableCash: {
    label: 'Taxable and cash',
    kind: 'balance',
    description: 'Taxable and cash balances; excludes HSA and other accounts.',
    nominal: (r: YearRecord) => r.byKind.taxable + r.byKind.cash,
  },
  otherAccounts: {
    label: 'HSA and other accounts',
    kind: 'balance',
    description: 'HSA and other balances, separate from taxable step-up assets.',
    nominal: (r: YearRecord) => r.byKind.hsa + r.byKind.other,
  },
  propertyNet: {
    label: 'Property net of debt',
    kind: 'balance',
    description: 'Property value less outstanding debts, including negative equity.',
    nominal: (r: YearRecord) => r.assets - r.debts,
  },
} satisfies Record<string, AnnualMetric>;

export function metricValue(key: keyof typeof annualMetrics, record: YearRecord, basis: DollarBasis): number {
  const metric = annualMetrics[key];
  const nominal = metric.nominal(record);
  return basis === 'real' ? toReal(nominal, record, metric.kind) : nominal;
}

export const outcomeMetrics = {
  endingWealth: {
    label: 'Ending wealth',
    unit: 'money',
    description: 'Net worth in the final plan year, in start-year purchasing power.',
    value: (r: ProjectionResult) => r.summary.endingNetWorthReal,
  },
  lifetimeTaxes: {
    label: 'Lifetime taxes',
    unit: 'money',
    description: 'Annual tax flows deflated by each year’s CPI before summing.',
    value: (r: ProjectionResult) => r.summary.lifetimeTaxReal,
  },
  fiYear: {
    label: 'Financial independence',
    unit: 'years',
    description:
      'Default: 25× living, housing, debt service and healthcare spending; excludes taxes and one-off purchases. A named FI milestone can override the test.',
    value: (r: ProjectionResult) => r.summary.fiYear,
  },
  retirement: {
    label: 'Retirement',
    unit: 'years',
    description:
      'Earliest resolved retirement milestone; each person’s timing is shown separately in the timeline.',
    value: (r: ProjectionResult) => r.summary.retirementYear,
  },
  savingsRate: {
    label: 'Savings rate',
    unit: 'rate',
    description:
      'First-year employee contributions, excluding employer contributions, divided by gross income and floored at zero.',
    value: (r: ProjectionResult) => r.summary.savingsRate,
  },
} as const;

export function outcomeDelta(
  key: keyof typeof outcomeMetrics,
  baseline: ProjectionResult,
  candidate: ProjectionResult,
): number | null {
  const a = outcomeMetrics[key].value(baseline);
  const b = outcomeMetrics[key].value(candidate);
  return a === null || b === null ? null : b - a;
}
