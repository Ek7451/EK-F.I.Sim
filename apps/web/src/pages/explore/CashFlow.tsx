import './cashflow.css';
import { explainCashFlow, type YearRecord } from '@fisim/engine';
import { Button, Card, Explain, Icon, Popover, Segmented, formatMoney } from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart, alpha, axis, short, tooltip } from '../../charts/Chart';
import { useProjection } from '../../engine/useResults';
import { buildBreakdown, type BreakdownKey } from '../../lib/metrics/breakdown';
import { cashFlowView } from '../../lib/metrics/cashFlow';
import { annualMetrics } from '../../lib/metrics';
import { PageHead } from '../../shell/Shell';
import { usePreviewPlan } from '../../state/draft';
import { useSelectedYear } from '../../state/workspace';
import { BreakdownPanel, revealBreakdown } from './Breakdown';
import { useMoney, Loading, RecomputeError, ProjectedBadge, YearPicker } from './shared';

/** The four bars of the spending chart, in stacking order, with the colour each keeps everywhere on this screen. */
const CATEGORIES: { key: BreakdownKey; name: string; color: string; value: (x: YearRecord) => number }[] = [
  { key: 'living', name: 'Living', color: 'var(--chart-1)', value: (x) => x.expenses.living },
  { key: 'housing', name: 'Housing and debt', color: 'var(--chart-2)', value: annualMetrics.housing.nominal },
  {
    key: 'healthcare',
    name: 'Healthcare',
    color: 'var(--chart-3)',
    value: (x) => x.expenses.healthcare.total,
  },
  { key: 'taxes', name: 'Taxes', color: 'var(--chart-4)', value: (x) => Math.max(0, x.taxes.total) },
];
const COLORS: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.color]));
const TAX_KEYS: BreakdownKey[] = ['federal', 'payroll', 'state', 'penalties'];

/** Which breakdown a node of the flow diagram opens (nodes without one, such as pay or savings, open nothing). */
const FLOW_KEYS: [RegExp, BreakdownKey][] = [
  [/Living expenses$/, 'living'],
  [/Housing and debt payments$/, 'housing'],
  [/Healthcare$/, 'healthcare'],
  [/Federal income tax$/, 'federal'],
  [/Payroll taxes$/, 'payroll'],
  [/State income tax$/, 'state'],
  [/Penalties$/, 'penalties'],
  [/Premium tax credit$|Taxes$|Tax credits and refunds$/, 'taxes'],
  [/Spending$/, 'spending'],
];
const flowKey = (name: string): BreakdownKey | null => FLOW_KEYS.find(([re]) => re.test(name))?.[1] ?? null;

export function CashFlowPage(): ReactNode {
  const { result, error, stale, retry } = useProjection();
  const plan = usePreviewPlan();
  const m = useMoney();
  const [year, setYear] = useSelectedYear();
  const [flowMode, setFlowMode] = useState<'compact' | 'full' | 'list'>(() =>
    window.innerWidth < 600 ? 'list' : 'full',
  );
  const [key, setKey] = useState<BreakdownKey>('spending');
  const [spendTable, setSpendTable] = useState(false);
  /** A choice made on a chart: show its breakdown, scrolling to it where the inspector is below the charts. */
  const open = (next: BreakdownKey): void => {
    setKey(next);
    revealBreakdown('[data-cf="inspector"]');
  };
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Cash flow" />
        <Loading error={error} />
      </>
    );
  const recs = result.records;
  const index = Math.max(
    0,
    recs.findIndex((x) => x.year === year),
  );
  const r = recs[index];
  const val = (x: number): number => m.flow(r, x);
  const flows = cashFlowView(r, flowMode === 'compact');
  const inflow: [string, number][] = flows.sources.map((x) => [x.label, x.amount]);
  const outflow: [string, number][] = flows.uses.map((x) => [x.label, x.amount]);
  const cf = explainCashFlow(r, m.real ? 'real' : 'nominal');
  const breakdown = buildBreakdown(key, r, index > 0 ? recs[index - 1] : null, {
    basis: m.real ? 'real' : 'nominal',
    plan,
  });
  const isTaxType = TAX_KEYS.includes(key);
  const sankeyRows = Math.max(inflow.length, outflow.length);
  return (
    <>
      <PageHead
        group="explore"
        title="Cash flow"
        intro={`Where each year's money comes from and where it goes, in ${m.unit}.`}
        actions={<ProjectedBadge result={result} />}
      />
      <RecomputeError error={error} />
      {stale && (
        <p className="lv-muted" role="status">
          {error ? 'Last successful result' : 'Updating results…'}{' '}
          {error && (
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          )}
        </p>
      )}
      <div className="cf-grid">
        <div className="cf-left">
          <Card
            title={`Money in and out in ${r.year}`}
            actions={
              <>
                <Segmented
                  label="How much detail the flow diagram shows"
                  value={flowMode}
                  onChange={setFlowMode}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'full', label: 'Full detail' },
                    { value: 'list', label: 'Flow list' },
                  ]}
                />
                <Popover
                  label={`Amounts in ${r.year} and where to edit them`}
                  placement="bottom-end"
                  trigger={(p) => (
                    <button type="button" className="lv-btn" data-size="sm" {...p}>
                      <Icon name="edit" size={15} />
                      Inputs
                    </button>
                  )}
                >
                  <div className="cf-inputs">
                    <strong>Amounts in {r.year} and where to edit them</strong>
                    <ul className="lv-list flow-drivers">
                      {[...flows.sources, ...flows.uses].map((item, i) => (
                        <li key={`${item.id}-${i}`}>
                          <Link to={item.route}>{item.label}</Link>
                          <span className="lv-num">{formatMoney(m.flow(r, item.amount))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Popover>
                <Explain
                  title={`cash flow in ${r.year}`}
                  lines={cf.lines}
                  total={cf.result}
                  source={`Sources and uses reconcile to this year's cash-flow ledger. Balance adjustments show the residual after modeled savings; an unfunded gap is not income. Amounts in ${m.unit}.`}
                />
              </>
            }
            data-tour="sankey"
            data-cf="sankey"
          >
            {flowMode === 'list' ? (
              <div className="flow-list cf-flow-list">
                {[flows.sources, flows.uses].map((items, i) => (
                  <section key={i}>
                    <h3>{i === 0 ? 'Money in' : 'Money out'}</h3>
                    <ul className="lv-list">
                      {items.map((item) => {
                        const opens = flowKey(item.label);
                        return (
                          <li key={item.id}>
                            <Link to={item.route}>{item.label}</Link>
                            <span className="lv-row cf-flow-amount">
                              <span className="lv-num">{formatMoney(m.flow(r, item.amount))}</span>
                              {opens ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon="search"
                                  label={`See what makes up ${item.label}`}
                                  aria-pressed={key === opens}
                                  onClick={() => open(opens)}
                                />
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <div className="sankey-surface" role="region" aria-label="Cash flow diagram" tabIndex={0}>
                <Chart
                  label={`Cash flow for ${r.year}: sources on the left, uses on the right`}
                  deps={[r, m.real, flowMode]}
                  height={`max(var(--cf-sankey-h), ${sankeyRows * 30}px)`}
                  onItemClick={(p) => {
                    const opens = flowKey(p.name);
                    if (opens) open(opens);
                  }}
                  build={(c) => ({
                    tooltip: {
                      ...tooltip(c),
                      trigger: 'item',
                      valueFormatter: (v: number) => formatMoney(v),
                    },
                    series: [
                      {
                        id: 'cash-flow',
                        type: 'sankey',
                        left: 8,
                        right: 200,
                        layoutIterations: 0,
                        top: 8,
                        bottom: 8,
                        nodeGap: 12,
                        nodeWidth: 16,
                        draggable: false,
                        emphasis: { focus: 'adjacency' },
                        label: {
                          color: c.ink,
                          fontSize: 12,
                          width: 190,
                          overflow: 'truncate',
                          formatter: (p: { name: string; value: number }) => `${p.name}\n${short(p.value)}`,
                        },
                        lineStyle: { color: 'gradient', opacity: 0.42, curveness: 0.5 },
                        itemStyle: { borderRadius: 5, borderWidth: 0 },
                        data: [
                          // Node ids are unique per side; links refer to ids. (A link that names a node the chart
                          // cannot find is dropped, and the whole diagram collapses.)
                          ...inflow.map(([name]) => ({
                            id: `in:${name}`,
                            name,
                            depth: 0,
                            itemStyle: {
                              color: /tax|credit/i.test(name)
                                ? c.financial.tax
                                : name.includes('Withdrawal')
                                  ? c.financial.pretax
                                  : c.financial.income,
                            },
                          })),
                          { id: 'available', name: 'Available', depth: 1, itemStyle: { color: c.ink3 } },
                          ...outflow.map(([name]) => ({
                            id: `out:${name}`,
                            name,
                            depth: 2,
                            itemStyle: {
                              color: /tax|credit/i.test(name)
                                ? c.financial.tax
                                : name.includes('avings')
                                  ? c.financial.cash
                                  : c.financial.expense,
                            },
                          })),
                        ],
                        links: [
                          ...inflow.map(([name, v]) => ({
                            source: `in:${name}`,
                            target: 'available',
                            value: val(v),
                          })),
                          ...outflow.map(([name, v]) => ({
                            source: 'available',
                            target: `out:${name}`,
                            value: val(v),
                          })),
                        ],
                      },
                    ],
                  })}
                />
              </div>
            )}
          </Card>
          <Card
            title="Spending by category over time"
            actions={
              <>
                <span className="lv-small lv-muted cf-hint">Click a bar to see what it is made of</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={spendTable}
                  onClick={() => setSpendTable((v) => !v)}
                >
                  {spendTable ? 'Show chart' : 'Show as table'}
                </Button>
              </>
            }
            data-tour="spending-chart"
            data-cf="spending"
          >
            {spendTable ? (
              <div
                className="lv-table-wrap cf-table"
                tabIndex={0}
                role="region"
                aria-label="Spending by category over time: data table"
              >
                <table className="lv-table">
                  <thead>
                    <tr>
                      <th scope="col">Year</th>
                      {CATEGORIES.map((c) => (
                        <th key={c.key} scope="col">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recs.map((x) => (
                      <tr key={x.year} aria-selected={x.year === r.year}>
                        <th scope="row">
                          <button type="button" className="cf-year" onClick={() => setYear(x.year)}>
                            {x.year}
                          </button>
                        </th>
                        {CATEGORIES.map((c) => (
                          <td key={c.key}>
                            <button
                              type="button"
                              className="cf-cell"
                              title={`See what makes up ${c.name.toLowerCase()} in ${x.year}`}
                              onClick={() => {
                                setYear(x.year);
                                open(c.key);
                              }}
                            >
                              {formatMoney(m.flow(x, c.value(x)))}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Chart
                label="Spending by category over time"
                deps={[result, m.real, r.year]}
                height="var(--cf-spend-h)"
                onClick={(p) => setYear(recs[p.dataIndex]?.year ?? null)}
                onItemClick={(p) => {
                  const hit = CATEGORIES.find((c) => c.name === p.seriesName);
                  if (!hit) return;
                  setYear(recs[p.dataIndex]?.year ?? null);
                  open(hit.key);
                }}
                build={(c) => ({
                  grid: { left: 52, right: 12, top: 32, bottom: 26 },
                  legend: { type: 'scroll', top: 0, textStyle: { color: c.ink2 }, icon: 'roundRect' },
                  tooltip: { ...tooltip(c), trigger: 'axis', valueFormatter: (v: number) => formatMoney(v) },
                  xAxis: {
                    type: 'category',
                    data: recs.map((x) => String(x.year)),
                    ...axis(c),
                    splitLine: { show: false },
                  },
                  yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
                  series: CATEGORIES.map((cat, i) => ({
                    name: cat.name,
                    type: 'bar',
                    stack: 's',
                    barCategoryGap: '24%',
                    cursor: 'pointer',
                    itemStyle: { borderColor: c.surface, borderWidth: 1 },
                    data: recs.map((x) => m.flow(x, cat.value(x))),
                    // The year in view, so the bar that was clicked stays marked.
                    ...(i === 0
                      ? {
                          markArea: {
                            silent: true,
                            animation: false,
                            itemStyle: {
                              color: alpha(c.dawn[1], 0.14),
                              borderColor: alpha(c.dawn[1], 0.5),
                              borderWidth: 1,
                            },
                            data: [[{ xAxis: String(r.year) }, { xAxis: String(r.year) }]],
                          },
                        }
                      : {}),
                  })),
                })}
              />
            )}
          </Card>
        </div>
        <Card data-cf="inspector" data-tour="cashflow-breakdown">
          <YearPicker records={recs} year={r.year} onChange={setYear} />
          <BreakdownPanel
            breakdown={breakdown}
            unit={m.unit}
            colors={COLORS}
            color={isTaxType ? COLORS.taxes : COLORS[key]}
            keys={[
              { key: 'spending', label: 'All' },
              ...CATEGORIES.map((c) => ({ key: c.key, label: c.name })),
            ]}
            onKey={setKey}
            onClose={key === 'spending' ? undefined : () => setKey(isTaxType ? 'taxes' : 'spending')}
            closeLabel={isTaxType ? 'Back to all taxes' : 'Back to all spending'}
          />
        </Card>
      </div>
    </>
  );
}
