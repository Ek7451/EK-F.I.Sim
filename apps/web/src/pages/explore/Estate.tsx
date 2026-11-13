import './estate.css';
import { type YearRecord } from '@fisim/engine';
import { Button, Card, Explain, Stat, formatCompact, formatMoney, formatPct } from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { Chart, alpha, areaSeries, axis, short, tooltip, type ChartColors } from '../../charts/Chart';
import { useMonteCarlo, useProjection } from '../../engine/useResults';
import { annualMetrics } from '../../lib/metrics';
import { PageHead } from '../../shell/Shell';
import { usePlan } from '../../state/store';
import { useSelectedYear } from '../../state/workspace';
import { Loading, RecomputeError, ProjectedBadge, YearPicker } from './shared';

/** The five layers of the estate, in stacking order, each with the colour its kind of holding has everywhere. */
const LAYERS: {
  /** How this layer reaches heirs, in a few words. */
  hint?: string;
  short: string;
  token: string;
  color: (c: ChartColors) => string;
  value: (r: YearRecord) => number;
}[] = [
  {
    hint: 'heirs pay income tax',
    short: 'Pre-tax',
    token: '--financial-pretax',
    color: (c) => c.financial.pretax,
    value: (r) => r.byKind.pretax,
  },
  {
    hint: 'tax-free to heirs',
    short: 'Roth',
    token: '--financial-roth',
    color: (c) => c.financial.roth,
    value: (r) => r.byKind.roth,
  },
  {
    hint: 'stepped up',
    short: 'Taxable and cash',
    token: '--financial-taxable',
    color: (c) => c.financial.taxable,
    value: annualMetrics.taxableCash.nominal,
  },
  {
    short: 'HSA and other',
    token: '--financial-hsa',
    color: (c) => c.financial.hsa,
    value: annualMetrics.otherAccounts.nominal,
  },
  {
    hint: 'stepped up',
    short: 'Property net of debt',
    token: '--financial-property',
    color: (c) => c.financial.property,
    value: annualMetrics.propertyNet.nominal,
  },
];

export function EstatePage(): ReactNode {
  const { result, error, stale, retry } = useProjection();
  const plan = usePlan()!;
  const [year, setYear] = useSelectedYear();
  const [uncertainty, setUncertainty] = useState(false);
  const mc = useMonteCarlo(uncertainty);
  if (!result)
    return (
      <>
        <PageHead group="explore" title="Estate" />
        <Loading error={error} />
      </>
    );
  const e = result.estate;
  const recs = result.records;
  const last = recs[recs.length - 1];
  const cpi = last.cpiEnd;
  const real = (x: number): number => x / cpi;
  const sel = recs.find((r) => r.year === year) ?? recs[0];
  const selIndex = recs.indexOf(sel);
  const lines = [
    { label: 'Estate at the end of the plan', amount: real(e.value) },
    { label: 'Federal estate tax', amount: -real(e.estateTax) },
    { label: 'Income tax heirs owe on pre-tax accounts', amount: -real(e.heirPretaxDrag) },
  ];
  const minus = (x: number): string => (Math.round(x) > 0 ? `− ${formatMoney(x)}` : formatMoney(0));
  return (
    <>
      <PageHead
        group="explore"
        title="Estate"
        intro="What is left for heirs at the end of the plan on the expected path, and what tax takes from it. In today's dollars."
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
      <Card variant="hero" data-tour="estate-stats">
        <div className="es-band">
          <Stat
            label="Estate"
            value={formatCompact(real(e.value))}
            note={`At the end of the plan, ${last.year}`}
            data-tour="estate-value"
          />
          <div className="lv-row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
            <Stat
              label="Net to heirs"
              value={formatCompact(real(e.netToHeirs))}
              note="After estate tax and heirs' income tax"
            />
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
      </Card>
      <div className="es-main">
        <section className="lv-card" data-tour="estate-chart">
          <header className="es-chart-head">
            <h2>What the estate is made of, year by year</h2>
            <YearPicker records={recs} year={sel.year} onChange={setYear} />
          </header>
          <Chart
            label="Estate value by year, split by account type"
            deps={[result, sel.year]}
            height="var(--es-chart-h)"
            onClick={({ dataIndex }) => {
              const r = recs[dataIndex];
              if (r) setYear(r.year);
            }}
            footer={
              <p className="lv-small lv-muted" style={{ margin: 0 }}>
                Before estate and heir taxes, in today's dollars. Click a year to read it on the right.
              </p>
            }
            table={() => ({
              columns: ['Year', ...LAYERS.map((l) => l.short)],
              rows: recs.map((r) => [r.year, ...LAYERS.map((l) => formatMoney(l.value(r) / r.cpiEnd))]),
            })}
            build={(c) => ({
              grid: { left: 56, right: 16, top: 34, bottom: 30 },
              legend: { type: 'scroll', top: 0, textStyle: { color: c.ink2 }, icon: 'roundRect' },
              tooltip: { ...tooltip(c), trigger: 'axis', valueFormatter: (v: number) => formatMoney(v) },
              xAxis: {
                type: 'category',
                data: recs.map((r) => r.year),
                boundaryGap: false,
                ...axis(c),
                splitLine: { show: false },
              },
              yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
              series: LAYERS.map((l, i) => ({
                ...areaSeries(
                  l.short,
                  l.color(c),
                  recs.map((r) => l.value(r) / r.cpiEnd),
                  { stack: 'e' },
                ),
                // The year being read on the right, marked once on the chart.
                ...(i === 0
                  ? {
                      markLine: {
                        silent: true,
                        symbol: 'none',
                        animation: false,
                        label: { show: false },
                        lineStyle: { color: alpha(c.dawn[3], 0.95), width: 1.5, type: 'solid' },
                        data: [{ xAxis: selIndex }],
                      },
                    }
                  : {}),
              })),
            })}
          />
        </section>
        <div className="es-side">
          <Card title={`At the end of ${sel.year}`}>
            <dl className="lv-facts">
              {LAYERS.map((l) => (
                <div key={l.short}>
                  <dt>
                    <i className="es-swatch" style={{ background: `var(${l.token})` }} />
                    {l.short}
                    {l.hint ? <small className="es-hint"> · {l.hint}</small> : null}
                  </dt>
                  <dd>{formatMoney(l.value(sel) / sel.cpiEnd)}</dd>
                </div>
              ))}
              <div className="es-total">
                <dt>Net worth · age {sel.ages.join(' and ')}</dt>
                <dd>{formatMoney(sel.netWorth / sel.cpiEnd)}</dd>
              </div>
            </dl>
          </Card>
          <Card title={`What heirs receive in ${last.year}`}>
            <dl className="lv-facts">
              <div>
                <dt>Estate at the end of the plan</dt>
                <dd>{formatMoney(real(e.value))}</dd>
              </div>
              <div>
                <dt>Federal estate tax</dt>
                <dd>{minus(real(e.estateTax))}</dd>
              </div>
              <div>
                <dt>Income tax heirs owe on pre-tax</dt>
                <dd>{minus(real(e.heirPretaxDrag))}</dd>
              </div>
              <div className="es-total">
                <dt>Net to heirs</dt>
                <dd>{formatMoney(real(e.netToHeirs))}</dd>
              </div>
            </dl>
            <p className={`lv-small es-note ${e.estateTax > 0 ? 'lv-warn-text' : 'lv-muted'}`}>
              {e.estateTax > 0
                ? `The estate is above the federal exemption, with about ${formatMoney(real(e.estateTax))} of estate tax. State estate and inheritance taxes are not modelled.`
                : 'Below the federal estate-tax exemption. State estate and inheritance taxes are not modelled.'}
            </p>
          </Card>
          <Card title="How much could it vary?">
            <label className="lv-switch">
              <input
                type="checkbox"
                role="switch"
                checked={uncertainty}
                onChange={(ev) => setUncertainty(ev.target.checked)}
              />
              <span>Simulate the range of net estate outcomes</span>
            </label>
            {uncertainty && (
              <>
                {mc.summary && (
                  <dl className="lv-facts">
                    <div>
                      <dt>Net to heirs, 10th percentile</dt>
                      <dd>{formatCompact(mc.summary.netEstatePercentiles.p10)}</dd>
                    </div>
                    <div>
                      <dt>Median net to heirs</dt>
                      <dd>{formatCompact(mc.summary.netEstatePercentiles.p50)}</dd>
                    </div>
                    <div>
                      <dt>Net to heirs, 90th percentile</dt>
                      <dd>{formatCompact(mc.summary.netEstatePercentiles.p90)}</dd>
                    </div>
                  </dl>
                )}
                <div className="lv-spread es-run">
                  <span className="lv-small" role="status">
                    {mc.error
                      ? `Simulation failed: ${mc.error}`
                      : mc.running
                        ? `Running · ${Math.round(mc.progress * 100)}% complete`
                        : mc.partial
                          ? 'Stopped with partial results'
                          : mc.summary
                            ? 'Simulation complete'
                            : 'Simulation stopped'}
                  </span>
                  <Button size="sm" onClick={mc.running ? mc.cancel : mc.rerun}>
                    {mc.running ? 'Stop estate simulation' : 'Run estate simulation again'}
                  </Button>
                </div>
                <p className="lv-small lv-muted es-note">
                  After modeled estate and heir taxes, in today's dollars.{' '}
                  {mc.summary?.runs.toLocaleString() ?? 0} of{' '}
                  {plan.assumptions.monteCarlo.runs.toLocaleString()} runs; seed{' '}
                  {plan.assumptions.monteCarlo.seed}.{' '}
                  {mc.partial ? 'Percentiles describe only completed runs so far.' : ''}
                </p>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
