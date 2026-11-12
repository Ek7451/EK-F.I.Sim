import { applyScenario, type Plan, type ProjectionResult, type Scenario } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  KpiStrip,
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
import { useMemo, useState, type ReactNode } from 'react';
import { Chart, axis, short, tooltip } from '../../charts/Chart';
import { useProjectionRequest } from '../../engine/useResults';
import { fundedStat } from '../../lib/outcome';
import { PageHead } from '../../shell/Shell';
import { newId, usePlan, useStore, useUpdate } from '../../state/store';
import { outcomeDelta } from '../../lib/metrics';
import { describeChange } from '../../lib/scenarioSummary';

type Patch = Scenario['patches'][number];

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
        value: plan.assumptions.returns.fixed[k] + value,
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
  const [kind, setKind] = useState(plan.milestones.some((m) => m.kind === 'retirement') ? 'retire' : 'spend');
  const [val, setVal] = useState(plan.milestones.some((m) => m.kind === 'retirement') ? -3 : 0.1);
  const [stateCode, setStateCode] = useState('FL');
  const [name, setName] = useState('');
  const resolve = (key: string): { plan: Plan | null; scenario: string | null } => {
    const [pid, sid] = key.split('|');
    return { plan: pid === plan.id ? plan : (plans[pid] ?? null), scenario: sid || null };
  };
  const ra = resolve(options.some((o) => o.value === a) ? a : options[0].value);
  const rb = resolve(options.some((o) => o.value === b) ? b : options[0].value);
  const suggested = ra.plan === rb.plan && ra.scenario === rb.scenario;
  const experiment = useMemo(
    () => ({
      ...plan,
      scenarios: [
        ...plan.scenarios,
        {
          id: '__preview',
          name: 'Preview',
          patches: variantPatches(
            plan,
            kind,
            kind === 'state' ? stateCode.charCodeAt(0) * 256 + stateCode.charCodeAt(1) : val,
          ),
        },
      ],
    }),
    [plan, kind, val, stateCode],
  );
  const requestA = useProjectionRequest(ra.plan, ra.scenario);
  const requestB = useProjectionRequest(
    suggested ? experiment : rb.plan,
    suggested ? '__preview' : rb.scenario,
  );
  const A = requestA.result;
  const B = requestB.result;
  const labelA = options.find((o) => o.value === a)?.label ?? 'A';
  const labelB = suggested ? 'Suggested experiment' : (options.find((o) => o.value === b)?.label ?? 'B');
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
    ['Net to heirs', (r) => r.estate.netToHeirs / (r.records.at(-1)?.cpiEnd ?? 1), formatMoney, true],
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
    return x ? x.netWorth / x.cpiEnd : null;
  };
  return (
    <>
      <PageHead
        title="Compare scenarios"
        intro="Put two versions of the future side by side. A what-if is a named set of changes on top of your plan, so the plan itself stays as it is."
      />
      {suggested && (
        <Notice>Preview: {defaults[kind].name(val)}. Customize and save this experiment below.</Notice>
      )}
      {(suggested || rb.scenario) && (
        <details className="comparison-changes">
          <summary>What changes in the candidate</summary>
          <ul>
            {(suggested
              ? experiment.scenarios.at(-1)!.patches
              : (rb.plan?.scenarios.find((s) => s.id === rb.scenario)?.patches ?? [])
            ).map((patch, i) => (
              <li key={i}>{describeChange(suggested ? plan : rb.plan!, patch)}</li>
            ))}
          </ul>
        </details>
      )}
      {(requestA.error || requestB.error) && (
        <Notice tone="danger">
          {requestA.error || requestB.error}{' '}
          <Button
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
      <Card title="Side by side" data-tour="compare-pick">
        <div className="form-grid">
          <SelectField label="First" value={a} options={options} onChange={setA} data-tour="compare-a" />
          <SelectField label="Second" value={b} options={options} onChange={setB} data-tour="compare-b" />
        </div>
      </Card>
      {A && B ? (
        <>
          <div className="lv-row">
            <Badge>Baseline: {labelA}</Badge>
            <Badge>Candidate: {labelB}</Badge>
          </div>
          <KpiStrip data-tour="compare-outcomes">
            {(['endingWealth', 'lifetimeTaxes', 'retirement', 'fiYear'] as const).map((key) => {
              const value = outcomeDelta(key, A, B);
              const labels = {
                endingWealth: 'Ending wealth',
                lifetimeTaxes: 'Lifetime taxes',
                retirement: 'Retirement timing',
                fiYear: 'FI timing',
              };
              return (
                <Stat
                  key={key}
                  label={labels[key]}
                  value={
                    value === null
                      ? 'Not comparable'
                      : `${value >= 0 ? '+' : '−'}${key === 'endingWealth' || key === 'lifetimeTaxes' ? formatCompact(Math.abs(value)) : `${Math.abs(value)} yr`}`
                  }
                  note="Candidate minus baseline"
                />
              );
            })}
          </KpiStrip>
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
                    id: 'baseline',
                    name: labelA,
                    type: 'line',
                    symbol: 'none',
                    lineStyle: { width: 2.5, color: c.series[0] },
                    itemStyle: { color: c.series[0] },
                    data: years.map((y) => at(A, y)),
                  },
                  {
                    id: 'candidate',
                    name: labelB,
                    type: 'line',
                    symbol: 'none',
                    lineStyle: { width: 2.5, color: c.series[1], type: 'dashed' },
                    itemStyle: { color: c.series[1] },
                    data: years.map((y) => at(B, y)),
                  },
                ],
              })}
            />
            <p className="lv-muted lv-small">
              Today's dollars. The second line is dashed so the two can be told apart without colour.
            </p>
          </Card>
          <Card title="Annual difference · candidate minus baseline" data-tour="compare-delta">
            <Chart
              label="Annual net worth difference"
              deps={[A, B]}
              height={220}
              table={() => ({
                columns: ['Year', 'Difference'],
                rows: years.map((y) => {
                  const x = at(A, y);
                  const z = at(B, y);
                  return [y, x === null || z === null ? '—' : formatMoney(z - x)];
                }),
              })}
              build={(c) => ({
                grid: { left: 60, right: 16, top: 16, bottom: 32 },
                tooltip: { ...tooltip(c), trigger: 'axis', valueFormatter: (v: number) => formatMoney(v) },
                xAxis: { type: 'category', data: years, ...axis(c) },
                yAxis: { type: 'value', ...axis(c), axisLabel: { formatter: short } },
                series: [
                  {
                    id: 'delta',
                    name: 'Candidate minus baseline',
                    type: 'bar',
                    itemStyle: { color: c.series[3] },
                    data: years.map((y) => {
                      const x = at(A, y);
                      const z = at(B, y);
                      return x === null || z === null ? null : z - x;
                    }),
                  },
                ],
              })}
            />
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
                    <th scope="row">Spending covered</th>
                    <td>{fundedStat(A).value}</td>
                    <td>{fundedStat(B).value}</td>
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
                  {rows.map(([label, f, fmt]) => {
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
                              {label === 'Average tax rate'
                                ? `${(Math.abs(d) * 100).toFixed(1)} pp`
                                : fmt(Math.abs(d))}{' '}
                              {Math.abs(d) > 0 ? <Badge>{d > 0 ? 'higher' : 'lower'}</Badge> : null}
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
      <details className="compare-builder" open={sandbox ? true : undefined}>
        <summary>Customize and save a scenario</summary>
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
                        }).then(() =>
                          notify('Saved as its own plan. Use the plan switcher to open it.', 'ok'),
                        );
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
      </details>
    </>
  );
}
