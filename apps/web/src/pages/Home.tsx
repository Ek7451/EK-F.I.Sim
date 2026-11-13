import type { YearRecord } from '@fisim/engine';
import {
  Button,
  Card,
  Icon,
  IconTile,
  Segmented,
  Skeleton,
  Stat,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import {
  Chart,
  areaSeries,
  axis,
  barFill,
  dawnFill,
  dawnLine,
  kindColor,
  readColors,
  short,
  tooltip,
  tooltipCard,
  type ChartColors,
} from '../charts/Chart';
import { useProjection } from '../engine/useResults';
import { annualMetrics } from '../lib/metrics';
import { agesText, fundedStat, isShort } from '../lib/outcome';
import { PageHead } from '../shell/Shell';
import { usePlan, useStore } from '../state/store';
import { useSelectedYear } from '../state/workspace';
import { StartPage } from './StartWizard';
import { CalculationStatus } from './workspace/CalculationStatus';

/**
 * The plan drawn as a line of time: today on the left, the last plan year on the right, and the years that
 * matter along it. A picture of figures already stated in words beside it, so it is hidden from assistive tech.
 */
function Journey({
  start,
  end,
  stops,
}: {
  start: number;
  end: number;
  stops: { year: number; kind: 'fi' | 'retire'; label: string }[];
}): ReactNode {
  const span = Math.max(1, end - start);
  const at = (year: number): number => Math.max(0, Math.min(1, (year - start) / span)) * 100;
  return (
    <div className="journey" aria-hidden="true">
      <div className="journey-track">
        {stops.map((x, i) => (
          <span
            key={x.kind}
            className="journey-stop"
            data-kind={x.kind}
            data-row={i % 2}
            style={{ left: `${at(x.year)}%` }}
          >
            <i />
            <b>
              {x.label} {x.year}
            </b>
          </span>
        ))}
      </div>
      <div className="journey-ends">
        <span>{start}</span>
        <span>{end}</span>
      </div>
    </div>
  );
}

// Overview figures are always in today's dollars: year-end balances by the year-end price level, money that
// moves during the year by that year's price level (the same rule as every analysis screen).
const bal = (r: YearRecord, x: number): number => x / r.cpiEnd;
const flow = (r: YearRecord, x: number): number => x / r.cpi;

type Row = { name: string; color: string; value: (r: YearRecord) => number };
interface View {
  id: 'netWorth' | 'accounts' | 'cash' | 'spending' | 'taxes';
  label: string;
  title: string;
  to: string;
  link: string;
  /** What the table and tooltip total is called (omitted where a total would mislead). */
  total?: string;
  rows: (c: ChartColors) => Row[];
  series: (c: ChartColors, recs: YearRecord[], rows: Row[]) => object[];
}

const stackedBars = (recs: YearRecord[], rows: Row[]): object[] =>
  rows.map((row) => ({
    id: row.name,
    name: row.name,
    type: 'bar',
    stack: 'all',
    barCategoryGap: '22%',
    color: row.color,
    itemStyle: { color: barFill(row.color) },
    emphasis: { focus: 'series' },
    data: recs.map((r) => row.value(r)),
  }));

const VIEWS: View[] = [
  {
    id: 'netWorth',
    label: 'Net worth',
    title: 'Net worth over the plan',
    to: '/explore/projection',
    link: 'Open the projection',
    rows: (c) => [{ name: 'Net worth', color: c.dawn[1], value: (r) => bal(r, r.netWorth) }],
    series: (c, recs, rows) => [
      {
        ...areaSeries(
          'Net worth',
          c.dawn[1],
          recs.map((r) => rows[0].value(r)),
        ),
        lineStyle: dawnLine(c, 3.5),
        areaStyle: dawnFill(c),
      },
    ],
  },
  {
    id: 'accounts',
    label: 'Accounts',
    title: 'What you own and owe',
    to: '/explore/projection',
    link: 'Open the projection',
    total: 'Net worth',
    rows: (c) => [
      { name: 'Cash', color: kindColor(c, 'cash'), value: (r) => bal(r, r.byKind.cash) },
      { name: 'Taxable', color: kindColor(c, 'taxable'), value: (r) => bal(r, r.byKind.taxable) },
      { name: 'Pre-tax', color: kindColor(c, 'pretax'), value: (r) => bal(r, r.byKind.pretax) },
      { name: 'Roth', color: kindColor(c, 'roth'), value: (r) => bal(r, r.byKind.roth) },
      {
        name: 'HSA and other',
        color: kindColor(c, 'hsa'),
        value: (r) => bal(r, r.byKind.hsa + r.byKind.other),
      },
      { name: 'Property', color: kindColor(c, 'property'), value: (r) => bal(r, r.assets) },
      { name: 'Debts', color: kindColor(c, 'debts'), value: (r) => bal(r, -r.debts) },
    ],
    series: (_c, recs, rows) =>
      rows.map((row) =>
        areaSeries(
          row.name,
          row.color,
          recs.map((r) => row.value(r)),
          { stack: row.name === 'Debts' ? 'owed' : 'owned' },
        ),
      ),
  },
  {
    id: 'cash',
    label: 'Cash flow',
    title: 'Money in against money out',
    to: '/explore/cashflow',
    link: 'Open cash flow',
    rows: (c) => [
      { name: 'Income', color: c.financial.income, value: (r) => flow(r, r.income.total) },
      { name: 'Withdrawals', color: c.financial.pretax, value: (r) => flow(r, r.withdrawals.total) },
      {
        name: 'Spending and taxes',
        color: c.dawn[2],
        value: (r) => flow(r, r.expenses.total + Math.max(0, r.taxes.total)),
      },
    ],
    series: (c, recs, rows) => [
      ...stackedBars(recs, rows.slice(0, 2)),
      {
        id: rows[2].name,
        name: rows[2].name,
        type: 'line',
        step: 'middle',
        symbol: 'none',
        color: rows[2].color,
        lineStyle: { width: 2.5, color: c.dawn[2], shadowColor: c.dawn[2], shadowBlur: 10 },
        z: 5,
        data: recs.map((r) => rows[2].value(r)),
      },
    ],
  },
  {
    id: 'spending',
    label: 'Spending',
    title: 'Spending by category',
    to: '/explore/cashflow',
    link: 'Open cash flow',
    total: 'Total',
    rows: (c) => [
      { name: 'Living', color: c.series[0], value: (r) => flow(r, r.expenses.living) },
      {
        name: 'Housing and debt',
        color: c.series[1],
        value: (r) => flow(r, annualMetrics.housing.nominal(r)),
      },
      { name: 'Healthcare', color: c.series[2], value: (r) => flow(r, r.expenses.healthcare.total) },
      { name: 'Taxes', color: c.series[3], value: (r) => flow(r, Math.max(0, r.taxes.total)) },
    ],
    series: (_c, recs, rows) => stackedBars(recs, rows),
  },
  {
    id: 'taxes',
    label: 'Taxes',
    title: 'Tax by type',
    to: '/explore/taxes',
    link: 'Open taxes',
    total: 'Total before credits',
    rows: (c) => [
      {
        name: 'Federal income',
        color: c.series[0],
        value: (r) => flow(r, Math.max(0, r.taxes.federalIncome)),
      },
      { name: 'Payroll', color: c.series[1], value: (r) => flow(r, r.taxes.fica + r.taxes.selfEmployment) },
      { name: 'State', color: c.series[2], value: (r) => flow(r, Math.max(0, r.taxes.state)) },
      {
        name: 'Other',
        color: c.series[3],
        value: (r) => flow(r, r.taxes.niit + r.taxes.amt + r.taxes.penalties),
      },
    ],
    series: (_c, recs, rows) => stackedBars(recs, rows),
  },
];

function readView(): View['id'] {
  try {
    const saved = sessionStorage.getItem('lv-home-view');
    if (VIEWS.some((v) => v.id === saved)) return saved as View['id'];
  } catch {
    /* no storage: start on net worth */
  }
  return 'netWorth';
}

export function HomePage(): ReactNode {
  const plan = usePlan();
  const { result } = useProjection();
  const settings = useStore((s) => s.settings);
  const prev = useRef<{ nw: number; fi: number | null } | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const [viewId, setViewId] = useState<View['id']>(readView);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useSelectedYear();
  useEffect(() => {
    if (!result) return;
    const now = { nw: result.summary.endingNetWorthReal, fi: result.summary.fiYear };
    if (prev.current && Math.abs(prev.current.nw - now.nw) > 500) {
      const d = now.nw - prev.current.nw;
      setChanged(
        `Since your last change, net worth at the end of the plan is ${d > 0 ? 'up' : 'down'} ${formatCompact(Math.abs(d))}${prev.current.fi !== now.fi && now.fi && prev.current.fi ? `, and financial independence moves from ${prev.current.fi} to ${now.fi}` : ''}.`,
      );
    }
    prev.current = now;
  }, [result]);
  if (!plan) return <StartPage />;
  const s = result?.summary;
  const covered = result ? fundedStat(result) : null;
  const backupAge = settings.lastBackupAt
    ? Math.floor((Date.now() - Date.parse(settings.lastBackupAt)) / 86400000)
    : null;
  const actions: { to: string; icon: string; title: string; text: string; tour?: string }[] = [
    {
      to: '/plan/snapshot',
      icon: 'wallet',
      title: 'Build the plan',
      text: 'Accounts, income, spending, milestones',
    },
    {
      to: '/explore/success',
      icon: 'success',
      title: 'Test it',
      text: 'Thousands of futures and every start year',
    },
    {
      to: '/compare',
      icon: 'compare',
      title: 'Try a what-if',
      text: 'Retire earlier, spend more, move state',
    },
    {
      to: '/settings',
      icon: 'shield',
      title: 'Your data',
      text:
        backupAge === null
          ? 'Stored on this device. No backup yet'
          : backupAge > 90
            ? `Last backup ${backupAge} days ago`
            : `Last backup ${backupAge === 0 ? 'today' : `${backupAge} days ago`}`,
      tour: 'backup-link',
    },
  ];
  const view = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0];
  const pick = (id: View['id']): void => {
    setViewId(id);
    try {
      sessionStorage.setItem('lv-home-view', id);
    } catch {
      /* not remembered */
    }
  };
  const step = (by: number): void => pick(VIEWS[(VIEWS.indexOf(view) + by + VIEWS.length) % VIEWS.length].id);
  const recs = result?.records ?? [];
  // The year the strip under the chart describes: the one under the pointer, else the pinned one, else this year.
  const year = recs.length
    ? (recs[hover ?? -1] ?? recs.find((r) => r.year === pinned) ?? recs[0])
    : undefined;
  const retirement = plan.milestones
    .filter((m) => m.kind === 'retirement')
    .map(
      (m) =>
        `${m.name}: ${m.when.type === 'age' ? `age ${m.when.age}` : (result?.milestoneYears[m.id] ?? 'Not reached')}`,
    )
    .join(' · ');

  return (
    <>
      <PageHead
        title={plan.name}
        intro="The headline numbers for this plan, in today's dollars. Every figure is an estimate that updates as you edit."
      />
      <CalculationStatus />
      <div className="home-grid">
        <Card variant="hero" data-tour="home-stats">
          <div className="home-hero-body">
            <Stat
              size="hero"
              label="Net worth today"
              value={s ? formatCompact(s.currentNetWorth) : <Skeleton height={44} width={180} />}
              note={
                s ? (
                  <>
                    Start of {s.startYear}, from your plan inputs.{' '}
                    {plan.actuals.length ? (
                      <Link to="/track">
                        Latest recorded investments:{' '}
                        {formatMoney(
                          Object.values(plan.actuals.at(-1)!.balances).reduce(
                            (sum, value) => sum + value,
                            0,
                          ) / 100,
                        )}{' '}
                        on {plan.actuals.at(-1)!.date}
                      </Link>
                    ) : (
                      <Link to="/track">Record actual balances</Link>
                    )}
                  </>
                ) : undefined
              }
            />
            {changed ? (
              <p className="home-changed" data-tour="what-changed">
                <Icon name="sparkle" size={16} />
                <span>{changed}</span>
              </p>
            ) : null}
            {s ? (
              <Journey
                start={s.startYear}
                end={s.endYear}
                stops={[
                  ...(s.fiYear ? [{ year: s.fiYear, kind: 'fi' as const, label: 'Independent' }] : []),
                  ...(s.retirementYear
                    ? [{ year: s.retirementYear, kind: 'retire' as const, label: 'Retire' }]
                    : []),
                ]}
              />
            ) : null}
            <dl className="home-facts">
              <div>
                <dt>Financially independent</dt>
                <dd>{s ? (s.fiYear ?? 'Not reached') : '…'}</dd>
              </div>
              <div>
                <dt>Retirement</dt>
                <dd>{s ? (s.retirementYear ?? 'Not set') : '…'}</dd>
              </div>
              <div>
                <dt>Saving this year</dt>
                <dd>{s ? formatPct(s.savingsRate) : '…'}</dd>
              </div>
              <div data-tour="home-covered">
                <dt>Spending covered</dt>
                <dd>{covered ? covered.value : '…'}</dd>
              </div>
              <div>
                <dt>Left at the end</dt>
                <dd>{s ? formatCompact(s.endingNetWorthReal) : '…'}</dd>
              </div>
              <div>
                <dt>Lifetime tax</dt>
                <dd>{s ? formatCompact(s.lifetimeTaxReal) : '…'}</dd>
              </div>
            </dl>
            <p className="lv-small lv-muted home-fineprint">
              {covered?.note ? `${covered.note}. ` : ''}Independent means investments reach 25× a year's
              spending, with housing and healthcare.
            </p>
            {result ? (
              <div className="home-next">
                <div>
                  <strong>Next decision</strong>
                  <p>{retirement || 'Add your first milestone'}</p>
                </div>
                <Link className="lv-btn" data-variant="primary" data-size="sm" to="/explore/projection">
                  Explore a change
                </Link>
              </div>
            ) : null}
          </div>
        </Card>
        <div className="home-main">
          <Card
            title={view.title}
            actions={
              <>
                <Segmented
                  label="Chart"
                  value={view.id}
                  onChange={pick}
                  options={VIEWS.map((v) => ({ value: v.id, label: v.label }))}
                  data-tour="home-views"
                />
                <Button size="sm" variant="ghost" icon="chevron" label="Next chart" onClick={() => step(1)} />
              </>
            }
            data-tour="home-chart"
          >
            {result ? (
              <Chart
                label={`${view.title}, in today's dollars`}
                deps={[result, view.id]}
                height="var(--home-chart-h)"
                onHover={(p) => setHover(p ? p.dataIndex : null)}
                onClick={(p) => setPinned(recs[p.dataIndex]?.year ?? null)}
                footer={
                  <Link className="lv-small" to={view.to}>
                    {view.link} →
                  </Link>
                }
                table={() => {
                  const rows = view.rows(readColors());
                  return {
                    columns: ['Year', ...rows.map((x) => x.name)],
                    rows: recs.map((r) => [r.year, ...rows.map((x) => formatMoney(x.value(r)))]),
                  };
                }}
                build={(c): EChartsCoreOption => {
                  const rows = view.rows(c);
                  return {
                    grid: { left: 52, right: 12, top: rows.length > 1 ? 30 : 12, bottom: 26 },
                    legend: rows.length > 1 ? { type: 'scroll', top: 0, left: 0 } : undefined,
                    tooltip: {
                      ...tooltip(c),
                      trigger: 'axis',
                      formatter: (ps: { dataIndex: number }[]) => {
                        const r = recs[ps[0]?.dataIndex ?? 0];
                        if (!r) return '';
                        const shown = rows
                          .map((x) => ({ name: x.name, color: x.color, v: x.value(r) }))
                          .filter((x) => rows.length === 1 || Math.abs(x.v) >= 1);
                        return tooltipCard(c, {
                          title:
                            view.id === 'netWorth' || view.id === 'accounts'
                              ? `End of ${r.year}`
                              : `${r.year}`,
                          subtitle: agesText(r),
                          rows: shown.map((x) => ({ name: x.name, color: x.color, value: formatMoney(x.v) })),
                          total: view.total
                            ? {
                                name: view.total,
                                value: formatMoney(shown.reduce((sum, x) => sum + x.v, 0)),
                              }
                            : undefined,
                          notes: [
                            ...(r.milestones.length ? [{ text: r.milestones.join(', ') }] : []),
                            ...(isShort(r)
                              ? [
                                  {
                                    text: `Spending short by ${formatMoney(flow(r, r.shortfall))}`,
                                    tone: 'danger' as const,
                                  },
                                ]
                              : []),
                          ],
                        });
                      },
                    },
                    xAxis: {
                      type: 'category',
                      data: recs.map((r) => r.year),
                      boundaryGap: view.id !== 'netWorth' && view.id !== 'accounts',
                      ...axis(c),
                      splitLine: { show: false },
                    },
                    yAxis: {
                      type: 'value',
                      ...axis(c),
                      axisLabel: { color: c.ink3, fontSize: 11, formatter: short },
                    },
                    series: view.series(c, recs, rows),
                  };
                }}
              />
            ) : (
              <Skeleton height={260} />
            )}
          </Card>
          {year ? (
            <section
              className="home-year"
              aria-label={`${year.year} at a glance`}
              data-tour="home-year"
              data-live={hover !== null}
            >
              <div className="home-year-when">
                <strong>{year.year}</strong>
                <span>{agesText(year)}</span>
              </div>
              <Stat label="Net worth" value={formatCompact(bal(year, year.netWorth))} />
              <Stat label="Income" value={formatCompact(flow(year, year.income.total))} />
              <Stat label="Spending" value={formatCompact(flow(year, year.expenses.total))} />
              <Stat
                label="Taxes"
                value={formatCompact(flow(year, year.taxes.total))}
                note={`${formatPct(year.taxes.effectiveRate, 1)} of income`}
              />
              <Stat
                label={year.withdrawals.total > year.contributions.total ? 'Withdrawn' : 'Saved'}
                value={formatCompact(flow(year, Math.max(year.withdrawals.total, year.contributions.total)))}
              />
            </section>
          ) : null}
        </div>
      </div>
      <nav className="home-actions" aria-label="Next steps" data-tour="data-home">
        {actions.map((a) => (
          <Link key={a.to} className="home-action" to={a.to} data-tour={a.tour}>
            <IconTile icon={a.icon} />
            <span className="lv-stack" style={{ gap: 0, minWidth: 0 }}>
              <strong>{a.title}</strong>
              <span className="lv-small lv-muted lv-ellipsis">{a.text}</span>
            </span>
            <Icon name="chevron" size={16} />
          </Link>
        ))}
      </nav>
    </>
  );
}
