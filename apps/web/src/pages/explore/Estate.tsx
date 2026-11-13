import { type YearRecord } from '@fisim/engine';
import { Button, Card, Explain, Notice, Stat, formatCompact, formatMoney, formatPct } from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { Chart, areaSeries, axis, short, tooltip } from '../../charts/Chart';
import { useMonteCarlo, useProjection } from '../../engine/useResults';
import { annualMetrics, metricValue } from '../../lib/metrics';
import { PageHead } from '../../shell/Shell';
import { usePlan } from '../../state/store';
import { useSelectedYear } from '../../state/workspace';
import { Loading, RecomputeError, ProjectedBadge, YearPicker } from './shared';

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
      <Card title="Inspect annual balances">
        <YearPicker records={result.records} year={year ?? result.records[0].year} onChange={setYear} />
        <p>
          End-of-year net worth:{' '}
          {formatMoney(
            (result.records.find((r) => r.year === year) ?? result.records[0]).netWorth /
              (result.records.find((r) => r.year === year) ?? result.records[0]).cpiEnd,
          )}{' '}
          in today's dollars. The estate estimates below refer to the final plan year.
        </p>
      </Card>
      <Card variant="hero" data-tour="estate-stats">
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
      <Card title="Annual estate composition, before estate and heir taxes" data-tour="estate-chart">
        <Chart
          label="Estate value by year, split by account type"
          deps={[result]}
          height="var(--chart-h)"
          table={() => ({
            columns: [
              'Year',
              'Pre-tax',
              'Roth',
              'Taxable and cash',
              'HSA and other accounts',
              'Property net of debt',
            ],
            rows: result.records.map((r) => [
              r.year,
              formatMoney(r.byKind.pretax / r.cpiEnd),
              formatMoney(r.byKind.roth / r.cpiEnd),
              formatMoney(metricValue('taxableCash', r, 'real')),
              formatMoney(metricValue('otherAccounts', r, 'real')),
              formatMoney(metricValue('propertyNet', r, 'real')),
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
                ['Taxable and cash (stepped up)', annualMetrics.taxableCash.nominal],
                ['HSA and other accounts', annualMetrics.otherAccounts.nominal],
                ['Property net of debt', annualMetrics.propertyNet.nominal],
              ] as [string, (r: YearRecord) => number][]
            ).map(([name, f], i) =>
              areaSeries(
                name,
                [
                  c.financial.pretax,
                  c.financial.roth,
                  c.financial.taxable,
                  c.financial.hsa,
                  c.financial.property,
                ][i],
                result.records.map((r) => f(r) / r.cpiEnd),
                { stack: 'e' },
              ),
            ),
          })}
        />
      </Card>
      <Card title="Estate uncertainty">
        <label className="lv-switch">
          <input type="checkbox" checked={uncertainty} onChange={(e) => setUncertainty(e.target.checked)} />
          <span>Simulate the range of net estate outcomes</span>
        </label>
        {uncertainty && (
          <>
            <p role="status">
              {mc.error
                ? `Simulation failed: ${mc.error}`
                : mc.running
                  ? `Running · ${Math.round(mc.progress * 100)}% complete`
                  : mc.partial
                    ? 'Stopped with partial results'
                    : mc.summary
                      ? 'Simulation complete'
                      : 'Simulation stopped'}
            </p>
            <Button onClick={mc.running ? mc.cancel : mc.rerun}>
              {mc.running ? 'Stop estate simulation' : 'Run estate simulation again'}
            </Button>
            {mc.summary && (
              <div className="lv-grid" style={{ marginTop: 16 }}>
                <Stat
                  label="Net to heirs, 10th percentile"
                  value={formatCompact(mc.summary.netEstatePercentiles.p10)}
                />
                <Stat
                  label="Median net to heirs"
                  value={formatCompact(mc.summary.netEstatePercentiles.p50)}
                />
                <Stat
                  label="Net to heirs, 90th percentile"
                  value={formatCompact(mc.summary.netEstatePercentiles.p90)}
                />
              </div>
            )}
            <p className="lv-small lv-muted">
              After modeled estate and heir taxes, in today's dollars.{' '}
              {mc.summary?.runs.toLocaleString() ?? 0} of {plan.assumptions.monteCarlo.runs.toLocaleString()}{' '}
              runs; seed {plan.assumptions.monteCarlo.seed}.{' '}
              {mc.partial ? 'Percentiles describe only completed runs so far.' : ''}
            </p>
          </>
        )}
      </Card>
    </>
  );
}
