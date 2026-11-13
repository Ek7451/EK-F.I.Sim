import { explainCashFlow, explainNetWorth, type YearRecord } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  Explain,
  HelpTip,
  KpiStrip,
  Notice,
  Stat,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Chart,
  alpha,
  areaSeries,
  axis,
  dawnFill,
  dawnLine,
  kindColor,
  short,
  tooltip,
  tooltipCard,
} from '../../charts/Chart';
import { useProjection, useProjectionOf } from '../../engine/useResults';
import { outcomeMetrics } from '../../lib/metrics';
import { agesText, fundedStat, isShort } from '../../lib/outcome';
import { PageHead } from '../../shell/Shell';
import { usePlan, useStore } from '../../state/store';
import { useDraft, usePreviewPlan } from '../../state/draft';
import { usePlanView, useSelectedYear } from '../../state/workspace';
import {
  DraftActions,
  EventTimeline,
  PlanningEditor,
  WorkspaceInspector,
  useCompactWorkspace,
} from '../workspace/PlanningTools';
import { useMoney, Loading, RecomputeError, Warnings, YearPicker } from './shared';

export function ProjectionPage(): ReactNode {
  const base = usePlan()!;
  const preview = usePreviewPlan()!;
  const scenarioId = useStore((s) => s.scenarioId);
  const transaction = useDraft((s) => s.transaction);
  const baseline = useProjectionOf(transaction?.base === base ? base : null, scenarioId);
  const { result, ms, error, stale, retry } = useProjection();
  const view = usePlanView();
  const compact = useCompactWorkspace();
  useEffect(() => {
    if (compact) view.set({ inspector: false });
  }, [compact]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = useState(false);
  const [entity, setEntity] = useState<string | null>(null);
  const selectEntity = (id: string): void => {
    setEntity(id);
    setEditing(true);
    view.set({ inspector: true });
  };
  const editPlan = (): void => {
    setEntity(preview.milestones.find((x) => x.kind === 'retirement')?.id ?? null);
    setEditing(true);
    view.set({ inspector: true });
  };
  const m = useMoney();
  const [year, setYear] = useSelectedYear();
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
  const covered = fundedStat(result);
  const endAges = agesText(recs[recs.length - 1]);
  return (
    <>
      <PageHead
        group="explore"
        title="Projection"
        intro={`One path on your expected returns, in ${m.unit}: an estimate, not a forecast.`}
        actions={
          <div className="lv-row">
            <span data-tour="estimate-badges">
              <Badge>{transaction?.base === base ? 'Draft preview' : 'Saved plan'}</Badge>
            </span>
            <Button data-tour="edit-plan" onClick={editPlan} disabled={!!scenarioId}>
              Edit plan
            </Button>
          </div>
        }
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
      <div className="workspace-status" role="status">
        {error ? (
          <Button size="sm" onClick={retry}>
            Retry calculation
          </Button>
        ) : stale ? (
          'Updating · showing last successful projection'
        ) : (
          `Expected-return projection · ${m.unit}`
        )}
      </div>
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
          note={
            <span>
              25× annual spending <HelpTip>{outcomeMetrics.fiYear.description}</HelpTip>
            </span>
          }
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
      <div className="workspace-toolbar">
        <div className="lv-segmented" aria-label="Chart mode">
          <Button aria-pressed={view.mode === 'accounts'} onClick={() => view.set({ mode: 'accounts' })}>
            Accounts
          </Button>
          <Button aria-pressed={view.mode === 'netWorth'} onClick={() => view.set({ mode: 'netWorth' })}>
            Net worth
          </Button>
        </div>
        <div className="lv-row">
          <Button size="sm" onClick={() => view.set({ axis: view.axis === 'year' ? 'age' : 'year' })}>
            {view.axis === 'year' ? 'Show ages' : 'Show years'}
          </Button>
          <Button
            data-tour="workspace-details"
            size="sm"
            onClick={() => view.set({ inspector: !view.inspector })}
          >
            {view.inspector ? 'Hide details' : 'Show details'}
          </Button>
        </div>
      </div>
      <div className="chart-ledger planning-workspace" data-inspector={view.inspector}>
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
            deps={[result, m.real, baseline, view.mode, view.axis]}
            height="var(--chart-h)"
            onClick={(p) => {
              setYear(recs[p.dataIndex]?.year ?? null);
              view.set({ inspector: true });
            }}
            onHover={(p) => view.set({ hoverYear: p ? (recs[p.dataIndex]?.year ?? null) : null })}
            onZoom={(range) => view.set({ range })}
            footer={
              <p className="lv-muted lv-small funded-key">
                <span className="funded-swatch" data-short="false" aria-hidden="true" /> Spending covered{' '}
                <span className="funded-swatch" data-short="true" aria-hidden="true" /> Money runs short.{' '}
                {covered.note}.
              </p>
            }
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
                { left: 56, right: 12, top: 34, bottom: 74 },
                // A thin strip under the year labels: one block per year, marked when spending ran short.
                { left: 52, right: 12, height: 6, bottom: 46 },
              ],
              legend: {
                type: 'scroll',
                top: 0,
                left: 0,
                data: [
                  ...(view.mode === 'accounts' ? series.map((x) => x[0]) : []),
                  'Net worth',
                  ...(baseline ? ['Saved baseline'] : []),
                ],
              },
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
                  data: recs.map((r) => (view.axis === 'age' ? r.ages.join(' / ') : r.year)),
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
                {
                  type: 'inside',
                  start: view.range[0],
                  end: view.range[1],
                  xAxisIndex: [0, 1],
                  zoomOnMouseWheel: 'ctrl',
                  moveOnMouseWheel: false,
                },
                {
                  type: 'slider',
                  xAxisIndex: [0, 1],
                  height: 16,
                  bottom: 4,
                  borderColor: 'transparent',
                  backgroundColor: alpha(c.line, 0.5),
                  borderRadius: 8,
                  fillerColor: alpha(c.dawn[1], 0.2),
                  handleIcon:
                    'path://M-4,-9 h8 a3,3 0 0 1 3,3 v12 a3,3 0 0 1 -3,3 h-8 a3,3 0 0 1 -3,-3 v-12 a3,3 0 0 1 3,-3 z',
                  handleSize: '130%',
                  handleStyle: {
                    color: c.surface,
                    borderColor: c.primary,
                    borderWidth: 1.5,
                    shadowColor: alpha(c.primary, 0.4),
                    shadowBlur: 6,
                  },
                  moveHandleSize: 0,
                  textStyle: { color: c.ink3, fontSize: 10 },
                  dataBackground: {
                    lineStyle: { color: c.ink3, opacity: 0.4 },
                    areaStyle: { color: c.line },
                  },
                },
              ],
              series: [
                ...(view.mode === 'accounts' ? series : []).map(([name, fn, k]) =>
                  areaSeries(
                    name,
                    kindColor(c, k),
                    recs.map((r) => m.bal(r, fn(r))),
                    { stack: name === 'Debts' ? 'owed' : 'owned' },
                  ),
                ),
                ...(baseline
                  ? [
                      {
                        id: 'saved-baseline',
                        name: 'Saved baseline',
                        type: 'line',
                        symbol: 'none',
                        lineStyle: { color: c.ink3, width: 2, type: 'dashed' },
                        color: c.ink3,
                        data: recs.map((r) => {
                          const b = baseline.records.find((x) => x.year === r.year);
                          return b ? m.bal(b, b.netWorth) : null;
                        }),
                        z: 6,
                      },
                    ]
                  : []),
                {
                  name: 'Net worth',
                  type: 'line',
                  symbol: 'circle',
                  symbolSize: 10,
                  showSymbol: false,
                  smooth: false,
                  // In the stacked view the total is the ink line the layers add up to; on its own it is the
                  // plan's headline path and takes the dawn stroke.
                  color: view.mode === 'accounts' ? c.ink : c.dawn[1],
                  itemStyle: { borderColor: '#fff', borderWidth: 2 },
                  lineStyle:
                    view.mode === 'accounts'
                      ? {
                          width: 2.25,
                          color: c.ink,
                          shadowColor: alpha(c.ink, 0.25),
                          shadowBlur: 8,
                          shadowOffsetY: 3,
                        }
                      : dawnLine(c, 3.5),
                  areaStyle: view.mode === 'accounts' ? undefined : dawnFill(c),
                  z: 5,
                  data: recs.map((r) => m.bal(r, r.netWorth)),
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
                      color: isShort(r) ? c.danger : c.series[0],
                      opacity: isShort(r) ? 1 : 0.6,
                      borderRadius: 3,
                    },
                  })),
                },
              ],
            })}
          />
          <EventTimeline
            base={base}
            plan={preview}
            result={result}
            onSelect={selectEntity}
            selected={entity}
          />
        </Card>
        <WorkspaceInspector
          compact={compact}
          open={view.inspector}
          onClose={() => view.set({ inspector: false })}
          footer={
            compact ? (
              <DraftActions base={base} result={result} baseline={baseline} stale={stale} />
            ) : undefined
          }
        >
          {editing ? (
            <PlanningEditor
              base={base}
              plan={preview}
              selected={entity}
              onSelect={setEntity}
              onClose={() => setEditing(false)}
            />
          ) : (
            <Card
              title={`End of ${sel.year}`}
              data-tour="year-detail"
              actions={
                <Button size="sm" onClick={editPlan}>
                  Edit
                </Button>
              }
            >
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
          )}
        </WorkspaceInspector>
      </div>
      {(!compact || !view.inspector) && (
        <DraftActions base={base} result={result} baseline={baseline} stale={stale} />
      )}
    </>
  );
}
