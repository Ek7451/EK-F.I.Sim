import {
  explainCashFlow,
  explainNetWorth,
  explainTax,
  toReal,
  type ProjectionResult,
  type YearRecord,
} from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  Explain,
  HelpTip,
  KpiStrip,
  Notice,
  Slider,
  Stat,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart, alpha, areaSeries, axis, kindColor, short, tooltip, tooltipCard } from '../charts/Chart';
import { useBacktest, useMonteCarlo, useProjection } from '../engine/useResults';
import { agesText, fundedStat, isShort } from '../lib/outcome';
import { PageHead } from '../shell/Shell';
import { usePlan, useUpdate } from '../state/store';

/**
 * Display helper: today's dollars or future dollars, as the plan is set. Year-end balances (net worth,
 * account values) are deflated by the year-end price level; money that moves during the year (income,
 * spending, tax) by the price level of that year.
 */
export function useMoney(): {
  real: boolean;
  bal: (r: YearRecord, x: number) => number;
  flow: (r: YearRecord, x: number) => number;
  unit: string;
} {
  const plan = usePlan();
  const real = (plan?.settings.display ?? 'real') === 'real';
  return {
    real,
    bal: (r, x) => (real ? toReal(x, r, 'balance') : x),
    flow: (r, x) => (real ? toReal(x, r, 'flow') : x),
    unit: real ? "today's dollars" : 'future dollars',
  };
}

function Loading({ error }: { error: string | null }): ReactNode {
  return error ? (
    <Notice tone="danger">The projection could not be worked out: {error}</Notice>
  ) : (
    <Card>
      <p className="lv-muted" role="status">
        Working out the projection…
      </p>
    </Card>
  );
}

/** A failed recompute while an earlier result is still on screen: say so instead of showing stale numbers silently. */
function RecomputeError({ error }: { error: string | null }): ReactNode {
  return error ? (
    <Notice tone="danger">
      Your latest change could not be worked out ({error}). The figures below are from before that change.
    </Notice>
  ) : null;
}

/** Engine notes about a projection, folded into one row that opens on demand. */
function Warnings({ warnings }: { warnings: string[] }): ReactNode {
  if (!warnings.length) return null;
  return (
    <details className="warn-chips" data-tour="projection-warnings">
      <summary>
        <Badge tone="warn">
          {warnings.length === 1 ? '1 note' : `${warnings.length} notes`} about these figures
        </Badge>
        <span className="lv-small lv-muted lv-ellipsis">{warnings[0]}</span>
      </summary>
      <ul>
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

function ProjectedBadge({ result }: { result: ProjectionResult }): ReactNode {
  const first = result.records.find((r) => r.dataStatus === 'projected');
  return (
    <span className="lv-row" data-tour="estimate-badges">
      <Badge>Estimated</Badge>
      {first ? <Badge tone="warn">Tax and health tables projected from {first.year}</Badge> : null}
      <Badge>{result.dataRelease}</Badge>
    </span>
  );
}

export function YearPicker({
  records,
  year,
  onChange,
}: {
  records: YearRecord[];
  year: number;
  onChange: (y: number) => void;
}): ReactNode {
  const r = records.find((x) => x.year === year) ?? records[0];
  return (
    <div data-tour="year-picker">
      <Slider
        label="Year"
        value={r.year}
        min={records[0].year}
        max={records[records.length - 1].year}
        step={1}
        onChange={onChange}
        format={(y) => `${y} · age ${records.find((x) => x.year === y)?.ages.join(' and ') ?? ''}`}
      />
    </div>
  );
}

// ------------------------------------------------------------------ projection

export function ProjectionPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const { result, ms, error } = useProjection();
  const m = useMoney();
  const [year, setYear] = useState<number | null>(null);
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Projection" />
        <Loading error={error} />
      </>
    );
  const recs = result.records;
  const sel = recs.find((r) => r.year === year) ?? recs[0];
  const s = result.summary;
  const unit = m.real ? 'real' : 'nominal';
  const nw = explainNetWorth(sel, unit);
  const cf = explainCashFlow(sel, unit);
  // What you own stacks up from zero, what you owe stacks down from it, and the net-worth line is the
  // difference, so the picture adds up to the figure in the table.
  const series: [string, (r: YearRecord) => number, Parameters<typeof kindColor>[1]][] = [
    ['Cash', (r) => r.byKind.cash, 'cash'],
    ['Taxable', (r) => r.byKind.taxable, 'taxable'],
    ['Pre-tax', (r) => r.byKind.pretax, 'pretax'],
    ['Roth', (r) => r.byKind.roth, 'roth'],
    ['HSA and other', (r) => r.byKind.hsa + r.byKind.other, 'hsa'],
    ['Property and other assets', (r) => r.assets, 'property'],
    ['Debts', (r) => -r.debts, 'debts'],
  ];
  const marks = plan.milestones
    .map((ms2) => ({ name: ms2.name, year: result.milestoneYears[ms2.id] }))
    .filter((x) => x.year !== undefined);
  const covered = fundedStat(result);
  const endAges = agesText(recs[recs.length - 1]);
  return (
    <>
      <PageHead
        group="explore"
        title="Projection"
        intro={`One path using your expected returns, shown in ${m.unit}. It is a single estimate, not a forecast: see Chance of success for the range.`}
        actions={<ProjectedBadge result={result} />}
      />
      <RecomputeError error={error} />
      <Warnings warnings={result.warnings} />
      <KpiStrip data-tour="projection-stats">
        <Stat
          icon="wallet"
          label="Net worth today"
          value={formatCompact(s.currentNetWorth)}
          note={`Start of ${s.startYear}; the chart shows each year's end`}
        />
        <Stat
          icon="estate"
          label="Left at the end of the plan"
          value={formatCompact(s.endingNetWorthReal)}
          delta={
            s.legacyGoalReal > 0
              ? {
                  dir: s.legacyGoalMet ? 'up' : 'down',
                  text: `${s.legacyGoalMet ? 'Meets' : 'Short of'} your ${formatCompact(s.legacyGoalReal)} goal`,
                }
              : undefined
          }
          note={`Net worth in ${s.endYear} (${endAges}), today's dollars`}
        />
        <Stat
          icon="target"
          label="Financially independent"
          value={s.fiYear ?? 'Not reached'}
          note="Investments reach 25× a year's spending, with housing and healthcare"
          data-tour="fi-year"
        />
        <Stat
          icon="check"
          label="Spending covered"
          value={covered.value}
          note={covered.note}
          data-tour="spending-covered"
        />
      </KpiStrip>
      <div className="chart-ledger">
        <Card
          title="Net worth over time"
          actions={
            <span className="lv-muted lv-small" data-tour="recompute-time">
              {m.unit} · recalculated in {ms.toFixed(0)} ms
            </span>
          }
          data-tour="net-worth-chart"
        >
          <Chart
            label="Net worth by account type over time"
            deps={[result, m.real]}
            height="var(--chart-h)"
            onClick={(p) => setYear(recs[p.dataIndex]?.year ?? null)}
            table={() => ({
              columns: ['Year', ...series.map((x) => x[0]), 'Net worth', 'Spending covered'],
              rows: recs.map((r) => [
                r.year,
                ...series.map((x) => formatMoney(m.bal(r, x[1](r)))),
                formatMoney(m.bal(r, r.netWorth)),
                isShort(r) ? `Short by ${formatMoney(m.flow(r, r.shortfall))}` : 'Yes',
              ]),
            })}
            build={(c) => ({
              grid: [
                { left: 52, right: 12, top: 34, bottom: 74 },
                // A thin strip under the year labels: one block per year, marked when spending ran short.
                { left: 52, right: 12, height: 6, bottom: 46 },
              ],
              legend: { type: 'scroll', top: 0, left: 0, data: [...series.map((x) => x[0]), 'Net worth'] },
              tooltip: {
                ...tooltip(c),
                trigger: 'axis',
                formatter: (ps: { dataIndex: number }[]) => {
                  const r = recs[ps[0]?.dataIndex ?? 0];
                  if (!r) return '';
                  return tooltipCard(c, {
                    title: `End of ${r.year}`,
                    subtitle: agesText(r),
                    rows: series
                      .map(([name, fn, k]) => ({ name, v: m.bal(r, fn(r)), color: kindColor(c, k) }))
                      .filter((x) => Math.abs(x.v) >= 1)
                      .map((x) => ({ name: x.name, color: x.color, value: formatMoney(x.v) })),
                    total: { name: 'Net worth', value: formatMoney(m.bal(r, r.netWorth)) },
                    notes: [
                      ...(r.milestones.length ? [{ text: r.milestones.join(', ') }] : []),
                      isShort(r)
                        ? {
                            text: `Spending short by ${formatMoney(m.flow(r, r.shortfall))}`,
                            tone: 'danger' as const,
                          }
                        : { text: 'Spending covered', tone: 'muted' as const },
                    ],
                  });
                },
              },
              xAxis: [
                {
                  type: 'category',
                  data: recs.map((r) => r.year),
                  boundaryGap: false,
                  ...axis(c),
                  splitLine: { show: false },
                },
                { type: 'category', gridIndex: 1, data: recs.map((r) => r.year), show: false },
              ],
              yAxis: [
                { type: 'value', ...axis(c), axisLabel: { color: c.ink3, fontSize: 11, formatter: short } },
                { type: 'value', gridIndex: 1, min: 0, max: 1, show: false },
              ],
              dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false },
                {
                  type: 'slider',
                  xAxisIndex: [0, 1],
                  height: 16,
                  bottom: 4,
                  borderColor: c.line,
                  fillerColor: alpha(c.primary, 0.12),
                  handleStyle: { color: c.surface, borderColor: c.ink3 },
                  moveHandleSize: 0,
                  textStyle: { color: c.ink3, fontSize: 10 },
                  dataBackground: {
                    lineStyle: { color: c.ink3, opacity: 0.4 },
                    areaStyle: { color: c.line },
                  },
                },
              ],
              series: [
                ...series.map(([name, fn, k], i) => ({
                  ...areaSeries(
                    name,
                    kindColor(c, k),
                    recs.map((r) => Math.round(m.bal(r, fn(r)))),
                    { stack: name === 'Debts' ? 'owed' : 'owned', smooth: true },
                  ),
                  markLine:
                    i === 0
                      ? {
                          symbol: 'none',
                          silent: true,
                          lineStyle: { color: c.ink3, type: 'dashed', opacity: 0.7 },
                          label: {
                            color: c.ink2,
                            fontSize: 11,
                            formatter: '{b}',
                            position: 'end',
                            rotate: 0,
                            backgroundColor: c.surface,
                            padding: [2, 4],
                            borderRadius: 4,
                          },
                          data: marks.map((x) => ({ name: x.name, xAxis: String(x.year) })),
                        }
                      : undefined,
                })),
                {
                  name: 'Net worth',
                  type: 'line',
                  symbol: 'none',
                  smooth: 0.25,
                  color: c.ink,
                  lineStyle: { width: 2, color: c.ink },
                  z: 5,
                  data: recs.map((r) => Math.round(m.bal(r, r.netWorth))),
                },
                {
                  name: 'Spending covered',
                  type: 'bar',
                  xAxisIndex: 1,
                  yAxisIndex: 1,
                  barCategoryGap: '18%',
                  silent: true,
                  tooltip: { show: false },
                  data: recs.map((r) => ({
                    value: 1,
                    itemStyle: {
                      color: isShort(r) ? c.danger : c.primary,
                      opacity: isShort(r) ? 1 : 0.3,
                      borderRadius: 2,
                    },
                  })),
                },
              ],
            })}
          />
          <p className="lv-muted lv-small funded-key">
            <span className="funded-swatch" data-short="false" aria-hidden="true" /> Spending covered{' '}
            <span className="funded-swatch" data-short="true" aria-hidden="true" /> Money runs short.{' '}
            {covered.note}.
          </p>
        </Card>
        <Card title={`End of ${sel.year}`} data-tour="year-detail">
          <div className="ledger">
            <YearPicker records={recs} year={sel.year} onChange={setYear} />
            <div className="ledger-row">
              <Stat label="Net worth" value={formatCompact(m.bal(sel, sel.netWorth))} />
              <Explain
                title={`net worth in ${sel.year}`}
                lines={nw.lines}
                total={nw.result}
                source={m.real ? "Today's dollars, at the end of the year" : `Dollars of ${sel.year}`}
              />
            </div>
            <div className="ledger-row">
              <Stat label="Spending" value={formatCompact(m.flow(sel, sel.expenses.total))} />
              <Explain
                title={`cash flow in ${sel.year}`}
                lines={cf.lines}
                total={cf.result}
                source={`Money in less money out; what is left is saved. In ${m.real ? "today's dollars" : `dollars of ${sel.year}`}.`}
              />
            </div>
            <div className="ledger-row">
              <Stat
                label="Taxes"
                value={formatCompact(m.flow(sel, sel.taxes.total))}
                note={`${formatPct(sel.taxes.effectiveRate, 1)} of income`}
              />
            </div>
            <div className="ledger-row">
              <Stat
                label={sel.withdrawals.total > sel.contributions.total ? 'Withdrawn' : 'Saved'}
                value={
                  sel.withdrawals.total > sel.contributions.total
                    ? `− ${formatCompact(m.flow(sel, sel.withdrawals.total))}`
                    : `+ ${formatCompact(m.flow(sel, sel.contributions.total))}`
                }
              />
            </div>
            {sel.milestones.length ? (
              <p>
                <Badge tone="ok">{sel.milestones.join(', ')}</Badge>
              </p>
            ) : null}
            {sel.shortfall > 1 ? (
              <Notice tone="danger">
                Spending was short by {formatMoney(m.flow(sel, sel.shortfall))} this year.
              </Notice>
            ) : null}
          </div>
        </Card>
      </div>
      <Card
        title="Quick what-ifs"
        actions={
          <Link className="lv-small" to="/explore/success">
            See the chance of success →
          </Link>
        }
        data-tour="what-if-sliders"
      >
        <p className="lv-muted lv-small" style={{ marginBottom: 12 }}>
          Drag to see the projection move. These change the plan; Undo puts them back.
        </p>
        <div className="form-grid">
          {plan.assumptions.returns.mode === 'fixed' ? (
            <Slider
              label="US stock return"
              value={plan.assumptions.returns.fixed.usStocks}
              min={0.02}
              max={0.12}
              step={0.0025}
              format={(v) => formatPct(v, 2)}
              onChange={(v) =>
                update((d) => {
                  // International stocks move by the same amount, keeping the gap you set between them.
                  const f = d.assumptions.returns.fixed;
                  f.intlStocks = Math.max(0, Math.min(0.2, f.intlStocks + (v - f.usStocks)));
                  f.usStocks = v;
                })
              }
            />
          ) : (
            <p className="lv-muted lv-small" data-tour="what-if-returns-off">
              Stock returns follow long-run history under Assumptions, so there is no return slider here.
              Choose &ldquo;The figures I set&rdquo; there to try other returns.
            </p>
          )}
          <Slider
            label="Inflation"
            value={plan.assumptions.inflation.rate}
            min={0}
            max={0.07}
            step={0.0025}
            format={(v) => formatPct(v, 2)}
            onChange={(v) =>
              update((d) => {
                d.assumptions.inflation.rate = v;
              })
            }
          />
          {plan.milestones
            .filter((x) => x.kind === 'retirement' && x.when.type === 'age')
            .slice(0, 1)
            .map((x) => (
              <Slider
                key={x.id}
                label={`${x.name} at age`}
                value={x.when.type === 'age' ? x.when.age : 65}
                min={40}
                max={75}
                step={1}
                onChange={(v) =>
                  update((d) => {
                    const k = d.milestones.find((q) => q.id === x.id);
                    if (k && k.when.type === 'age') k.when.age = v;
                  })
                }
              />
            ))}
        </div>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ cash flow (Sankey)

export function CashFlowPage(): ReactNode {
  const { result, error } = useProjection();
  const m = useMoney();
  const [year, setYear] = useState<number | null>(null);
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Cash flow" />
        <Loading error={error} />
      </>
    );
  const recs = result.records;
  const r = recs.find((x) => x.year === year) ?? recs[0];
  const val = (x: number): number => Math.round(m.flow(r, x));
  const inflow: [string, number][] = (
    [
      ['Wages', r.income.wages + r.income.selfEmployment],
      ['Social Security', r.income.socialSecurity],
      ['Pensions and annuities', r.income.pension + r.income.annuity],
      ['Other income', r.income.rental + r.income.other + r.income.assetSales],
      ['From cash and taxable', r.withdrawals.cash + r.withdrawals.taxable],
      ['From pre-tax accounts', r.withdrawals.pretax],
      ['From Roth accounts', r.withdrawals.roth],
      ['From HSA and other', r.withdrawals.hsa + r.withdrawals.other],
      ['Premium tax credit', r.taxes.ptc],
    ] as [string, number][]
  ).filter((x) => x[1] > 0.5);
  const fedPayroll = r.taxes.federalIncome + r.taxes.fica + r.taxes.selfEmployment + r.taxes.penalties;
  const outflow: [string, number][] = (
    [
      ['Federal and payroll tax', Math.max(0, fedPayroll)],
      ['State tax', r.taxes.state],
      ['Living expenses', r.expenses.living],
      ['Housing and debt', r.expenses.housing + r.expenses.debtService + r.expenses.purchases],
      ['Healthcare', r.expenses.healthcare.total],
      ['Savings from pay', r.contributions.pretax + r.contributions.roth + r.contributions.hsa],
      ['Other savings', r.contributions.afterTax],
    ] as [string, number][]
  ).filter((x) => x[1] > 0.5);
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
      <Card>
        <YearPicker records={recs} year={r.year} onChange={setYear} />
      </Card>
      <Card
        title={`Money in and out in ${r.year}`}
        actions={<Explain title={`cash flow in ${r.year}`} lines={cf.lines} total={cf.result} />}
        data-tour="sankey"
      >
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
                type: 'sankey',
                left: 8,
                right: 150,
                top: 12,
                bottom: 12,
                nodeGap: 14,
                nodeWidth: 14,
                draggable: false,
                emphasis: { focus: 'adjacency' },
                label: {
                  color: c.ink,
                  fontSize: 12,
                  formatter: (p: { name: string; value: number }) => `${p.name}  ${short(p.value)}`,
                },
                lineStyle: { color: 'gradient', opacity: 0.35, curveness: 0.5 },
                data: [
                  ...inflow.map(([name], i) => ({ name, itemStyle: { color: c.series[i % 7] } })),
                  { name: 'Available', itemStyle: { color: c.ink3 } },
                  ...outflow.map(([name], i) => ({
                    name,
                    itemStyle: {
                      color: name.includes('tax')
                        ? c.danger
                        : name.includes('avings')
                          ? c.primary
                          : c.series[(i + 2) % 7],
                    },
                  })),
                ],
                links: [
                  ...inflow.map(([name, v]) => ({ source: name, target: 'Available', value: val(v) })),
                  ...outflow.map(([name, v]) => ({ source: 'Available', target: name, value: val(v) })),
                ],
              },
            ],
          })}
        />
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
              formatMoney(m.flow(x, x.expenses.housing + x.expenses.debtService)),
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
                [
                  'Housing and debt',
                  (x: YearRecord) => x.expenses.housing + x.expenses.debtService + x.expenses.purchases,
                ],
                ['Healthcare', (x: YearRecord) => x.expenses.healthcare.total],
                ['Taxes', (x: YearRecord) => Math.max(0, x.taxes.total)],
              ] as [string, (x: YearRecord) => number][]
            ).map(([name, f]) => ({
              name,
              type: 'bar',
              stack: 's',
              barCategoryGap: '24%',
              itemStyle: { borderColor: c.surface, borderWidth: 1 },
              data: recs.map((x) => Math.round(m.flow(x, f(x)))),
            })),
          })}
        />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ taxes

export function TaxesPage(): ReactNode {
  const { result, error } = useProjection();
  const m = useMoney();
  const [year, setYear] = useState<number | null>(null);
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Taxes" />
        <Loading error={error} />
      </>
    );
  const recs = result.records;
  const r = recs.find((x) => x.year === year) ?? recs[0];
  const ex = explainTax(r, m.real ? 'real' : 'nominal');
  const parts: [string, (x: YearRecord) => number][] = [
    ['Federal income tax', (x) => Math.max(0, x.taxes.federalIncome)],
    ['Payroll tax', (x) => x.taxes.fica + x.taxes.selfEmployment],
    ['State income tax', (x) => x.taxes.state],
    ['Penalties', (x) => x.taxes.penalties],
  ];
  const moves = recs.filter((x, i) => i > 0 && x.state !== recs[i - 1].state);
  return (
    <>
      <PageHead
        group="explore"
        title="Taxes"
        intro={`Estimated federal, payroll and state tax each year, in ${m.unit}. For planning only; this is not a tax return.`}
        actions={
          <span className="lv-row">
            {recs.some((x) => x.taxes.state > 0.5) ? (
              <span
                title="State tax uses each state's brackets, deductions and main retirement exclusions, but not every credit or local tax. Treat it as a rough estimate."
                data-tour="state-tax-estimate"
              >
                <Badge tone="warn">State tax is a rough estimate</Badge>
              </span>
            ) : null}
            <ProjectedBadge result={result} />
          </span>
        }
      />
      <RecomputeError error={error} />
      <Card data-tour="tax-stats">
        <div className="lv-grid">
          <Stat
            label="Lifetime tax"
            value={formatCompact(result.summary.lifetimeTaxReal)}
            note="Today's dollars, after credits"
            data-tour="lifetime-tax"
          />
          <Stat
            label="Average rate"
            value={formatPct(result.summary.averageEffectiveTaxRate, 1)}
            note="Tax as a share of income and withdrawals"
          />
          <Stat
            label={`Marginal rate in ${r.year}`}
            value={formatPct(r.taxes.marginalRate)}
            note="Federal bracket on the next dollar"
            data-tour="marginal-rate"
          />
          <Stat
            label="Roth conversions"
            value={formatCompact(recs.reduce((t, x) => t + x.rothConversion / x.cpi, 0))}
            note="Total over the plan"
          />
        </div>
      </Card>
      <Card title="Tax by type" data-tour="tax-chart">
        <Chart
          label="Tax by type each year, with effective and marginal rates"
          deps={[result, m.real]}
          height="var(--chart-h)"
          onClick={(p) => setYear(recs[p.dataIndex]?.year ?? null)}
          table={() => ({
            columns: [
              'Year',
              ...parts.map((p) => p[0]),
              'Premium credit',
              'Effective rate',
              'Marginal rate',
              'Tables',
            ],
            rows: recs.map((x) => [
              x.year,
              ...parts.map((p) => formatMoney(m.flow(x, p[1](x)))),
              formatMoney(m.flow(x, x.taxes.ptc)),
              formatPct(x.taxes.effectiveRate, 1),
              formatPct(x.taxes.marginalRate),
              x.dataStatus,
            ]),
          })}
          build={(c) => ({
            // Two panels sharing the years, each with one value axis: tax in dollars above, rates below.
            grid: [
              { left: 56, right: 12, top: 34, bottom: '34%' },
              { left: 56, right: 12, height: '18%', bottom: 28 },
            ],
            axisPointer: { link: [{ xAxisIndex: 'all' }] },
            legend: { type: 'scroll', top: 0, left: 0 },
            tooltip: { ...tooltip(c), trigger: 'axis' },
            xAxis: [
              {
                type: 'category',
                data: recs.map((x) => x.year),
                ...axis(c),
                axisLabel: { show: false },
                splitLine: { show: false },
              },
              {
                type: 'category',
                gridIndex: 1,
                data: recs.map((x) => x.year),
                ...axis(c),
                splitLine: { show: false },
              },
            ],
            yAxis: [
              { type: 'value', ...axis(c), axisLabel: { color: c.ink3, fontSize: 11, formatter: short } },
              {
                type: 'value',
                gridIndex: 1,
                max: 0.5,
                splitNumber: 2,
                ...axis(c),
                axisLabel: {
                  color: c.ink3,
                  fontSize: 11,
                  formatter: (v: number) => `${Math.round(v * 100)}%`,
                },
              },
            ],
            series: [
              ...parts.map(([name, f]) => ({
                name,
                type: 'bar',
                stack: 't',
                barCategoryGap: '24%',
                itemStyle: { borderColor: c.surface, borderWidth: 1 },
                data: recs.map((x) => Math.round(m.flow(x, f(x)))),
                tooltip: { valueFormatter: (v: number) => formatMoney(v) },
              })),
              {
                name: 'Effective rate',
                type: 'line',
                xAxisIndex: 1,
                yAxisIndex: 1,
                symbol: 'none',
                lineStyle: { width: 2, color: c.ink },
                itemStyle: { color: c.ink },
                data: recs.map((x) => +Math.max(0, x.taxes.effectiveRate).toFixed(4)),
                tooltip: { valueFormatter: (v: number) => formatPct(v, 1) },
              },
              {
                name: 'Marginal rate',
                type: 'line',
                xAxisIndex: 1,
                yAxisIndex: 1,
                step: 'middle',
                symbol: 'none',
                lineStyle: { width: 1.5, type: 'dashed', color: c.ink3 },
                itemStyle: { color: c.ink3 },
                data: recs.map((x) => x.taxes.marginalRate),
                tooltip: { valueFormatter: (v: number) => formatPct(v) },
              },
            ],
          })}
        />
      </Card>
      <div className="two-col">
        <Card
          title={`Breakdown for ${r.year}`}
          actions={
            <Explain
              title={`tax in ${r.year}`}
              lines={ex.lines}
              total={ex.result}
              source={`Tables: ${r.dataStatus}. In ${m.unit}.`}
            />
          }
          data-tour="tax-breakdown"
        >
          <YearPicker records={recs} year={r.year} onChange={setYear} />
          <div
            className="lv-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Tax worked out for the selected year"
            style={{ marginTop: 12 }}
          >
            <table className="lv-table">
              <tbody>
                {(
                  [
                    ['Adjusted gross income', r.taxes.agi],
                    ['Deduction', -r.taxes.deduction],
                    ['Taxable income', r.taxes.taxableIncome],
                    ['Taxable Social Security', r.taxes.taxableSocialSecurity],
                    ['Income for health subsidies (MAGI)', r.taxes.magi],
                    ['Roth conversion', r.rothConversion],
                    ['Gains realized', r.realizedGains],
                    ['Required distributions', r.withdrawals.rmd],
                  ] as [string, number][]
                ).map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td>{formatMoney(m.flow(r, v))}</td>
                  </tr>
                ))}
                <tr>
                  <th scope="row">Filing status, state</th>
                  <td>
                    {r.filingStatus.toUpperCase()}, {r.state}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Medicare income tier (IRMAA)</th>
                  <td>{r.taxes.irmaaTier === 0 ? 'Standard' : `Tier ${r.taxes.irmaaTier}`}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Things to know" data-tour="tax-notes">
          <ul style={{ margin: 0, paddingLeft: 18 }} className="lv-stack">
            <li>
              {recs.some((x) => x.dataStatus === 'projected')
                ? `Years from ${recs.find((x) => x.dataStatus === 'projected')!.year} use projected tables: the latest enacted figures indexed for inflation.`
                : 'All years use enacted tables.'}
            </li>
            {moves.map((x) => (
              <li key={x.year}>
                In {x.year} you move to {x.state}; state tax switches to that state's tables from that year.
              </li>
            ))}
            {recs.some((x) => x.taxes.penalties > 1) ? (
              <li>
                Early-withdrawal penalties apply in {recs.filter((x) => x.taxes.penalties > 1).length} years.
                See Strategy for penalty-free options.
              </li>
            ) : null}
            {recs.some((x) => x.taxes.irmaaTier > 0) ? (
              <li>
                Medicare income surcharges apply in {recs.filter((x) => x.taxes.irmaaTier > 0).length} years,
                based on income two years earlier.
              </li>
            ) : null}
            <li>
              State figures are simplified where a state's rules have phase-outs this model does not carry.
              Each state's notes are under How this is calculated.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ chance of success (Monte Carlo)

export function SuccessPage(): ReactNode {
  const plan = usePlan()!;
  const { summary, progress, running, cancel, rerun } = useMonteCarlo(true);
  const mc = plan.assumptions.monteCarlo;
  return (
    <>
      <PageHead
        group="explore"
        title="Chance of success"
        intro="Thousands of possible futures, each with its own sequence of returns and inflation. Success means every year's spending was paid for. A simulation is a range of estimates, not a prediction."
        actions={
          <span className="lv-row">
            <Badge>Estimated</Badge>
            <Badge>{mc.method === 'bootstrap' ? 'Replays real history in blocks' : 'Random draws'}</Badge>
          </span>
        }
      />
      <Card data-tour="mc-status">
        <div className="lv-spread">
          <div className="lv-grid" style={{ flex: 1 }}>
            <Stat
              label="Chance of success"
              value={summary ? formatPct(summary.successRate) : '…'}
              note={
                summary
                  ? `${summary.runs.toLocaleString()} of ${mc.runs.toLocaleString()} runs · seed ${mc.seed}${summary.legacyGoal?.countsForSuccess ? ' · includes your ending goal' : ''}`
                  : 'Starting…'
              }
              data-tour="success-rate"
            />
            {summary?.legacyGoal ? (
              <Stat
                label={`Leave at least ${formatCompact(summary.legacyGoal.goal)}`}
                value={formatPct(summary.legacyGoal.metRate)}
                note={`of runs end with that much or more. Spending covered every year in ${formatPct(summary.fundedRate)}`}
                data-tour="legacy-goal-rate"
              />
            ) : null}
            <Stat
              label="Median ending wealth"
              value={summary ? formatCompact(summary.endingPercentiles.p50) : '…'}
              note="Today's dollars"
            />
            <Stat
              label="Unlucky ending (10th percentile)"
              value={summary ? formatCompact(summary.endingPercentiles.p10) : '…'}
            />
            <Stat
              label="Lucky ending (90th percentile)"
              value={summary ? formatCompact(summary.endingPercentiles.p90) : '…'}
            />
          </div>
          <div className="lv-row">
            {running ? (
              <Button onClick={cancel} data-tour="mc-cancel">
                Stop
              </Button>
            ) : (
              <Button onClick={rerun} data-tour="mc-rerun">
                Run again
              </Button>
            )}
          </div>
        </div>
        <div
          className="lv-progress"
          style={{ marginTop: 16 }}
          role="progressbar"
          aria-label="Simulation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      </Card>
      {summary ? (
        <>
          <Card title="Range of outcomes" data-tour="fan-chart">
            <Chart
              label="Investments over time: median with 25th to 75th and 10th to 90th percentile bands"
              deps={[summary]}
              height="var(--chart-h)"
              table={() => ({
                columns: ['Year', '10th', '25th', 'Median', '75th', '90th', 'Still funded'],
                rows: summary.years.map((y, i) => [
                  y,
                  formatMoney(summary.bands.p10[i]),
                  formatMoney(summary.bands.p25[i]),
                  formatMoney(summary.bands.p50[i]),
                  formatMoney(summary.bands.p75[i]),
                  formatMoney(summary.bands.p90[i]),
                  formatPct(summary.solventShare[i]),
                ]),
              })}
              build={(c) => {
                const b = summary.bands;
                const band = (name: string, lo: number[], hi: number[], opacity: number): object[] => [
                  {
                    name: `${name} base`,
                    type: 'line',
                    stack: name,
                    symbol: 'none',
                    lineStyle: { opacity: 0 },
                    data: lo.map((v) => Math.max(0, Math.round(v))),
                    tooltip: { show: false },
                    silent: true,
                  },
                  {
                    name,
                    type: 'line',
                    stack: name,
                    symbol: 'none',
                    lineStyle: { opacity: 0 },
                    areaStyle: { color: c.primary, opacity },
                    data: hi.map((v, i) => Math.max(0, Math.round(v - Math.max(0, lo[i])))),
                    silent: true,
                    tooltip: { show: false },
                  },
                ];
                return {
                  grid: { left: 56, right: 16, top: 16, bottom: 32 },
                  tooltip: {
                    ...tooltip(c),
                    trigger: 'axis',
                    formatter: (ps: { dataIndex: number }[]) => {
                      const i = ps[0].dataIndex;
                      return `<b>${summary.years[i]}</b><br/>90th: ${formatMoney(b.p90[i])}<br/>75th: ${formatMoney(b.p75[i])}<br/>Median: ${formatMoney(b.p50[i])}<br/>25th: ${formatMoney(b.p25[i])}<br/>10th: ${formatMoney(b.p10[i])}<br/>Still funded: ${formatPct(summary.solventShare[i])}`;
                    },
                  },
                  xAxis: {
                    type: 'category',
                    data: summary.years,
                    boundaryGap: false,
                    ...axis(c),
                    splitLine: { show: false },
                  },
                  yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
                  series: [
                    ...band('10th to 90th', b.p10, b.p90, 0.16),
                    ...band('25th to 75th', b.p25, b.p75, 0.28),
                    ...summary.samples.slice(0, 4).map((s2, i) => ({
                      name: `Sample ${i + 1}`,
                      type: 'line',
                      symbol: 'none',
                      silent: true,
                      lineStyle: { width: 1, color: c.ink3, opacity: 0.5 },
                      data: s2.map((v) => Math.round(v)),
                      tooltip: { show: false },
                    })),
                    {
                      name: 'Median',
                      type: 'line',
                      symbol: 'none',
                      lineStyle: { width: 2.5, color: c.primary },
                      itemStyle: { color: c.primary },
                      data: b.p50.map((v) => Math.round(v)),
                    },
                  ],
                };
              }}
            />
            <p className="lv-muted lv-small">
              Today's dollars. The dark band holds the middle half of runs; the light band holds eight in ten.
              Thin lines are single runs.
            </p>
          </Card>
          <div className="two-col" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <Card title="When plans ran short" data-tour="failure-years">
              {summary.failureYears.length === 0 ? (
                <p className="lv-muted">No run ran short of money.</p>
              ) : (
                <Chart
                  label="Number of runs that first ran short, by year"
                  deps={[summary]}
                  height={240}
                  table={() => ({
                    columns: ['Year', 'Runs'],
                    rows: summary.failureYears.map((f) => [f.year, f.count]),
                  })}
                  build={(c) => ({
                    grid: { left: 40, right: 12, top: 12, bottom: 28 },
                    tooltip: { ...tooltip(c), trigger: 'axis' },
                    xAxis: {
                      type: 'category',
                      data: summary.failureYears.map((f) => f.year),
                      ...axis(c),
                      splitLine: { show: false },
                    },
                    yAxis: { type: 'value', ...axis(c) },
                    series: [
                      {
                        type: 'bar',
                        name: 'Runs',
                        data: summary.failureYears.map((f) => f.count),
                        itemStyle: { color: c.danger, borderRadius: [4, 4, 0, 0] },
                      },
                    ],
                  })}
                />
              )}
            </Card>
            <Card title="How the simulation is set up" data-tour="mc-setup">
              <ul style={{ margin: 0, paddingLeft: 18 }} className="lv-stack">
                <li>
                  {mc.method === 'bootstrap'
                    ? `Each run strings together ${mc.blockLength}-year blocks of real history, so stocks, bonds, cash and inflation move together as they actually did.`
                    : 'Each run draws returns at random around your assumptions, keeping the usual relationships between asset classes.'}
                </li>
                {mc.method === 'bootstrap' ? (
                  <li>
                    Replayed history does not use the expected returns set under Assumptions. Past US returns
                    were higher than most forward-looking assumptions, so these runs can look more generous
                    than the single-path projection. Choose random draws around your assumptions to test your
                    own figures.
                  </li>
                ) : null}
                <li>
                  {mc.stochasticLongevity
                    ? 'Lifespans vary from run to run using Social Security life tables.'
                    : 'Every run lasts to the ages set under Household.'}
                </li>
                <li>Seed {mc.seed}: the same plan and seed always give this exact result.</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                <Link to="/plan/assumptions">Change simulation settings →</Link>
              </p>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <p className="lv-muted" role="status">
            Running the first batch…
          </p>
        </Card>
      )}
    </>
  );
}

// ------------------------------------------------------------------ against history

export function HistoryPage(): ReactNode {
  const { result, running } = useBacktest(true);
  const sorted = useMemo(
    () =>
      result
        ? [...result.cohorts]
            .filter((c) => c.complete)
            .sort((a, b) => a.lastedYears - b.lastedYears || a.endingReal - b.endingReal)
        : [],
    [result],
  );
  return (
    <>
      <PageHead
        group="explore"
        title="Against history"
        intro="Your plan replayed from every starting year since 1871, using the returns and inflation that actually followed. It shows how the plan copes with a bad run of early years."
        actions={<Badge>Estimated</Badge>}
      />
      {!result ? (
        <Card>
          <p className="lv-muted" role="status">
            {running ? 'Replaying history…' : 'Preparing…'}
          </p>
        </Card>
      ) : (
        <>
          <Card data-tour="history-stats">
            <div className="lv-grid">
              <Stat
                label="Start years that worked"
                value={`${result.successCount} of ${result.completeCount}`}
                note={formatPct(result.successRate, 1)}
                data-tour="history-success"
              />
              <Stat
                label="Hardest start year"
                value={result.worst?.startYear ?? '—'}
                note={
                  result.worst
                    ? result.worst.success
                      ? `Lowest point ${formatCompact(result.worst.minReal)}`
                      : `Money lasted ${result.worst.lastedYears} years`
                    : undefined
                }
                data-tour="worst-year"
              />
              <Stat
                label="Median ending wealth"
                value={formatCompact(result.medianEndingReal)}
                note="Today's dollars"
              />
              <Stat
                label="Unfinished start years"
                value={result.partialCount}
                note={`History ends in ${result.dataThrough}; these are shown faintly`}
              />
            </div>
          </Card>
          <Card
            title={
              <span className="lv-label-row">
                Every start year
                <HelpTip>
                  International stocks and REITs follow US stocks here because they have no long public
                  history. Bonds are 10-year Treasuries, which lost more in the 1970s than the intermediate
                  bonds used in the Bengen and Trinity studies, so a 4% plan here can look a few points worse
                  than those studies report.
                </HelpTip>
              </span>
            }
            data-tour="history-chart"
          >
            <Chart
              label="Investments over the plan for each historical start year; the hardest start year is highlighted"
              deps={[result]}
              height="var(--chart-h)"
              table={() => ({
                columns: ['Start year', 'Outcome', 'Years funded', 'Ending wealth', 'Lowest point'],
                rows: sorted.map((c) => [
                  c.startYear,
                  c.success ? 'Funded' : 'Ran short',
                  c.lastedYears,
                  formatMoney(c.endingReal),
                  formatMoney(c.minReal),
                ]),
              })}
              build={(c) => ({
                grid: { left: 56, right: 16, top: 16, bottom: 32 },
                tooltip: {
                  ...tooltip(c),
                  trigger: 'item',
                  formatter: (p: { seriesName: string; value: number; dataIndex: number }) =>
                    `Started ${p.seriesName}<br/>Year ${p.dataIndex + 1}: ${formatMoney(p.value)}`,
                },
                xAxis: {
                  type: 'category',
                  data: Array.from({ length: result.horizon }, (_, i) => i + 1),
                  name: 'Years into the plan',
                  nameLocation: 'middle',
                  nameGap: 24,
                  nameTextStyle: { color: c.ink3 },
                  ...axis(c),
                  splitLine: { show: false },
                },
                yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
                series: result.cohorts.map((co) => {
                  const worst = co.startYear === result.worst?.startYear;
                  return {
                    name: String(co.startYear),
                    type: 'line',
                    symbol: 'none',
                    z: worst ? 5 : co.success ? 1 : 2,
                    lineStyle: {
                      width: worst ? 3 : 1,
                      color: worst ? c.accent : co.success ? c.primary : c.danger,
                      opacity: worst ? 1 : co.complete ? 0.28 : 0.1,
                    },
                    data: co.series.map((v) => Math.round(v)),
                    emphasis: { lineStyle: { width: 2.5, opacity: 1 } },
                  };
                }),
              })}
            />
            <p className="lv-muted lv-small">
              Each line is one start year, in today's dollars. Red lines ran short; the thick line is the
              hardest start year.
            </p>
          </Card>
          <Card title="The ten hardest start years" data-tour="worst-table">
            <div className="lv-table-wrap" tabIndex={0} role="region" aria-label="Hardest starting years">
              <table className="lv-table">
                <thead>
                  <tr>
                    <th scope="col">Start year</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Years funded</th>
                    <th scope="col">Lowest point</th>
                    <th scope="col">Ending wealth</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 10).map((c) => (
                    <tr key={c.startYear}>
                      <th scope="row">{c.startYear}</th>
                      <td>{c.success ? 'Funded' : 'Ran short'}</td>
                      <td>{c.lastedYears}</td>
                      <td>{formatMoney(c.minReal)}</td>
                      <td>{formatMoney(c.endingReal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ estate

export function EstatePage(): ReactNode {
  const { result, error } = useProjection();
  const plan = usePlan()!;
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Estate" />
        <Loading error={error} />
      </>
    );
  const e = result.estate;
  const last = result.records[result.records.length - 1];
  const cpi = last.cpiEnd;
  const real = (x: number): number => x / cpi;
  const lines = [
    { label: 'Estate at the end of the plan', amount: real(e.value) },
    { label: 'Federal estate tax', amount: -real(e.estateTax) },
    { label: 'Income tax heirs owe on pre-tax accounts', amount: -real(e.heirPretaxDrag) },
  ];
  return (
    <>
      <PageHead
        group="explore"
        title="Estate"
        intro="What is left for heirs at the end of the plan on the expected path, and what tax takes from it. In today's dollars."
        actions={<ProjectedBadge result={result} />}
      />
      <RecomputeError error={error} />
      <Card data-tour="estate-stats">
        <div className="lv-grid">
          <Stat
            label="Estate"
            value={formatCompact(real(e.value))}
            note={`In ${last.year}`}
            data-tour="estate-value"
          />
          <div className="lv-row" style={{ flexWrap: 'nowrap' }}>
            <Stat label="Net to heirs" value={formatCompact(real(e.netToHeirs))} />
            <Explain
              title="what heirs receive"
              lines={lines}
              total={real(e.netToHeirs)}
              source={`Today's dollars, valued at the end of ${last.year}`}
            />
          </div>
          <Stat
            label="Tax heirs pay on pre-tax accounts"
            value={formatCompact(real(e.heirPretaxDrag))}
            note={`At ${formatPct(plan.strategies.estate.heirMarginalRate)}; change it under Strategy`}
            data-tour="heir-drag"
          />
          <Stat
            label="Gains wiped out by step-up"
            value={formatCompact(real(e.stepUpGains))}
            note="Taxable accounts and property pass at current value"
            data-tour="step-up"
          />
        </div>
        {e.estateTax > 0 ? (
          <Notice tone="warn">
            The estate is above the federal exemption, with about {formatMoney(real(e.estateTax))} of estate
            tax. State estate and inheritance taxes are not modelled.
          </Notice>
        ) : (
          <p className="lv-muted lv-small" style={{ marginTop: 12 }}>
            Below the federal estate-tax exemption. State estate and inheritance taxes are not modelled.
          </p>
        )}
      </Card>
      <Card title="What heirs would receive, by year" data-tour="estate-chart">
        <Chart
          label="Estate value by year, split by account type"
          deps={[result]}
          height="var(--chart-h)"
          table={() => ({
            columns: ['Year', 'Pre-tax', 'Roth', 'Taxable and cash', 'Property net of debt'],
            rows: result.records.map((r) => [
              r.year,
              formatMoney(r.byKind.pretax / r.cpiEnd),
              formatMoney(r.byKind.roth / r.cpiEnd),
              formatMoney((r.byKind.taxable + r.byKind.cash) / r.cpiEnd),
              formatMoney((r.assets - r.debts) / r.cpiEnd),
            ]),
          })}
          build={(c) => ({
            grid: { left: 56, right: 16, top: 36, bottom: 32 },
            legend: { type: 'scroll', top: 0, textStyle: { color: c.ink2 }, icon: 'roundRect' },
            tooltip: { ...tooltip(c), trigger: 'axis', valueFormatter: (v: number) => formatMoney(v) },
            xAxis: {
              type: 'category',
              data: result.records.map((r) => r.year),
              boundaryGap: false,
              ...axis(c),
              splitLine: { show: false },
            },
            yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
            series: (
              [
                ['Pre-tax (heirs pay income tax)', (r: YearRecord) => r.byKind.pretax],
                ['Roth (tax-free to heirs)', (r: YearRecord) => r.byKind.roth],
                [
                  'Taxable and cash (stepped up)',
                  (r: YearRecord) => r.byKind.taxable + r.byKind.cash + r.byKind.hsa + r.byKind.other,
                ],
                ['Property net of debt', (r: YearRecord) => Math.max(0, r.assets - r.debts)],
              ] as [string, (r: YearRecord) => number][]
            ).map(([name, f], i) =>
              areaSeries(
                name,
                c.series[[2, 3, 1, 6][i] ?? i],
                result.records.map((r) => Math.round(f(r) / r.cpiEnd)),
                { stack: 'e', smooth: true },
              ),
            ),
          })}
        />
      </Card>
    </>
  );
}
