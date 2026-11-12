import { Button, Card, MoneyField, Stat, TextField, formatCompact, formatMoney, formatPct } from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Chart, axis, short, tooltip } from '../../charts/Chart';
import { useProjection } from '../../engine/useResults';
import { ACCOUNT_LABELS } from '../../lib/fields';
import { PageHead } from '../../shell/Shell';
import { getSetting, setSetting } from '../../state/db';
import { usePlan, useStore, useUpdate } from '../../state/store';

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
    const b: Baseline = {
      takenAt: new Date().toISOString(),
      startYear: plan.settings.startYear,
      points: [
        { year: plan.settings.startYear - 1, investable: result.records[0].check.opening },
        ...result.records.map((r) => ({ year: r.year, investable: r.investable })),
      ],
    };
    setBaseline(b);
    if (!sandbox) void setSetting(`baseline:${plan.id}`, b);
  };
  const log = (): void => {
    const balances: Record<string, number> = {};
    for (const a of plan.accounts)
      balances[a.id] = draft[a.id] ?? plan.actuals.at(-1)?.balances[a.id] ?? a.balance;
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
    t:
      +a.date.slice(0, 4) +
      (new Date(a.date).getTime() - Date.UTC(+a.date.slice(0, 4), 0, 1)) / (365.25 * 86400000) -
      1,
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
  return (
    <>
      <PageHead
        title="Progress"
        intro="Log your real balances from time to time and see how they compare with the plan you set out with."
      />
      <div className="two-col">
        <Card title="Log balances" data-tour="log-actuals">
          <div className="lv-stack">
            <div style={{ maxWidth: 220 }}>
              <TextField label="As of" type="date" value={date} onChange={setDate} />
            </div>
            {plan.accounts.length === 0 ? <p className="lv-muted">Add accounts under Plan first.</p> : null}
            <div className="form-grid">
              {plan.accounts.map((a) => (
                <MoneyField
                  key={a.id}
                  label={a.name}
                  hint={ACCOUNT_LABELS[a.type]}
                  cents={draft[a.id] ?? plan.actuals.at(-1)?.balances[a.id] ?? a.balance}
                  onChange={(v) => setDraft((x) => ({ ...x, [a.id]: Math.max(0, v) }))}
                />
              ))}
            </div>
            <div className="lv-row">
              <Button
                variant="primary"
                onClick={log}
                disabled={
                  !plan.accounts.length ||
                  !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                  !Number.isFinite(Date.parse(date))
                }
                data-tour="save-actuals"
              >
                Save these balances
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Against the plan" data-tour="track-stats">
          {last ? (
            <div className="lv-stack">
              <Stat label={`Actual on ${last.date}`} value={formatCompact(last.total)} />
              {lastPlan !== null ? (
                <Stat
                  label="Plan expected"
                  value={formatCompact(lastPlan)}
                  note={`${last.total >= lastPlan ? 'Above by' : 'Below by'} ${formatCompact(Math.abs(last.total - lastPlan))}${lastPlan !== 0 ? ` (${formatPct(Math.abs(last.total / lastPlan - 1), 1)})` : ''}`}
                />
              ) : null}
            </div>
          ) : (
            <p className="lv-muted">
              Nothing logged yet. Your first entry also freezes the current projection as the reference line.
            </p>
          )}
          <div style={{ marginTop: 16 }} className="lv-stack">
            <p className="lv-muted lv-small">
              {baseline
                ? `Reference projection frozen on ${baseline.takenAt.slice(0, 10)}.`
                : 'No reference projection yet.'}
            </p>
            <div>
              <Button size="sm" onClick={freeze} disabled={!result} data-tour="freeze-baseline">
                {baseline
                  ? 'Replace the reference with today’s plan'
                  : 'Freeze today’s plan as the reference'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
      <Card title="Actual versus planned" data-tour="track-chart">
        <p className="lv-muted lv-small">
          Dots are recorded balances on their stated dates. Gaps may reflect returns, contributions,
          withdrawals or timing; no balances are inferred between observations.
        </p>
        {baseline ? (
          <Chart
            label="Actual investment balances against the frozen plan projection"
            deps={[baseline, plan.actuals]}
            height={340}
            table={() => ({
              columns: ['Date', 'Actual', 'Planned', 'Difference'],
              rows: actuals.map((a) => {
                const p = planned(a.t);
                return [
                  a.date,
                  formatMoney(a.total),
                  p === null ? '—' : formatMoney(p),
                  p === null ? '—' : formatMoney(a.total - p),
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
                  formatter: (p: { seriesName: string; value: [number, number] }) =>
                    `${p.seriesName}<br/>${p.value[0].toFixed(1)}: ${formatMoney(p.value[1])}`,
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
                    data: pts.map((p) => [p.year, Math.round(p.investable)]),
                  },
                  {
                    name: 'Actual',
                    type: 'line',
                    symbolSize: 9,
                    lineStyle: { width: 0 },
                    showSymbol: true,
                    itemStyle: { color: c.primary },
                    data: actuals.map((a) => [+a.t.toFixed(3), Math.round(a.total)]),
                  },
                ],
              };
            }}
          />
        ) : (
          <p className="lv-muted">The chart appears after your first entry.</p>
        )}
      </Card>
      {plan.actuals.length ? (
        <Card title="History" data-tour="actuals-history">
          <ul className="lv-list">
            {[...plan.actuals].reverse().map((a) => (
              <li key={a.date}>
                <span className="lv-grow">{a.date}</span>
                <span className="lv-num">
                  {formatMoney(Object.values(a.balances).reduce((s, v) => s + v, 0) / 100)}
                </span>
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
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
