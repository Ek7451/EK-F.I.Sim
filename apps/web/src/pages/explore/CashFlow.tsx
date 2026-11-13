import { explainCashFlow, type YearRecord } from '@fisim/engine';
import { Button, Card, Explain, formatMoney } from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart, axis, short, tooltip } from '../../charts/Chart';
import { useProjection } from '../../engine/useResults';
import { cashFlowView } from '../../lib/metrics/cashFlow';
import { annualMetrics, metricValue } from '../../lib/metrics';
import { PageHead } from '../../shell/Shell';
import { useSelectedYear } from '../../state/workspace';
import { useMoney, Loading, RecomputeError, ProjectedBadge, YearPicker } from './shared';

export function CashFlowPage(): ReactNode {
  const { result, error, stale, retry } = useProjection();
  const m = useMoney();
  const [year, setYear] = useSelectedYear();
  const [flowMode, setFlowMode] = useState<'compact' | 'full' | 'list'>(() =>
    window.innerWidth < 600 ? 'list' : 'full',
  );
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Cash flow" />
        <Loading error={error} />
      </>
    );
  const recs = result.records;
  const r = recs.find((x) => x.year === year) ?? recs[0];
  const val = (x: number): number => m.flow(r, x);
  const flows = cashFlowView(r, flowMode === 'compact');
  const inflow: [string, number][] = flows.sources.map((x) => [x.label, x.amount]);
  const outflow: [string, number][] = flows.uses.map((x) => [x.label, x.amount]);
  const cf = explainCashFlow(r, m.real ? 'real' : 'nominal');
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
      <Card>
        <YearPicker records={recs} year={r.year} onChange={setYear} />
      </Card>
      <Card
        title={`Money in and out in ${r.year}`}
        actions={<Explain title={`cash flow in ${r.year}`} lines={cf.lines} total={cf.result} />}
        data-tour="sankey"
      >
        <div className="lv-row" style={{ marginBottom: 12 }}>
          {(['compact', 'full', 'list'] as const).map((mode) => (
            <Button key={mode} size="sm" aria-pressed={flowMode === mode} onClick={() => setFlowMode(mode)}>
              {mode === 'list' ? 'Flow list' : mode === 'full' ? 'Full detail' : 'Compact'}
            </Button>
          ))}
        </div>
        {flowMode === 'list' ? (
          <div className="flow-list">
            {[flows.sources, flows.uses].map((items, i) => (
              <section key={i}>
                <h3>{i === 0 ? 'Money in' : 'Money out'}</h3>
                <ul className="lv-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link to={item.route}>{item.label}</Link>
                      <span className="lv-num">{formatMoney(m.flow(r, item.amount))}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="sankey-surface" role="region" aria-label="Cash flow diagram" tabIndex={0}>
            <Chart
              label={`Cash flow for ${r.year}: sources on the left, uses on the right`}
              deps={[r, m.real]}
              height={Math.max(340, 44 * Math.max(inflow.length, outflow.length))}
              table={() => ({
                columns: ['Flow', 'Amount'],
                rows: [
                  ...inflow.map(([n, v]) => [`In: ${n}`, formatMoney(val(v))]),
                  ...outflow.map(([n, v]) => [`Out: ${n}`, formatMoney(val(v))]),
                ],
              })}
              build={(c) => ({
                tooltip: { ...tooltip(c), trigger: 'item', valueFormatter: (v: number) => formatMoney(v) },
                series: [
                  {
                    id: 'cash-flow',
                    type: 'sankey',
                    left: 8,
                    right: 235,
                    layoutIterations: 0,
                    top: 12,
                    bottom: 12,
                    nodeGap: 16,
                    nodeWidth: 16,
                    draggable: false,
                    emphasis: { focus: 'adjacency' },
                    label: {
                      color: c.ink,
                      fontSize: 12,
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
        <details className="flow-drivers">
          <summary>Inspect amounts and edit their inputs</summary>
          <ul className="lv-list">
            {[...flows.sources, ...flows.uses].map((item, i) => (
              <li key={`${item.id}-${i}`}>
                <Link to={item.route}>{item.label}</Link>
                <span className="lv-num">{formatMoney(m.flow(r, item.amount))}</span>
              </li>
            ))}
          </ul>
        </details>
        <p className="lv-small lv-muted">
          Sources and uses reconcile to this year's cash-flow ledger. Balance adjustments show the residual
          after modeled savings; an unfunded gap is not income. Amounts in {m.unit}.
        </p>
      </Card>
      <Card title="Spending by category over time" data-tour="spending-chart">
        <Chart
          label="Spending by category over time"
          deps={[result, m.real]}
          height={320}
          table={() => ({
            columns: ['Year', 'Living', 'Housing and debt', 'Healthcare', 'Taxes'],
            rows: recs.map((x) => [
              x.year,
              formatMoney(m.flow(x, x.expenses.living)),
              formatMoney(metricValue('housing', x, m.real ? 'real' : 'nominal')),
              formatMoney(m.flow(x, x.expenses.healthcare.total)),
              formatMoney(m.flow(x, x.taxes.total)),
            ]),
          })}
          build={(c) => ({
            grid: { left: 56, right: 16, top: 36, bottom: 32 },
            legend: { type: 'scroll', top: 0, textStyle: { color: c.ink2 }, icon: 'roundRect' },
            tooltip: { ...tooltip(c), trigger: 'axis', valueFormatter: (v: number) => formatMoney(v) },
            xAxis: {
              type: 'category',
              data: recs.map((x) => x.year),
              ...axis(c),
              splitLine: { show: false },
            },
            yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
            series: (
              [
                ['Living', (x: YearRecord) => x.expenses.living],
                ['Housing and debt', annualMetrics.housing.nominal],
                ['Healthcare', (x: YearRecord) => x.expenses.healthcare.total],
                ['Taxes', (x: YearRecord) => Math.max(0, x.taxes.total)],
              ] as [string, (x: YearRecord) => number][]
            ).map(([name, f]) => ({
              name,
              type: 'bar',
              stack: 's',
              barCategoryGap: '24%',
              itemStyle: { borderColor: c.surface, borderWidth: 1 },
              data: recs.map((x) => m.flow(x, f(x))),
            })),
          })}
        />
      </Card>
    </>
  );
}
