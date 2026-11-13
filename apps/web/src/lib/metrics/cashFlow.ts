import { explainCashFlow, type YearRecord } from '@fisim/engine';

export interface FlowItem {
  id: string;
  label: string;
  amount: number;
  group: string;
  route: string;
}
/** A signed ledger bridge; the explicit residual is never presented as observed income. */
export function cashFlowView(
  record: YearRecord,
  compact = false,
): { sources: FlowItem[]; uses: FlowItem[]; residual: number } {
  const ledger = explainCashFlow(record);
  const sources: FlowItem[] = [];
  const uses: FlowItem[] = [];
  for (const line of ledger.lines) {
    const tax = /tax|credit|Penalt/i.test(line.label);
    const withdrawals = /Withdrawal/.test(line.label);
    const savings = /saving/i.test(line.label);
    // A credit that arrives as cash and a tax that leaves as cash are different groups: the flow diagram
    // identifies a node by its name, so one name on both sides breaks it.
    const group = tax
      ? line.amount > 0
        ? 'Tax credits and refunds'
        : 'Taxes'
      : withdrawals
        ? 'Account withdrawals'
        : savings
          ? 'Savings'
          : line.amount > 0
            ? 'Income'
            : 'Spending';
    const route = tax
      ? '/explore/taxes'
      : withdrawals || savings
        ? '/plan/strategy'
        : line.amount > 0
          ? '/plan/income'
          : /Healthcare/.test(line.label)
            ? '/plan/healthcare'
            : '/plan/spending';
    (line.amount > 0 ? sources : uses).push({
      id: line.label,
      label: line.label,
      amount: Math.abs(line.amount),
      group,
      route,
    });
  }
  if (record.contributions.afterTax > 0)
    uses.push({
      id: 'other-savings',
      label: 'Other savings',
      amount: record.contributions.afterTax,
      group: 'Savings',
      route: '/plan/strategy',
    });
  const residual = sources.reduce((sum, x) => sum + x.amount, 0) - uses.reduce((sum, x) => sum + x.amount, 0);
  // The solver balances a year to within $1, so a smaller difference is rounding, not a flow.
  if (Math.abs(residual) > 1)
    (residual > 0 ? uses : sources).push({
      id: 'residual',
      label: residual > 0 ? 'Remaining cash / balance adjustments' : 'Unfunded gap / balance adjustments',
      amount: Math.abs(residual),
      group: 'Balance adjustments',
      route: '/explore/projection',
    });
  const group = (items: FlowItem[]): FlowItem[] => {
    const grouped = new Map<string, FlowItem>();
    for (const item of items) {
      const previous = grouped.get(item.group);
      grouped.set(item.group, {
        ...item,
        id: item.group,
        label: item.group,
        amount: item.amount + (previous?.amount ?? 0),
      });
    }
    return [...grouped.values()];
  };
  return { sources: compact ? group(sources) : sources, uses: compact ? group(uses) : uses, residual };
}
