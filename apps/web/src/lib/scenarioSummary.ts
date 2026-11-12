import type { Plan, Scenario } from '@fisim/engine';
import { formatMoney, formatPct } from '@fisim/ui';

/** Human-readable input differences. The scenario patch remains the source of truth. */
export function describeChange(plan: Plan, patch: Scenario['patches'][number]): string {
  const labels: Record<string, string> = {
    usStocks: 'US stock return',
    intlStocks: 'International stock return',
    usBonds: 'Bond return',
    age: 'Age',
    year: 'Year',
    amount: 'Amount',
    claimAge: 'Social Security claiming age',
    employeePct: 'Contribution share',
    rate: 'Rate',
    balance: 'Opening balance',
    residence: 'Residence',
    retirement: 'Retirement',
    rothConversion: 'Roth conversion',
  };
  const names: string[] = [];
  let value: unknown = plan;
  for (const part of patch.path) {
    if (typeof part === 'string' && part.startsWith('@') && Array.isArray(value)) {
      value = value.find((x: { id?: string }) => x.id === part.slice(1));
      names.push((value as { name?: string } | undefined)?.name ?? 'Removed item');
    } else {
      names.push(labels[String(part)] ?? String(part).replace(/([a-z])([A-Z])/g, '$1 $2'));
      value =
        value && typeof value === 'object' ? (value as Record<string, unknown>)[String(part)] : undefined;
    }
  }
  const field = String(patch.path.at(-1));
  const format = (v: unknown): string => {
    if (v === undefined) return 'unset';
    if (Array.isArray(v)) return `${v.length} items`;
    if (v && typeof v === 'object') return 'updated settings';
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    if (typeof v === 'number' && /amount|balance|costBasis/i.test(field)) return formatMoney(v / 100);
    if (typeof v === 'number' && /rate|pct|stocks|bonds|reits/i.test(field)) return formatPct(v, 2);
    return String(v);
  };
  return `${names.join(' › ')}: ${format(value)} → ${format(patch.value)}`;
}
