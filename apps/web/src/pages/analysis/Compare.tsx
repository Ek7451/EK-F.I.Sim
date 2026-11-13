import './compare.css';
import { applyScenario, type Plan, type ProjectionResult, type Scenario } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  Fold,
  KpiStrip,
  Notice,
  Segmented,
  SelectField,
  Slider,
  Stat,
  TextField,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Chart, alpha, axis, dawnFill, dawnLine, short, tooltip } from '../../charts/Chart';
import { useProjectionRequest } from '../../engine/useResults';
import { STATES } from '../../lib/fields';
import { fundedStat } from '../../lib/outcome';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan, useStore, useUpdate } from '../../state/store';
import { outcomeDelta, outcomeMetrics } from '../../lib/metrics';
import { describeChange } from '../../lib/scenarioSummary';

type Patch = Scenario['patches'][number];
type View = 'chart' | 'delta' | 'table';

/** The second side when it is the what-if being built, not a saved one. */
const LIVE = '__live';

/** Money with a true minus sign in front of the dollar: "−$461,673", never "-$461,673" or "−$0". */
const money = (v: number): string => (Math.round(v) < 0 ? `−${formatMoney(-v)}` : formatMoney(v));
const compactMoney = (v: number): string => (Math.round(v) < 0 ? `−${formatCompact(-v)}` : formatCompact(v));
const pct = (v: number): string => (v < -0.0005 ? `−${formatPct(-v, 1)}` : formatPct(Math.abs(v), 1));
/** A signed difference: "+$34,402", "−3 yr". */
const signed = (v: number, body: string): string => `${v > 0 ? '+' : '−'}${body}`;
const points = (v: number): string => `${+(Math.abs(v) * 100).toFixed(2)}`;

function variantPatches(plan: Plan, kind: string, value: number): Patch[] {
  const out: Patch[] = [];
  if (kind === 'retire')
    plan.milestones.forEach((m) => {
      if (m.kind === 'retirement' && m.when.type === 'age')
        out.push({ path: ['milestones', `@${m.id}`, 'when', 'age'], value: m.when.age + value });
      else if (m.kind === 'retirement' && m.when.type === 'year')
        out.push({ path: ['milestones', `@${m.id}`, 'when', 'year'], value: m.when.year + value });
    });
  if (kind === 'spend')
    plan.expenses.forEach((e) =>
      out.push({ path: ['expenses', `@${e.id}`, 'amount'], value: Math.round(e.amount * (1 + value)) }),
    );
  if (kind === 'returns')
    (['usStocks', 'intlStocks', 'reits'] as const).forEach((k) =>
      out.push({
        path: ['assumptions', 'returns', 'fixed', k],
        value: +(plan.assumptions.returns.fixed[k] + value).toFixed(6),
      }),
    );
  if (kind === 'claim')
    plan.people.forEach((person) => {
      out.push({ path: ['people', `@${person.id}`, 'socialSecurity', 'claimAge', 'years'], value });
      out.push({ path: ['people', `@${person.id}`, 'socialSecurity', 'claimAge', 'months'], value: 0 });
    });
  if (kind === 'state')
    plan.people.forEach((p) =>
      out.push({
        path: ['people', `@${p.id}`, 'residence'],
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

/** The last finished result, so a chart stays on screen (marked as updating) while the next one is worked out. */
function useHeld<T>(value: T | null, reset: unknown): { shown: T | null; stale: boolean } {
  const held = useRef<{ value: T | null; reset: unknown }>({ value: null, reset });
  if (held.current.reset !== reset) held.current = { value: null, reset };
  if (value) held.current.value = value;
  return { shown: value ?? held.current.value, stale: !value && !!held.current.value };
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
  const hasRetirement = plan.milestones.some((m) => m.kind === 'retirement');
  const [a, setA] = useState(options[0].value);
  const [b, setB] = useState(options[1]?.value ?? LIVE);
  const [kind, setKind] = useState(hasRetirement ? 'retire' : 'spend');
  const [val, setVal] = useState(hasRetirement ? -3 : 0.1);
  const [stateCode, setStateCode] = useState('FL');
  const [name, setName] = useState('');
  const [view, setView] = useState<View>('chart');
  // The builder starts open where it sits beside the results, and folded where it would push them down.
  const [wide] = useState(() => window.matchMedia('(min-width: 1101px)').matches);
  const resolve = (key: string): { plan: Plan | null; scenario: string | null } => {
    const [pid, sid] = key.split('|');
    return { plan: pid === plan.id ? plan : (plans[pid] ?? null), scenario: sid || null };
  };
  const keyA = options.some((o) => o.value === a) ? a : options[0].value;
  const keyB = b === LIVE || options.some((o) => o.value === b) ? b : LIVE;
  const ra = resolve(keyA);
  const rb = keyB === LIVE ? ra : resolve(keyB);
  // Nothing saved to put on the second side (or the same thing on both): show the what-if being built.
  const live = keyB === LIVE || (ra.plan === rb.plan && ra.scenario === rb.scenario);
  const encoded = kind === 'state' ? stateCode.charCodeAt(0) * 256 + stateCode.charCodeAt(1) : val;
  const experiment = useMemo(
    () => ({
      ...plan,
      scenarios: [
        ...plan.scenarios,
        { id: '__preview', name: 'Preview', patches: variantPatches(plan, kind, encoded) },
      ],
    }),
    [plan, kind, encoded],
  );
  const requestA = useProjectionRequest(ra.plan, ra.scenario);
  const requestB = useProjectionRequest(live ? experiment : rb.plan, live ? '__preview' : rb.scenario);
  const heldA = useHeld(requestA.result, keyA);
  const heldB = useHeld(requestB.result, live ? LIVE : keyB);
  const A = heldA.shown;
  const B = heldB.shown;
  const updating = heldA.stale || heldB.stale;

  const defaults: Record<string, { label: string; def: number; name: (v: number) => string }> = {
    retire: {
      label: 'Retire earlier or later',
      def: -3,
      name: (v) =>
        v === 0
          ? 'Retire as planned'
          : `Retire ${Math.abs(v)} year${Math.abs(v) === 1 ? '' : 's'} ${v < 0 ? 'earlier' : 'later'}`,
    },
    spend: {
      label: 'Change all spending',
      def: 0.1,
      name: (v) => `Spend ${Math.abs(Math.round(v * 100))}% ${v < 0 ? 'less' : 'more'}`,
    },
    returns: {
      label: 'Change stock returns',
      def: -0.02,
      name: (v) => `Stocks ${v < 0 ? '−' : '+'}${points(v)} pts`,
    },
    claim: { label: 'Claim Social Security at age', def: 70, name: (v) => `Claim Social Security at ${v}` },
    state: { label: 'Live in another state', def: 0, name: () => `Live in ${stateCode}` },
  };
  const whatIf = defaults[kind].name(val);
  const labelA = options.find((o) => o.value === keyA)?.label ?? 'A';
  const labelB = live ? `${whatIf} (not saved)` : (options.find((o) => o.value === keyB)?.label ?? 'B');
  /** Any change to the builder puts the unsaved what-if on the second side, so the results follow the controls. */
  const tune = (fn: () => void): void => {
    fn();
    setB(LIVE);
  };
  const addVariant = (): void => {
    const patches = variantPatches(plan, kind, encoded);
    if (!patches.length) {
      notify(
        'This plan has nothing for that what-if to change (for example, no retirement milestone).',
        'warn',
      );
      return;
    }
    const id = newId('s');
    update((d) => {
      d.scenarios.push({ id, name: name.trim() || whatIf, patches });
    });
    setB(`${plan.id}|${id}`);
    setName('');
  };
  const candidatePatches = live
    ? experiment.scenarios.at(-1)!.patches
    : (rb.plan?.scenarios.find((s) => s.id === rb.scenario)?.patches ?? []);

  const rows: [string, (r: ProjectionResult) => number, (v: number) => string][] = [
    ['Net worth at the end', (r) => r.summary.endingNetWorthReal, money],
    ['Peak net worth', (r) => r.summary.peakNetWorthReal, money],
    ['Lifetime tax', (r) => r.summary.lifetimeTaxReal, money],
    ['Lifetime spending', (r) => r.summary.lifetimeSpendingReal, money],
    ['Average tax rate', (r) => r.summary.averageEffectiveTaxRate, pct],
    ['Net to heirs', (r) => r.estate.netToHeirs / (r.records.at(-1)?.cpiEnd ?? 1), money],
    ['Roth conversions', (r) => r.records.reduce((t, x) => t + x.rothConversion / x.cpi, 0), money],
    [
      'Healthcare after credits',
      (r) => r.records.reduce((t, x) => t + (x.expenses.healthcare.total - x.taxes.ptc) / x.cpi, 0),
      money,
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
    return x ? x.netWorth / x.cpiEnd : null;
  };
  /** A year on each side: the difference in years, or why there is none to give. */
  const yearDiff = (x: number | null, z: number | null): ReactNode => {
    if (!x || !z) return <span className="lv-muted">—</span>;
    if (x === z) return <span className="lv-muted">Same</span>;
    return (
      <span>
        {signed(z - x, `${Math.abs(z - x)} yr`)} <Badge>{z < x ? 'earlier' : 'later'}</Badge>
      </span>
    );
  };

  const panel = (id: View, label: string, body: ReactNode): ReactNode => (
    // Each view is a <details> so that the guided tours, which open folded sections around their target, can
    // bring it forward; the switch above is the control people use.
    <details
      className="cmp-view"
      open={view === id}
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) setView(id);
      }}
    >
      <summary>{label}</summary>
      {body}
    </details>
  );

  return (
    <>
      <PageHead
        title="Compare scenarios"
        intro="Put two versions of the future side by side. A what-if is a named set of changes on top of your plan, so the plan itself stays as it is."
      />
      {(requestA.error || requestB.error) && (
        <Notice tone="danger">
          {requestA.error || requestB.error}{' '}
          <Button
            size="sm"
            onClick={() => {
              requestA.retry();
              requestB.retry();
            }}
          >
            Retry comparison
          </Button>
        </Notice>
      )}
      {A && B && A.summary.startYear !== B.summary.startYear && (
        <Notice tone="warn">
          These plans use different purchasing-power base years. Real-dollar values are not aligned;
          differences need that context.
        </Notice>
      )}
      <div className="cmp-workspace">
        <aside className="cmp-side" aria-label="What to compare">
          <Fold
            title="Create a what-if"
            icon="sparkle"
            kind="milestone"
            summary={whatIf}
            defaultOpen={wide || !!sandbox}
            data-tour="variant-builder"
          >
            <div className="cmp-builder">
              <SelectField
                label="What changes"
                value={kind}
                options={Object.entries(defaults).map(([value, x]) => ({ value, label: x.label }))}
                onChange={(v) =>
                  tune(() => {
                    setKind(v);
                    setVal(defaults[v].def);
                  })
                }
                data-tour="variant-kind"
              />
              {kind === 'retire' ? (
                <Slider
                  label="Retirement moves by"
                  help={null}
                  value={val}
                  min={-15}
                  max={15}
                  step={1}
                  format={(v) => (v === 0 ? 'No change' : `${Math.abs(v)} yr ${v < 0 ? 'earlier' : 'later'}`)}
                  onChange={(v) => tune(() => setVal(v))}
                />
              ) : kind === 'spend' ? (
                <Slider
                  label="All spending changes by"
                  help={null}
                  value={val}
                  min={-0.5}
                  max={0.5}
                  step={0.01}
                  format={(v) =>
                    Math.round(v * 100) === 0 ? 'No change' : signed(v, formatPct(Math.abs(v)))
                  }
                  onChange={(v) => tune(() => setVal(v))}
                />
              ) : kind === 'returns' ? (
                <Slider
                  label="Stock returns change by"
                  help={null}
                  value={val}
                  min={-0.05}
                  max={0.05}
                  step={0.0025}
                  format={(v) => (Math.abs(v) < 1e-9 ? 'No change' : `${signed(v, points(v))} pts`)}
                  onChange={(v) => tune(() => setVal(v))}
                />
              ) : kind === 'claim' ? (
                <Slider
                  label="Claiming age"
                  help={null}
                  value={val}
                  min={62}
                  max={70}
                  step={1}
                  format={(v) => `Age ${v}`}
                  onChange={(v) => tune(() => setVal(v))}
                />
              ) : (
                <SelectField
                  label="State"
                  value={stateCode}
                  options={STATES.map((s) => ({ value: s, label: s }))}
                  onChange={(v) => tune(() => setStateCode(v))}
                />
              )}
              <div className="cmp-save">
                <TextField label="Name (optional)" value={name} onChange={setName} />
                <Button variant="primary" icon="plus" onClick={addVariant} data-tour="add-variant">
                  Add what-if
                </Button>
              </div>
              <p className="lv-small lv-muted">
                The results follow these controls as you move them. Add it to keep it as a named what-if.
              </p>
              {plan.scenarios.length ? (
                <ul className="lv-list cmp-saved" data-tour="variant-list">
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
                          variant="ghost"
                          icon="copy"
                          label={`Save ${s.name} as its own plan`}
                          onClick={() => {
                            void createPlan(`${plan.name}: ${s.name}`, {
                              ...applyScenario(plan, s.id),
                              scenarios: [],
                            }).then(() =>
                              notify('Saved as its own plan. Use the plan switcher to open it.', 'ok'),
                            );
                          }}
                        />
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
            </div>
          </Fold>
          <Card title="Side by side" data-tour="compare-pick">
            <div className="cmp-pick">
              <SelectField
                label="First"
                value={keyA}
                options={options}
                onChange={setA}
                data-tour="compare-a"
              />
              <SelectField
                label="Second"
                value={keyB}
                options={[...options, { value: LIVE, label: 'The what-if above (not saved)' }]}
                onChange={setB}
                data-tour="compare-b"
              />
            </div>
            {candidatePatches.length ? (
              <details className="comparison-changes cmp-changes">
                <summary>
                  What changes in the second ({candidatePatches.length} input
                  {candidatePatches.length === 1 ? '' : 's'})
                </summary>
                <ul>
                  {candidatePatches.map((patch, i) => (
                    <li key={i}>{describeChange(live ? plan : rb.plan!, patch)}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
        </aside>
        {A && B ? (
          <div className="cmp-main" data-updating={updating} aria-busy={updating}>
            <KpiStrip data-tour="compare-outcomes">
              {(['endingWealth', 'lifetimeTaxes', 'retirement', 'fiYear'] as const).map((key) => {
                const value = outcomeDelta(key, A, B);
                const isMoney = key === 'endingWealth' || key === 'lifetimeTaxes';
                const x = outcomeMetrics[key].value(A);
                const z = outcomeMetrics[key].value(B);
                const side = (v: number | null): string =>
                  v === null
                    ? key === 'fiYear'
                      ? 'not reached'
                      : 'none'
                    : isMoney
                      ? compactMoney(v)
                      : String(v);
                const labels = {
                  endingWealth: 'Ending wealth',
                  lifetimeTaxes: 'Lifetime taxes',
                  retirement: 'Retirement',
                  fiYear: 'Financial independence',
                };
                return (
                  <Stat
                    key={key}
                    label={labels[key]}
                    value={
                      value === null
                        ? '—'
                        : (isMoney ? Math.round(value) : value) === 0
                          ? 'No change'
                          : isMoney
                            ? signed(value, formatCompact(Math.abs(value)))
                            : `${Math.abs(value)} yr ${value < 0 ? 'earlier' : 'later'}`
                    }
                    note={`${side(x)} → ${side(z)}`}
                  />
                );
              })}
            </KpiStrip>
            <section className="lv-card cmp-results" aria-label="Comparison results">
              <header className="cmp-results-head">
                <Segmented
                  label="What to show"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'chart', label: 'Net worth' },
                    { value: 'delta', label: 'Annual difference' },
                    { value: 'table', label: 'Key numbers' },
                  ]}
                />
                <span className="cmp-legend">
                  <span className="cmp-key" data-side="a" title={labelA}>
                    <i aria-hidden="true" />
                    <span className="lv-ellipsis">{labelA}</span>
                  </span>
                  <span className="cmp-key" data-side="b" title={labelB}>
                    <i aria-hidden="true" />
                    <span className="lv-ellipsis">{labelB}</span>
                  </span>
                  <span className="lv-small lv-muted" role="status">
                    {updating ? 'Updating…' : ''}
                  </span>
                </span>
              </header>
              {panel(
                'chart',
                'Net worth',
                <div className="cmp-plot" data-tour="compare-chart">
                  {view === 'chart' ? (
                    <Chart
                      label={`Net worth over time for ${labelA} and ${labelB}, with the difference`}
                      deps={[A, B, labelA, labelB]}
                      height="var(--cmp-chart-h)"
                      footer={
                        <span className="lv-muted lv-small">
                          Today's dollars. The first line is dashed so the two can be told apart without
                          colour.
                        </span>
                      }
                      table={() => ({
                        columns: ['Year', labelA, labelB, 'Difference'],
                        rows: years.map((y) => {
                          const x = at(A, y);
                          const z = at(B, y);
                          return [
                            y,
                            x === null ? '—' : money(x),
                            z === null ? '—' : money(z),
                            x !== null && z !== null ? money(z - x) : '—',
                          ];
                        }),
                      })}
                      build={(c) => ({
                        grid: { left: 56, right: 16, top: 14, bottom: 28 },
                        tooltip: {
                          ...tooltip(c),
                          trigger: 'axis',
                          valueFormatter: (v: number | null) =>
                            v === null || v === undefined ? '—' : money(v),
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
                            id: 'baseline',
                            name: labelA,
                            type: 'line',
                            symbol: 'none',
                            z: 3,
                            lineStyle: { width: 2, color: c.financial.baseline, type: [6, 5] },
                            itemStyle: { color: c.financial.baseline },
                            data: years.map((y) => at(A, y)),
                          },
                          {
                            id: 'candidate',
                            name: labelB,
                            type: 'line',
                            symbol: 'none',
                            z: 2,
                            lineStyle: dawnLine(c, 3),
                            itemStyle: { color: c.dawn[1] },
                            areaStyle: dawnFill(c, 0.26),
                            data: years.map((y) => at(B, y)),
                          },
                        ],
                      })}
                    />
                  ) : null}
                </div>,
              )}
              {panel(
                'delta',
                'Annual difference',
                <div className="cmp-plot" data-tour="compare-delta">
                  {view === 'delta' ? (
                    <Chart
                      label="Annual net worth difference"
                      deps={[A, B]}
                      height="var(--cmp-chart-h)"
                      footer={
                        <span className="lv-muted lv-small">
                          Net worth each year, second minus first, in today's dollars.
                        </span>
                      }
                      table={() => ({
                        columns: ['Year', 'Difference'],
                        rows: years.map((y) => {
                          const x = at(A, y);
                          const z = at(B, y);
                          return [y, x === null || z === null ? '—' : money(z - x)];
                        }),
                      })}
                      build={(c) => ({
                        grid: { left: 60, right: 16, top: 14, bottom: 28 },
                        tooltip: {
                          ...tooltip(c),
                          trigger: 'axis',
                          valueFormatter: (v: number | null) =>
                            v === null || v === undefined ? '—' : money(v),
                        },
                        xAxis: { type: 'category', data: years, ...axis(c), splitLine: { show: false } },
                        yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
                        series: [
                          {
                            id: 'delta',
                            name: 'Second minus first',
                            type: 'bar',
                            barCategoryGap: '24%',
                            data: years.map((y) => {
                              const x = at(A, y);
                              const z = at(B, y);
                              if (x === null || z === null) return null;
                              const d = z - x;
                              const color = d < 0 ? c.dawn[2] : c.dawn[0];
                              return {
                                value: d,
                                itemStyle: {
                                  color: {
                                    type: 'linear',
                                    x: 0,
                                    y: d < 0 ? 1 : 0,
                                    x2: 0,
                                    y2: d < 0 ? 0 : 1,
                                    colorStops: [
                                      { offset: 0, color },
                                      { offset: 1, color: alpha(color, 0.55) },
                                    ],
                                  },
                                  borderRadius: d < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0],
                                },
                              };
                            }),
                          },
                        ],
                      })}
                    />
                  ) : null}
                </div>,
              )}
              {panel(
                'table',
                'Key numbers',
                <div data-tour="compare-table">
                  <div
                    className="lv-table-wrap cmp-table"
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
                          <th scope="row">Spending covered</th>
                          <td>{fundedStat(A).value}</td>
                          <td>{fundedStat(B).value}</td>
                          <td>
                            <span className="lv-muted">
                              {fundedStat(A).value === fundedStat(B).value ? 'Same' : '—'}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Retirement</th>
                          <td>{A.summary.retirementYear ?? '—'}</td>
                          <td>{B.summary.retirementYear ?? '—'}</td>
                          <td>{yearDiff(A.summary.retirementYear, B.summary.retirementYear)}</td>
                        </tr>
                        <tr>
                          <th scope="row">Financially independent</th>
                          <td>{A.summary.fiYear ?? 'Not reached'}</td>
                          <td>{B.summary.fiYear ?? 'Not reached'}</td>
                          <td>{yearDiff(A.summary.fiYear, B.summary.fiYear)}</td>
                        </tr>
                        {rows.map(([label, f, fmt]) => {
                          const x = f(A);
                          const z = f(B);
                          const d = z - x;
                          const rate = label === 'Average tax rate';
                          const same = rate ? Math.abs(d) < 0.0005 : Math.abs(d) < 0.5;
                          return (
                            <tr key={label}>
                              <th scope="row">{label}</th>
                              <td>{fmt(x)}</td>
                              <td>{fmt(z)}</td>
                              <td>
                                {same ? (
                                  <span className="lv-muted">Same</span>
                                ) : (
                                  <span>
                                    {signed(
                                      d,
                                      rate
                                        ? `${(Math.abs(d) * 100).toFixed(1)} pp`
                                        : formatMoney(Math.abs(d)),
                                    )}{' '}
                                    <Badge>{d > 0 ? 'higher' : 'lower'}</Badge>
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="lv-muted lv-small cmp-note">
                    Money in today's dollars. Difference is the second column minus the first; pp is
                    percentage points.
                  </p>
                </div>,
              )}
            </section>
          </div>
        ) : (
          <Card>
            <p className="lv-muted" role="status">
              Working out both projections…
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
