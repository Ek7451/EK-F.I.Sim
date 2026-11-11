import { applyScenario, type Plan, type ProjectionResult, type Scenario } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  MoneyField,
  Notice,
  NumberField,
  PercentField,
  SelectField,
  Stat,
  TextField,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Chart, axis, short, tooltip } from '../charts/Chart';
import { useMonteCarlo, useProjection, useProjectionOf } from '../engine/useResults';
import { ACCOUNT_LABELS } from '../lib/fields';
import { exportCsv, exportPdf } from '../lib/files';
import { DISCLAIMER } from '../shell/nav';
import { PageHead } from '../shell/Shell';
import { getSetting, setSetting } from '../state/db';
import { newId, usePlan, useStore, useUpdate } from '../state/store';

// ------------------------------------------------------------------ compare (RPT-01, RPT-02)

type Patch = Scenario['patches'][number];

function variantPatches(plan: Plan, kind: string, value: number): Patch[] {
  const out: Patch[] = [];
  if (kind === 'retire')
    plan.milestones.forEach((m, i) => {
      if (m.kind === 'retirement' && m.when.type === 'age')
        out.push({ path: ['milestones', i, 'when', 'age'], value: m.when.age + value });
      else if (m.kind === 'retirement' && m.when.type === 'year')
        out.push({ path: ['milestones', i, 'when', 'year'], value: m.when.year + value });
    });
  if (kind === 'spend')
    plan.expenses.forEach((e, i) =>
      out.push({ path: ['expenses', i, 'amount'], value: Math.round(e.amount * (1 + value)) }),
    );
  if (kind === 'returns')
    (['usStocks', 'intlStocks', 'reits'] as const).forEach((k) =>
      out.push({
        path: ['assumptions', 'returns', 'fixed', k],
        value: plan.assumptions.returns.fixed[k] + value,
      }),
    );
  if (kind === 'claim')
    plan.people.forEach((_, i) => {
      out.push({ path: ['people', i, 'socialSecurity', 'claimAge', 'years'], value });
      out.push({ path: ['people', i, 'socialSecurity', 'claimAge', 'months'], value: 0 });
    });
  if (kind === 'state')
    plan.people.forEach((p, i) =>
      out.push({
        path: ['people', i, 'residence'],
        value: [
          {
            state: String.fromCharCode(Math.floor(value / 256), value % 256),
            fromYear: p.residence[0]?.fromYear ?? plan.settings.startYear,
          },
        ],
      }),
    );
  return out;
}

export function ComparePage(): ReactNode {
  const plan = usePlan()!;
  const update = useUpdate();
  const plans = useStore((s) => s.plans);
  const sandbox = useStore((s) => s.sandbox);
  const { createPlan, notify } = useStore.getState();
  const options = [
    { value: `${plan.id}|`, label: `${plan.name}: as planned` },
    ...plan.scenarios.map((s) => ({ value: `${plan.id}|${s.id}`, label: `${plan.name}: ${s.name}` })),
    ...(sandbox
      ? []
      : Object.values(plans)
          .filter((p) => p.id !== plan.id)
          .map((p) => ({ value: `${p.id}|`, label: p.name }))),
  ];
  const [a, setA] = useState(options[0].value);
  const [b, setB] = useState(options[1]?.value ?? options[0].value);
  const [kind, setKind] = useState('retire');
  const [val, setVal] = useState(-3);
  const [stateCode, setStateCode] = useState('FL');
  const [name, setName] = useState('');
  const resolve = (key: string): { plan: Plan | null; scenario: string | null } => {
    const [pid, sid] = key.split('|');
    return { plan: pid === plan.id ? plan : (plans[pid] ?? null), scenario: sid || null };
  };
  const ra = resolve(options.some((o) => o.value === a) ? a : options[0].value);
  const rb = resolve(options.some((o) => o.value === b) ? b : options[0].value);
  const A = useProjectionOf(ra.plan, ra.scenario);
  const B = useProjectionOf(rb.plan, rb.scenario);
  const labelA = options.find((o) => o.value === a)?.label ?? 'A';
  const labelB = options.find((o) => o.value === b)?.label ?? 'B';
  const defaults: Record<string, { label: string; def: number; name: (v: number) => string }> = {
    retire: {
      label: 'Retire earlier or later (years)',
      def: -3,
      name: (v) => `Retire ${Math.abs(v)} years ${v < 0 ? 'earlier' : 'later'}`,
    },
    spend: {
      label: 'Change all spending',
      def: 0.1,
      name: (v) => `Spend ${Math.abs(Math.round(v * 100))}% ${v < 0 ? 'less' : 'more'}`,
    },
    returns: {
      label: 'Change stock returns',
      def: -0.02,
      name: (v) => `Stocks ${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(1)} pts`,
    },
    claim: { label: 'Claim Social Security at age', def: 70, name: (v) => `Claim Social Security at ${v}` },
    state: { label: 'Live in another state', def: 0, name: () => `Live in ${stateCode}` },
  };
  const addVariant = (): void => {
    const v = kind === 'state' ? stateCode.charCodeAt(0) * 256 + stateCode.charCodeAt(1) : val;
    const patches = variantPatches(plan, kind, v);
    if (!patches.length) {
      notify(
        'This plan has nothing for that what-if to change (for example, no retirement milestone).',
        'warn',
      );
      return;
    }
    const id = newId('s');
    update((d) => {
      d.scenarios.push({ id, name: name.trim() || defaults[kind].name(val), patches });
    });
    setB(`${plan.id}|${id}`);
    setName('');
  };
  const rows: [string, (r: ProjectionResult) => number, (v: number) => string, boolean][] = [
    ['Net worth at the end (today’s dollars)', (r) => r.summary.endingNetWorthReal, formatMoney, true],
    ['Peak net worth', (r) => r.summary.peakNetWorthReal, formatMoney, true],
    ['Lifetime tax', (r) => r.summary.lifetimeTaxReal, formatMoney, false],
    ['Lifetime spending', (r) => r.summary.lifetimeSpendingReal, formatMoney, true],
    ['Average tax rate', (r) => r.summary.averageEffectiveTaxRate, (v) => formatPct(v, 1), false],
    ['Net to heirs', (r) => r.estate.netToHeirs / (r.records.at(-1)?.cpi ?? 1), formatMoney, true],
    [
      'Roth conversions',
      (r) => r.records.reduce((t, x) => t + x.rothConversion / x.cpi, 0),
      formatMoney,
      true,
    ],
    [
      'Healthcare after credits',
      (r) => r.records.reduce((t, x) => t + (x.expenses.healthcare.total - x.taxes.ptc) / x.cpi, 0),
      formatMoney,
      false,
    ],
  ];
  const years =
    A && B
      ? Array.from(new Set([...A.records.map((r) => r.year), ...B.records.map((r) => r.year)])).sort(
          (x, y) => x - y,
        )
      : [];
  const at = (r: ProjectionResult, y: number): number | null => {
    const x = r.records.find((q) => q.year === y);
    return x ? Math.round(x.netWorth / x.cpi) : null;
  };
  return (
    <>
      <PageHead
        title="Compare scenarios"
        intro="Put two versions of the future side by side. A what-if is a named set of changes on top of your plan, so the plan itself stays as it is."
      />
      <Card title="Create a what-if" data-tour="variant-builder">
        <div className="form-grid">
          <SelectField
            label="What changes"
            value={kind}
            options={Object.entries(defaults).map(([value, x]) => ({ value, label: x.label }))}
            onChange={(v) => {
              setKind(v);
              setVal(defaults[v].def);
            }}
            data-tour="variant-kind"
          />
          {kind === 'spend' || kind === 'returns' ? (
            <PercentField label="By" value={val} digits={1} onChange={setVal} />
          ) : kind === 'state' ? (
            <TextField
              label="State (two letters)"
              value={stateCode}
              onChange={(v) => setStateCode(v.toUpperCase().slice(0, 2))}
            />
          ) : (
            <NumberField
              label={kind === 'claim' ? 'Age' : 'Years (negative = earlier)'}
              value={val}
              min={kind === 'claim' ? 62 : -30}
              max={kind === 'claim' ? 70 : 30}
              onChange={setVal}
            />
          )}
          <TextField label="Name (optional)" value={name} onChange={setName} />
        </div>
        <div style={{ marginTop: 12 }}>
          <Button variant="primary" icon="plus" onClick={addVariant} data-tour="add-variant">
            Add what-if
          </Button>
        </div>
        {plan.scenarios.length ? (
          <ul className="lv-list" style={{ marginTop: 12 }} data-tour="variant-list">
            {plan.scenarios.map((s, i) => (
              <li key={s.id}>
                <span className="lv-grow">
                  <strong>{s.name}</strong>{' '}
                  <span className="lv-muted lv-small">
                    {s.patches.length} change{s.patches.length === 1 ? '' : 's'}
                  </span>
                </span>
                {!sandbox ? (
                  <Button
                    size="sm"
                    icon="copy"
                    onClick={() => {
                      void createPlan(`${plan.name}: ${s.name}`, {
                        ...applyScenario(plan, s.id),
                        scenarios: [],
                      }).then(() => notify('Saved as its own plan. Use the plan switcher to open it.', 'ok'));
                    }}
                  >
                    Save as a plan
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  label={`Remove ${s.name}`}
                  onClick={() =>
                    update((d) => {
                      d.scenarios.splice(i, 1);
                    })
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card title="Side by side" data-tour="compare-pick">
        <div className="form-grid">
          <SelectField label="First" value={a} options={options} onChange={setA} data-tour="compare-a" />
          <SelectField label="Second" value={b} options={options} onChange={setB} data-tour="compare-b" />
        </div>
      </Card>
      {A && B ? (
        <>
          <Card title="Net worth" data-tour="compare-chart">
            <Chart
              label={`Net worth over time for ${labelA} and ${labelB}, with the difference`}
              deps={[A, B]}
              height={360}
              table={() => ({
                columns: ['Year', labelA, labelB, 'Difference'],
                rows: years.map((y) => {
                  const x = at(A, y);
                  const z = at(B, y);
                  return [
                    y,
                    x === null ? '—' : formatMoney(x),
                    z === null ? '—' : formatMoney(z),
                    x !== null && z !== null ? formatMoney(z - x) : '—',
                  ];
                }),
              })}
              build={(c) => ({
                grid: { left: 56, right: 16, top: 36, bottom: 32 },
                legend: { type: 'scroll', top: 0, textStyle: { color: c.ink2 } },
                tooltip: {
                  ...tooltip(c),
                  trigger: 'axis',
                  valueFormatter: (v: number) => (v === null || v === undefined ? '—' : formatMoney(v)),
                },
                xAxis: {
                  type: 'category',
                  data: years,
                  boundaryGap: false,
                  ...axis(c),
                  splitLine: { show: false },
                },
                yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
                series: [
                  {
                    name: labelA,
                    type: 'line',
                    symbol: 'none',
                    lineStyle: { width: 2.5, color: c.series[0] },
                    itemStyle: { color: c.series[0] },
                    data: years.map((y) => at(A, y)),
                  },
                  {
                    name: labelB,
                    type: 'line',
                    symbol: 'none',
                    lineStyle: { width: 2.5, color: c.series[1], type: 'dashed' },
                    itemStyle: { color: c.series[1] },
                    data: years.map((y) => at(B, y)),
                  },
                  {
                    name: 'Difference (second − first)',
                    type: 'bar',
                    itemStyle: { color: c.series[2], opacity: 0.45 },
                    data: years.map((y) => {
                      const x = at(A, y);
                      const z = at(B, y);
                      return x !== null && z !== null ? z - x : null;
                    }),
                  },
                ],
              })}
            />
            <p className="lv-muted lv-small">
              Today's dollars. The second line is dashed so the two can be told apart without colour.
            </p>
          </Card>
          <Card title="Key numbers" data-tour="compare-table">
            <div
              className="lv-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Comparison of the two sides"
            >
              <table className="lv-table">
                <thead>
                  <tr>
                    <th scope="col">Measure</th>
                    <th scope="col">{labelA}</th>
                    <th scope="col">{labelB}</th>
                    <th scope="col">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Spending funded</th>
                    <td>{A.summary.success ? 'Every year' : `Until ${A.summary.failedYear}`}</td>
                    <td>{B.summary.success ? 'Every year' : `Until ${B.summary.failedYear}`}</td>
                    <td />
                  </tr>
                  <tr>
                    <th scope="row">Retirement</th>
                    <td>{A.summary.retirementYear ?? '—'}</td>
                    <td>{B.summary.retirementYear ?? '—'}</td>
                    <td>
                      {A.summary.retirementYear && B.summary.retirementYear
                        ? `${B.summary.retirementYear - A.summary.retirementYear} yr`
                        : ''}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Financially independent</th>
                    <td>{A.summary.fiYear ?? 'Not reached'}</td>
                    <td>{B.summary.fiYear ?? 'Not reached'}</td>
                    <td>
                      {A.summary.fiYear && B.summary.fiYear
                        ? `${B.summary.fiYear - A.summary.fiYear} yr`
                        : ''}
                    </td>
                  </tr>
                  {rows.map(([label, f, fmt, moreIsBetter]) => {
                    const x = f(A);
                    const z = f(B);
                    const d = z - x;
                    return (
                      <tr key={label}>
                        <th scope="row">{label}</th>
                        <td>{fmt(x)}</td>
                        <td>{fmt(z)}</td>
                        <td>
                          {Math.abs(d) < 1e-9 ? (
                            '—'
                          ) : (
                            <span>
                              {d > 0 ? '+' : '−'}
                              {fmt(Math.abs(d))}{' '}
                              {Math.abs(d) > 0 ? (
                                <Badge tone={d > 0 === moreIsBetter ? 'ok' : 'warn'}>
                                  {d > 0 ? 'higher' : 'lower'}
                                </Badge>
                              ) : null}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card>
          <p className="lv-muted" role="status">
            Working out both projections…
          </p>
        </Card>
      )}
    </>
  );
}

// ------------------------------------------------------------------ progress tracking (RPT-03)

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
    void getSetting<Baseline>(`baseline:${plan.id}`).then((b) => setBaseline(b ?? null));
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
    for (const a of plan.accounts) balances[a.id] = draft[a.id] ?? a.balance;
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
                disabled={!plan.accounts.length}
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
                  note={`${last.total >= lastPlan ? 'Ahead by' : 'Behind by'} ${formatCompact(Math.abs(last.total - lastPlan))} (${formatPct(Math.abs(last.total / lastPlan - 1), 1)})`}
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
                    lineStyle: { width: 2.5, color: c.primary },
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

// ------------------------------------------------------------------ reports (RPT-04, RPT-05)

export function ReportsPage(): ReactNode {
  const plan = usePlan()!;
  const scenarioId = useStore((s) => s.scenarioId);
  const setScenario = useStore((s) => s.setScenario);
  const { result } = useProjection();
  const [withMc, setWithMc] = useState(false);
  const mc = useMonteCarlo(withMc);
  // The version picked here only applies to reports: go back to "as planned" on the way out.
  useEffect(() => () => setScenario(null), [setScenario]);
  const [busy, setBusy] = useState(false);
  const label = scenarioId
    ? (plan.scenarios.find((s) => s.id === scenarioId)?.name ?? 'what-if')
    : 'as planned';
  const rows = result ? result.records.filter((_, i) => i % 5 === 0 || i === result.records.length - 1) : [];
  return (
    <>
      <PageHead
        title="Reports"
        intro="Take the plan with you. Reports are made on this device; nothing is uploaded."
      />
      <Card title="What to include" data-tour="report-options">
        <div className="form-grid">
          <SelectField
            label="Version of the plan"
            value={scenarioId ?? ''}
            options={[
              { value: '', label: 'As planned' },
              ...plan.scenarios.map((s) => ({ value: s.id, label: s.name })),
            ]}
            onChange={(v) => setScenario(v || null)}
          />
        </div>
        <label className="lv-switch" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            role="switch"
            checked={withMc}
            onChange={(e) => setWithMc(e.target.checked)}
          />
          <span>Include the chance of success (runs the simulation first)</span>
        </label>
        {withMc && mc.running ? (
          <div className="lv-progress" style={{ marginTop: 8 }}>
            <div style={{ width: `${mc.progress * 100}%` }} />
          </div>
        ) : null}
      </Card>
      <div className="lv-grid">
        <Card title="PDF report" data-tour="report-pdf">
          <p className="lv-muted lv-small">
            Summary, net-worth chart, a year-by-year table, assumptions and the disclaimers.
          </p>
          <p style={{ marginTop: 12 }}>
            <Button
              variant="primary"
              icon="download"
              disabled={!result || busy || (withMc && mc.running)}
              onClick={() => {
                if (!result) return;
                setBusy(true);
                void exportPdf(plan, result, withMc ? mc.summary : null, label).finally(() => setBusy(false));
              }}
              data-tour="download-pdf"
            >
              Download PDF
            </Button>
          </p>
        </Card>
        <Card title="Spreadsheet (CSV)" data-tour="report-csv">
          <p className="lv-muted lv-small">
            One row per year with income, withdrawals, spending, taxes and balances, in future dollars with
            the inflation factor alongside.
          </p>
          <p style={{ marginTop: 12 }}>
            <Button
              icon="download"
              disabled={!result}
              onClick={() => result && exportCsv(plan, result, label)}
              data-tour="download-csv"
            >
              Download CSV
            </Button>
          </p>
        </Card>
        <Card title="Print">
          <p className="lv-muted lv-small">Prints this page's preview using your browser.</p>
          <p style={{ marginTop: 12 }}>
            <Button onClick={() => window.print()}>Print</Button>
          </p>
        </Card>
      </div>
      {result ? (
        <Card title={`Preview: ${plan.name} (${label})`} data-tour="report-preview">
          <Notice>{DISCLAIMER}</Notice>
          <div className="lv-grid" style={{ margin: '16px 0' }}>
            <Stat label="Net worth today" value={formatMoney(result.summary.currentNetWorth)} />
            <Stat
              label="At the end of the plan"
              value={formatMoney(result.summary.endingNetWorthReal)}
              note="Today's dollars"
            />
            <Stat label="Lifetime tax" value={formatMoney(result.summary.lifetimeTaxReal)} />
            {withMc && mc.summary ? (
              <Stat
                label="Chance of success"
                value={formatPct(mc.summary.successRate)}
                note={`${mc.summary.runs.toLocaleString()} runs`}
              />
            ) : null}
          </div>
          <div className="lv-table-wrap" tabIndex={0} role="region" aria-label="Report preview, year by year">
            <table className="lv-table">
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col">Age</th>
                  <th scope="col">Income</th>
                  <th scope="col">Withdrawn</th>
                  <th scope="col">Spending</th>
                  <th scope="col">Tax</th>
                  <th scope="col">Net worth</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.year}>
                    <th scope="row">{r.year}</th>
                    <td>{r.ages.join('/')}</td>
                    <td>{formatMoney(r.income.total / r.cpi)}</td>
                    <td>{formatMoney(r.withdrawals.total / r.cpi)}</td>
                    <td>{formatMoney(r.expenses.total / r.cpi)}</td>
                    <td>{formatMoney(r.taxes.total / r.cpi)}</td>
                    <td>{formatMoney(r.netWorth / r.cpi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="lv-muted lv-small" style={{ marginTop: 8 }}>
            Every fifth year shown, in today's dollars. The PDF and CSV carry every year. Data release{' '}
            {result.dataRelease}.
          </p>
        </Card>
      ) : null}
    </>
  );
}
