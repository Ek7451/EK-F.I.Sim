import './track.css';
import {
  Button,
  Card,
  Fold,
  KpiStrip,
  MoneyField,
  Stat,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Chart, alpha, axis, short, tooltip, tooltipCard } from '../../charts/Chart';
import { useProjection } from '../../engine/useResults';
import { ACCOUNT_LABELS } from '../../lib/fields';
import { PageHead } from '../../shell/Shell';
import { getSetting, setSetting } from '../../state/db';
import { usePlan, useStore, useUpdate } from '../../state/store';

/** A calendar date on the chart's time axis, where year y's end sits at y. */
const axisTime = (date: string): number =>
  +date.slice(0, 4) +
  (new Date(date).getTime() - Date.UTC(+date.slice(0, 4), 0, 1)) / (365.25 * 86400000) -
  1;

/** A signed gap with a true minus sign: "+$12,400", "−$3,100". */
const gap = (v: number, fmt: (x: number) => string = formatMoney): string =>
  Math.round(v) === 0 ? fmt(0) : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`;

interface Baseline {
  takenAt: string;
  startYear: number;
  points: { year: number; investable: number }[];
}

export function TrackPage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const { result } = useProjection();
  const sandbox = useStore((s) => s.sandbox);
  const dateId = useId();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  useEffect(() => {
    let live = true;
    setBaseline(null);
    setDraft({});
    void getSetting<Baseline>(`baseline:${plan.id}`).then((b) => {
      if (live) setBaseline(b ?? null);
    });
    return () => {
      live = false;
    };
  }, [plan.id]);
  const freeze = (): void => {
    if (!result) return;
    const takenAt = new Date().toISOString();
    // The opening balances are what you hold on the day you freeze the plan, so the reference path starts
    // there. Anchoring it at 1 January made a plan frozen in November read as months behind on day one.
    const today = axisTime(takenAt.slice(0, 10));
    const start = plan.settings.startYear;
    const b: Baseline = {
      takenAt,
      startYear: start,
      points: [
        {
          year: today > start - 1 && today < start ? today : start - 1,
          investable: result.records[0].check.opening,
        },
        ...result.records.map((r) => ({ year: r.year, investable: r.investable })),
      ],
    };
    setBaseline(b);
    if (!sandbox) void setSetting(`baseline:${plan.id}`, b);
  };
  const balanceOf = (id: string, fallback: number): number =>
    draft[id] ?? plan.actuals.at(-1)?.balances[id] ?? fallback;
  const log = (): void => {
    const balances: Record<string, number> = {};
    for (const a of plan.accounts) balances[a.id] = balanceOf(a.id, a.balance);
    if (!baseline) freeze();
    update((d) => {
      d.actuals = [...d.actuals.filter((x) => x.date !== date), { date, balances }].sort((x, y) =>
        x.date.localeCompare(y.date),
      );
    });
    setDraft({});
  };
  const actuals = plan.actuals.map((a) => ({
    date: a.date,
    t: axisTime(a.date),
    total: Object.values(a.balances).reduce((s, v) => s + v, 0) / 100,
  }));
  const planned = (t: number): number | null => {
    if (!baseline) return null;
    const p = baseline.points;
    if (!p.length || t < p[0].year) return null;
    // Points are year-end values; year y's value sits at y on the time axis (the end of year y).
    for (let i = 1; i < p.length; i++)
      if (t <= p[i].year)
        return (
          p[i - 1].investable +
          ((p[i].investable - p[i - 1].investable) * (t - p[i - 1].year)) / (p[i].year - p[i - 1].year)
        );
    return null;
  };
  const last = actuals.at(-1);
  const lastPlan = last ? planned(last.t) : null;
  /** Latest entry against the frozen path, to the dollar; null before the reference begins. */
  const diff = last && lastPlan !== null ? Math.round(last.total - lastPlan) : null;
  const entering = plan.accounts.reduce((s, a) => s + balanceOf(a.id, a.balance), 0) / 100;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date));
  return (
    <>
      <PageHead
        title="Progress"
        intro="Log your real balances from time to time and see how they compare with the plan you set out with."
      />
      <div className="trk-workspace">
        <div className="trk-side">
          <Card
            title="Log balances"
            actions={
              <label className="trk-date" htmlFor={dateId}>
                <span>As of</span>
                <input
                  id={dateId}
                  className="lv-input"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            }
            data-tour="log-actuals"
          >
            {plan.accounts.length === 0 ? <p className="lv-muted">Add accounts under Plan first.</p> : null}
            <div className="trk-grid">
              {plan.accounts.map((a) => (
                <MoneyField
                  key={a.id}
                  label={a.name}
                  hint={ACCOUNT_LABELS[a.type]}
                  help={null}
                  cents={balanceOf(a.id, a.balance)}
                  onChange={(v) => setDraft((x) => ({ ...x, [a.id]: Math.max(0, v) }))}
                />
              ))}
            </div>
            <div className="trk-save">
              <span className="lv-small lv-muted">
                Total <strong className="lv-num">{formatMoney(entering)}</strong>
              </span>
              <Button
                variant="primary"
                onClick={log}
                disabled={!plan.accounts.length || !dateOk}
                data-tour="save-actuals"
              >
                Save these balances
              </Button>
            </div>
          </Card>
          {plan.actuals.length ? (
            <Fold
              title="Logged entries"
              icon="calendar"
              summary={`${plan.actuals.length} ${plan.actuals.length === 1 ? 'entry' : 'entries'} · latest ${plan.actuals.at(-1)!.date}`}
              defaultOpen={plan.actuals.length <= 4}
              data-tour="actuals-history"
            >
              <div
                className="lv-table-wrap trk-history"
                tabIndex={0}
                role="region"
                aria-label="Logged entries"
              >
                <table className="lv-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Actual</th>
                      <th scope="col">Against plan</th>
                      <th scope="col">
                        <span className="lv-sr">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...actuals].reverse().map((a) => {
                      const p = planned(a.t);
                      return (
                        <tr key={a.date}>
                          <th scope="row">{a.date}</th>
                          <td>{formatMoney(a.total)}</td>
                          <td>{p === null ? '—' : gap(a.total - p)}</td>
                          <td>
                            <Button
                              size="sm"
                              variant="ghost"
                              icon="trash"
                              label={`Remove ${a.date}`}
                              onClick={() =>
                                update((d) => {
                                  d.actuals = d.actuals.filter((x) => x.date !== a.date);
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Fold>
          ) : null}
        </div>
        <div className="trk-main">
          <KpiStrip data-tour="track-stats">
            {last ? (
              <>
                <Stat
                  label="Latest actual"
                  value={formatCompact(last.total)}
                  note={`Logged ${last.date}`}
                  icon="wallet"
                />
                <Stat
                  label="Plan expected"
                  value={lastPlan !== null ? formatCompact(lastPlan) : '—'}
                  note={lastPlan !== null ? 'On that date' : 'Before the reference'}
                  icon="target"
                />
                <Stat
                  label={
                    diff === null || diff === 0
                      ? 'Against the plan'
                      : diff < 0
                        ? 'Below the plan'
                        : 'Above the plan'
                  }
                  value={diff === null ? '—' : diff === 0 ? 'On plan' : gap(diff, formatCompact)}
                  note={
                    diff === null
                      ? undefined
                      : diff === 0
                        ? 'Matches the plan'
                        : lastPlan
                          ? `${diff > 0 ? 'Above by' : 'Below by'} ${formatPct(Math.abs(diff / lastPlan), 1)}`
                          : undefined
                  }
                  icon={diff !== null && diff < 0 ? 'trendDown' : 'trendUp'}
                />
              </>
            ) : (
              <div className="trk-empty-stat">
                <strong>Nothing logged yet</strong>
                <span>Your first entry also freezes the current projection as the reference line.</span>
              </div>
            )}
            <div className="trk-ref">
              <span className="lv-stat-label">Reference projection</span>
              <span className="trk-ref-when">
                {baseline ? `Frozen on ${baseline.takenAt.slice(0, 10)}` : 'Not frozen yet'}
              </span>
              <Button
                size="sm"
                onClick={freeze}
                disabled={!result}
                title={
                  baseline
                    ? 'Replace the reference with today’s plan'
                    : 'Freeze today’s plan as the reference'
                }
                data-tour="freeze-baseline"
              >
                {baseline ? 'Replace with today’s plan' : 'Freeze today’s plan'}
              </Button>
            </div>
          </KpiStrip>
          <Card title="Actual versus planned" data-tour="track-chart">
            {baseline ? (
              <Chart
                label="Actual investment balances against the frozen plan projection"
                deps={[baseline, plan.actuals]}
                height="var(--trk-chart-h)"
                footer={
                  <span className="lv-muted lv-small trk-note">
                    Dots are balances on their stated dates; nothing is inferred between them. Gaps can come
                    from returns, contributions, withdrawals or timing.
                  </span>
                }
                table={() => ({
                  columns: ['Date', 'Actual', 'Planned', 'Difference'],
                  rows: actuals.map((a) => {
                    const p = planned(a.t);
                    return [
                      a.date,
                      formatMoney(a.total),
                      p === null ? '—' : formatMoney(p),
                      p === null ? '—' : gap(a.total - p),
                    ];
                  }),
                })}
                build={(c) => {
                  const horizon = Math.max(baseline.startYear + 9, Math.ceil((last?.t ?? 0) + 2));
                  const pts = baseline.points.filter((p) => p.year <= horizon);
                  return {
                    grid: { left: 56, right: 16, top: 36, bottom: 32 },
                    legend: { type: 'scroll', top: 0, textStyle: { color: c.ink2 } },
                    tooltip: {
                      ...tooltip(c),
                      trigger: 'item',
                      formatter: (p: { seriesName: string; dataIndex: number; value: [number, number] }) =>
                        tooltipCard(c, {
                          title: p.seriesName,
                          rows: [
                            {
                              // An entry is labelled by its date; a planned point by the year it closes.
                              name:
                                p.seriesName === 'Actual'
                                  ? (actuals[p.dataIndex]?.date ?? '')
                                  : Number.isInteger(p.value[0])
                                    ? `End of ${p.value[0]}`
                                    : 'When the plan was frozen',
                              value: formatMoney(p.value[1]),
                            },
                          ],
                        }),
                    },
                    xAxis: {
                      type: 'value',
                      min: baseline.startYear - 1,
                      max: horizon,
                      ...axis(c),
                      axisLabel: {
                        color: c.ink3,
                        formatter: (v: number) => (Number.isInteger(v) ? `end ${v}` : ''),
                      },
                      splitLine: { show: false },
                    },
                    yAxis: {
                      type: 'value',
                      scale: true,
                      ...axis(c),
                      axisLabel: { color: c.ink3, formatter: short },
                    },
                    series: [
                      {
                        name: 'Planned (future dollars)',
                        type: 'line',
                        symbol: 'none',
                        lineStyle: { width: 2, type: 'dashed', color: c.ink3 },
                        itemStyle: { color: c.ink3 },
                        areaStyle: {
                          color: {
                            type: 'linear',
                            x: 0,
                            y: 0,
                            x2: 0,
                            y2: 1,
                            colorStops: [
                              { offset: 0, color: alpha(c.dawn[0], 0.14) },
                              { offset: 1, color: alpha(c.dawn[0], 0) },
                            ],
                          },
                        },
                        data: pts.map((p) => [p.year, Math.round(p.investable)]),
                      },
                      {
                        name: 'Actual',
                        type: 'line',
                        symbolSize: 11,
                        lineStyle: { width: 0 },
                        showSymbol: true,
                        itemStyle: {
                          color: c.dawn[2],
                          borderColor: '#fff',
                          borderWidth: 2,
                          shadowColor: c.dawn[2],
                          shadowBlur: 12,
                        },
                        data: actuals.map((a) => [+a.t.toFixed(3), Math.round(a.total)]),
                      },
                    ],
                  };
                }}
              />
            ) : (
              <div className="trk-empty">
                <svg viewBox="0 0 320 120" aria-hidden="true" focusable="false">
                  <path className="trk-empty-plan" d="M8 104 C 80 96 140 78 196 54 S 280 20 312 12" />
                  <circle cx="52" cy="92" r="6" />
                  <circle cx="118" cy="84" r="6" />
                  <circle cx="186" cy="52" r="6" />
                </svg>
                <p>The chart appears after your first entry.</p>
                <p className="lv-small lv-muted">
                  Dots are recorded balances on their stated dates. Gaps may reflect returns, contributions,
                  withdrawals or timing; no balances are inferred between observations.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
