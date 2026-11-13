import './taxes.css';
import {
  explainTax,
  type EngineData,
  type Plan,
  type ProjectionResult,
  type YearRecord,
} from '@fisim/engine';
import { Badge, Button, Card, Explain, Icon, Stat, formatCompact, formatMoney, formatPct } from '@fisim/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart, alpha, axis, short, tooltip } from '../../charts/Chart';
import { loadDataBundle } from '../../engine/load';
import { useProjection } from '../../engine/useResults';
import { buildBreakdown, type BreakdownKey } from '../../lib/metrics/breakdown';
import { taxBracketView } from '../../lib/metrics/tax';
import { PageHead } from '../../shell/Shell';
import { usePreviewPlan } from '../../state/draft';
import { useSelectedYear } from '../../state/workspace';
import { BreakdownPanel, revealBreakdown } from './Breakdown';
import { useMoney, Loading, RecomputeError, ProjectedBadge, YearPicker } from './shared';

/** The stacked bars of the chart, each with the breakdown it opens and the colour it keeps in the panel. */
const PARTS: {
  key: BreakdownKey;
  name: string;
  short: string;
  color: string;
  value: (x: YearRecord) => number;
}[] = [
  {
    key: 'federal',
    name: 'Federal income tax',
    short: 'Federal',
    color: 'var(--chart-1)',
    value: (x) => Math.max(0, x.taxes.federalIncome),
  },
  {
    key: 'payroll',
    name: 'Payroll tax',
    short: 'Payroll',
    color: 'var(--chart-2)',
    value: (x) => x.taxes.fica + x.taxes.selfEmployment,
  },
  {
    key: 'state',
    name: 'State income tax',
    short: 'State',
    color: 'var(--chart-3)',
    value: (x) => x.taxes.state,
  },
  {
    key: 'penalties',
    name: 'Penalties',
    short: 'Penalties',
    color: 'var(--chart-4)',
    value: (x) => x.taxes.penalties,
  },
];
const COLORS: Record<string, string> = {
  ...Object.fromEntries(PARTS.map((p) => [p.key, p.color])),
  taxes: 'var(--ink-3)',
  ptc: 'var(--ok)',
};
const COVERAGE: Record<string, string> = {
  employer: 'Employer plan',
  spouseEmployer: "Spouse's employer plan",
  cobra: 'COBRA',
  aca: 'Marketplace plan',
  medicaid: 'Medicaid',
  medicare: 'Medicare',
  none: 'No coverage',
};
type Section = 'type' | 'worked' | 'brackets' | 'health' | 'notes';
const years = (n: number): string => (n === 1 ? '1 year' : `${n} years`);

export function TaxesPage(): ReactNode {
  const plan = usePreviewPlan()!;
  const { result, error, stale, retry } = useProjection();
  const m = useMoney();
  const [year, setYear] = useSelectedYear();
  const [key, setKey] = useState<BreakdownKey>('taxes');
  const [section, setSection] = useState<Section | null>('type');
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Taxes" />
        <Loading error={error} />
      </>
    );
  const recs = result.records;
  const index = Math.max(
    0,
    recs.findIndex((x) => x.year === year),
  );
  const r = recs[index];
  const t = r.taxes;
  const $ = (x: number): string => formatMoney(m.flow(r, x));
  const minus = (x: number): string => (x >= 0.5 ? `−${$(x)}` : $(0));
  const ex = explainTax(r, m.real ? 'real' : 'nominal');
  const breakdown = buildBreakdown(key, r, index > 0 ? recs[index - 1] : null, {
    basis: m.real ? 'real' : 'nominal',
    plan,
  });
  const moves = recs.filter((x, i) => i > 0 && x.state !== recs[i - 1].state);
  const otherFederal = t.federalIncome - t.ordinaryTax - t.capitalGainsTax;
  const notes: ReactNode[] = [
    recs.some((x) => x.dataStatus === 'projected')
      ? `Years from ${recs.find((x) => x.dataStatus === 'projected')!.year} use projected tables: the latest enacted figures indexed for inflation.`
      : 'All years use enacted tables.',
    ...moves.map(
      (x) => `In ${x.year} you move to ${x.state}; state tax switches to that state's tables from that year.`,
    ),
    ...(recs.some((x) => x.taxes.penalties > 1)
      ? [
          `Early-withdrawal penalties apply in ${years(recs.filter((x) => x.taxes.penalties > 1).length)}. See Strategy for penalty-free options.`,
        ]
      : []),
    ...(recs.some((x) => x.taxes.irmaaTier > 0)
      ? [
          `Medicare income surcharges apply in ${years(recs.filter((x) => x.taxes.irmaaTier > 0).length)}, based on income two years earlier.`,
        ]
      : []),
    "State figures are simplified where a state's rules have phase-outs this model does not carry. Each state's notes are under How this is calculated.",
  ];
  const sec = (id: Section): { open: boolean; onOpen: (open: boolean) => void } => ({
    open: section === id,
    onOpen: (open) => setSection((now) => (open ? id : now === id ? null : now)),
  });
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
      <Card variant="hero" data-tour="tax-stats" data-tx="stats">
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
            value={formatPct(t.marginalRate)}
            note="Federal bracket on the next dollar"
            data-tour="marginal-rate"
          />
          <Stat
            label="Roth conversions"
            value={formatCompact(recs.reduce((sum, x) => sum + x.rothConversion / x.cpi, 0))}
            note="Total over the plan"
          />
        </div>
      </Card>
      <div className="tx-grid">
        <Card
          title="Tax by type"
          actions={<span className="lv-small lv-muted tx-hint">Click a bar to see what it is made of</span>}
          data-tour="tax-chart"
          data-tx="chart"
        >
          <Chart
            label="Tax by type each year, with effective and marginal rates"
            deps={[result, m.real, r.year]}
            height="var(--tx-chart-h)"
            onClick={(p) => setYear(recs[p.dataIndex]?.year ?? null)}
            onItemClick={(p) => {
              const hit = PARTS.find((x) => x.name === p.seriesName);
              if (!hit) return;
              setYear(recs[p.dataIndex]?.year ?? null);
              setKey(hit.key);
              setSection('type');
              revealBreakdown('.tx-panel');
            }}
            table={() => ({
              columns: [
                'Year',
                ...PARTS.map((p) => p.name),
                'Premium credit',
                'Effective rate',
                'Marginal rate',
                'Tables',
              ],
              rows: recs.map((x) => [
                x.year,
                ...PARTS.map((p) => formatMoney(m.flow(x, p.value(x)))),
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
                  data: recs.map((x) => String(x.year)),
                  ...axis(c),
                  axisLabel: { show: false },
                  splitLine: { show: false },
                },
                {
                  type: 'category',
                  gridIndex: 1,
                  data: recs.map((x) => String(x.year)),
                  ...axis(c),
                  splitLine: { show: false },
                },
              ],
              yAxis: [
                { type: 'value', ...axis(c), axisLabel: { color: c.ink3, fontSize: 11, formatter: short } },
                {
                  type: 'value',
                  gridIndex: 1,
                  max: (extent: { max: number }) => Math.max(0.5, extent.max),
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
                ...PARTS.map((part, i) => ({
                  name: part.name,
                  type: 'bar',
                  stack: 't',
                  barCategoryGap: '24%',
                  cursor: 'pointer',
                  itemStyle: { borderColor: c.surface, borderWidth: 1 },
                  data: recs.map((x) => m.flow(x, part.value(x))),
                  tooltip: { valueFormatter: (v: number) => formatMoney(v) },
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
                {
                  name: 'Effective rate',
                  type: 'line',
                  xAxisIndex: 1,
                  yAxisIndex: 1,
                  symbol: 'none',
                  lineStyle: { width: 2, color: c.ink },
                  itemStyle: { color: c.ink },
                  data: recs.map((x) => x.taxes.effectiveRate),
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

        <section className="lv-card tx-panel" aria-label={`Tax in ${r.year}`} data-tour="tax-breakdown">
          <header className="tx-panel-head">
            <h2>Tax in {r.year}</h2>
            <span className="tx-panel-status">
              {r.filingStatus.toUpperCase()} · {r.state} · {formatPct(t.effectiveRate, 1)} effective
            </span>
            <span className="tx-panel-total">{t.total < 0 ? `−${$(-t.total)}` : $(t.total)}</span>
            <Explain
              title={`tax in ${r.year}`}
              lines={ex.lines}
              total={ex.result}
              source={`Tables: ${r.dataStatus}. In ${m.unit}.`}
            />
          </header>
          <YearPicker records={recs} year={r.year} onChange={setYear} />

          <Sec
            title="What the tax is made of"
            value={key === 'taxes' ? 'All types' : `${breakdown.label} · ${formatMoney(breakdown.total)}`}
            {...sec('type')}
          >
            <BreakdownPanel
              breakdown={breakdown}
              unit={m.unit}
              colors={COLORS}
              color={COLORS[key]}
              keys={[{ key: 'taxes', label: 'All' }, ...PARTS.map((p) => ({ key: p.key, label: p.short }))]}
              onKey={setKey}
              bare
              showFacts={key !== 'taxes'}
            />
          </Sec>

          <Sec title="How it was worked out" value={`${$(t.taxableIncome)} taxable`} {...sec('worked')}>
            <ol className="tx-steps" aria-label={`Tax worked out for ${r.year}`}>
              <li>
                <h3>Income</h3>
                <dl className="lv-facts">
                  <Row k="Adjusted gross (AGI)" v={$(t.agi)} strong />
                  <Row
                    k="Pay"
                    v={$(r.income.wages + r.income.selfEmployment)}
                    sub
                    hide={r.income.wages + r.income.selfEmployment < 0.5}
                  />
                  <Row
                    k="Pre-tax withdrawals"
                    v={$(r.withdrawals.pretax)}
                    sub
                    hide={r.withdrawals.pretax < 0.5}
                  />
                  <Row k="Required (RMD)" v={$(r.withdrawals.rmd)} sub hide={r.withdrawals.rmd < 0.5} />
                  <Row k="Roth conversion" v={$(r.rothConversion)} sub hide={r.rothConversion < 0.5} />
                  <Row k="Gains realized" v={$(r.realizedGains)} sub hide={r.realizedGains < 0.5} />
                  <Row
                    k="Social Security taxed"
                    v={$(t.taxableSocialSecurity)}
                    sub
                    hide={t.taxableSocialSecurity < 0.5}
                  />
                </dl>
              </li>
              <li>
                <h3>Deductions</h3>
                <dl className="lv-facts">
                  <Row k="Deduction taken" v={minus(t.deduction)} />
                </dl>
              </li>
              <li>
                <h3>Taxable income</h3>
                <dl className="lv-facts">
                  <Row k="Taxable income" v={$(t.taxableIncome)} strong />
                  <Row k="At ordinary rates" v={$(t.ordinaryTaxable)} sub />
                  <Row
                    k="At gains rates"
                    v={$(Math.max(0, t.taxableIncome - t.ordinaryTaxable))}
                    sub
                    hide={t.taxableIncome - t.ordinaryTaxable < 0.5}
                  />
                </dl>
              </li>
              <li>
                <h3>Tax</h3>
                <dl className="lv-facts">
                  <Row k="Ordinary tax" v={$(t.ordinaryTax)} />
                  <Row
                    k="Capital-gains tax"
                    v={$(t.capitalGainsTax)}
                    hide={Math.abs(t.capitalGainsTax) < 0.5}
                  />
                  <Row
                    k="Other federal, credits"
                    v={otherFederal < 0 ? minus(-otherFederal) : $(otherFederal)}
                    hide={Math.abs(otherFederal) < 0.5}
                  />
                  <Row
                    k="Payroll tax"
                    v={$(t.fica + t.selfEmployment)}
                    hide={t.fica + t.selfEmployment < 0.5}
                  />
                  <Row k={`${r.state} income tax`} v={$(t.state)} hide={Math.abs(t.state) < 0.5} />
                  <Row k="Penalties" v={$(t.penalties)} hide={t.penalties < 0.5} />
                  <Row k="Premium tax credit" v={minus(t.ptc)} hide={t.ptc < 0.5} />
                  <Row k="Total tax" v={t.total < 0 ? minus(-t.total) : $(t.total)} strong />
                </dl>
              </li>
            </ol>
            <p className="lv-small tx-links">
              <Link to="/plan/strategy">Preview a Roth conversion</Link>
              <Link to="/help/methods">Tax methods and dataset sources</Link>
            </p>
          </Sec>

          <Sec
            title="Federal brackets"
            value={`${formatPct(t.marginalRate)} on the next dollar`}
            {...sec('brackets')}
          >
            <BracketLadder plan={plan} result={result} record={r} real={m.real} />
          </Sec>

          <Sec
            title="Healthcare and subsidies"
            value={`${$(r.expenses.healthcare.total - t.ptc)} after credit`}
            {...sec('health')}
          >
            <ul className="tx-coverage" aria-label={`Coverage in ${r.year}`}>
              {r.coverage.map((coverage, i) =>
                r.alive[i] === false ? null : (
                  <li key={i}>
                    <span>{plan.people[i]?.name ?? `Person ${i + 1}`}</span>
                    <strong>{COVERAGE[coverage] ?? coverage}</strong>
                  </li>
                ),
              )}
            </ul>
            <dl className="lv-facts">
              <Row k="Gross modeled cost" v={$(r.expenses.healthcare.total)} />
              <Row k="Premium tax credit" v={minus(t.ptc)} />
              <Row k="Cost after credit" v={$(r.expenses.healthcare.total - t.ptc)} strong />
              <Row k="HSA payments (included above)" v={$(r.expenses.healthcare.hsaPaid)} />
              <Row k="Income for subsidies (MAGI)" v={$(t.magi)} />
              <Row k="MAGI against the poverty guideline" v={formatPct(t.fplRatio, 0)} />
              <Row
                k="Medicare income tier (IRMAA)"
                v={t.irmaaTier === 0 ? 'Standard' : `Tier ${t.irmaaTier}`}
              />
              <Row k="Medicare surcharge" v={$(r.expenses.healthcare.irmaa)} />
            </dl>
            <p className="lv-small lv-muted">
              Premium credits are already inside net taxes; this view does not subtract them again. Medicare
              tiers use a two-year lookback.{' '}
              <Link to="/plan/healthcare">Edit coverage and cost assumptions →</Link>
            </p>
          </Sec>

          <Sec title="Things to know" value={`${notes.length} notes`} {...sec('notes')}>
            <ul className="tx-notes" data-tour="tax-notes">
              {notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </Sec>
        </section>
      </div>
    </>
  );
}

/** One section of the year panel. Only one is open at a time, so the panel stays the height of the chart. */
function Sec({
  title,
  value,
  open,
  onOpen,
  children,
}: {
  title: string;
  /** The section's headline figure, readable while it is closed. */
  value: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  children: ReactNode;
}): ReactNode {
  return (
    <details
      className="tx-sec"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        if (next !== open) onOpen(next);
      }}
    >
      <summary>
        <span className="tx-sec-title">{title}</span>
        <span className="tx-sec-value">{value}</span>
        <span className="tx-sec-chevron" aria-hidden="true">
          <Icon name="down" size={14} />
        </span>
      </summary>
      <div className="tx-sec-body">{children}</div>
    </details>
  );
}

function Row({
  k,
  v,
  strong,
  sub,
  hide,
}: {
  k: string;
  v: string;
  strong?: boolean;
  /** A part of the figure above it, not a further step. */
  sub?: boolean;
  hide?: boolean;
}): ReactNode {
  if (hide) return null;
  return (
    <div data-strong={strong || undefined} data-sub={sub || undefined}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/** How far the year's ordinary income climbs the federal brackets: each rung filled by the income taxed in it. */
function BracketLadder({
  plan,
  result,
  record,
  real,
}: {
  plan: Plan;
  result: ProjectionResult;
  record: YearRecord;
  real: boolean;
}): ReactNode {
  const [data, setData] = useState<EngineData | null>(null);
  useEffect(() => {
    let live = true;
    void loadDataBundle().then((bundle) => {
      if (live) setData(bundle.bundledEngineData());
    });
    return () => {
      live = false;
    };
  }, []);
  if (!data)
    return (
      <p className="lv-muted lv-small" role="status">
        Loading bracket detail…
      </p>
    );
  const view = taxBracketView(data, plan, result, record);
  const money = (v: number): string => formatMoney(v / (real ? record.cpi : 1));
  // The rung the next dollar lands on: the highest one holding income, or the first if there is none.
  const marginal = view.rows.findIndex((row) => Math.abs(row.rate - record.taxes.marginalRate) < 1e-9);
  const reached =
    marginal >= 0 ? marginal : view.rows.reduce((top, row, i) => (row.amount > 0.5 ? i : top), 0);
  return (
    <>
      <ol className="tx-ladder" aria-label={`Ordinary federal brackets in ${record.year}, highest first`}>
        {view.rows
          .map((row, i) => {
            const open = !Number.isFinite(row.top);
            const fill = row.amount < 0.5 ? 0 : open ? 1 : Math.min(1, row.amount / (row.top - row.bottom));
            return (
              <li
                key={row.rate}
                data-state={fill === 0 ? 'empty' : fill >= 0.999 && !open ? 'full' : 'part'}
                data-marginal={i === reached || undefined}
              >
                <span className="tx-rung-rate">{formatPct(row.rate)}</span>
                <span className="tx-rung-body">
                  <span className="tx-rung-track" aria-hidden="true">
                    <i style={{ width: `${fill * 100}%` }} />
                  </span>
                  <span className="tx-rung-text">
                    {row.amount < 0.5
                      ? `Not reached · starts at ${money(row.bottom)}`
                      : open
                        ? `${money(row.amount)} above ${money(row.bottom)}`
                        : `${money(row.amount)} of ${money(row.top - row.bottom)}`}
                    {i === reached ? <b> · next dollar</b> : null}
                  </span>
                </span>
                <span className="tx-rung-tax">{row.amount < 0.5 ? '—' : money(row.tax)}</span>
              </li>
            );
          })
          .reverse()}
      </ol>
      <p className="lv-small lv-muted">
        {record.filingStatus.toUpperCase()} · {view.status} {view.dataYear} parameters, indexed by this
        projection’s inflation. Ordinary tax only ({money(record.taxes.ordinaryTax)}); gains, credits, NIIT
        and AMT are separate. <Link to="/help/methods">Definitions and sources</Link>
      </p>
    </>
  );
}
