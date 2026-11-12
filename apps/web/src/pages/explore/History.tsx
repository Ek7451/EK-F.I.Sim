import { Badge, Button, Card, HelpTip, Notice, Stat, formatCompact, formatMoney, formatPct } from '@fisim/ui';
import { useMemo, useState, type ReactNode } from 'react';
import { Chart, axis, short, tooltip } from '../../charts/Chart';
import { useBacktest } from '../../engine/useResults';
import { PageHead } from '../../shell/Shell';

export function HistoryPage(): ReactNode {
  const { result, running, error, retry, cancel } = useBacktest(true);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [allCohorts, setAllCohorts] = useState(false);
  const selected = result?.cohorts.find((c) => c.startYear === selectedStart) ?? result?.worst;
  const median = result
    ? [...result.cohorts].filter((c) => c.complete).sort((a, b) => a.endingReal - b.endingReal)[
        Math.floor((result.completeCount - 1) / 2)
      ]
    : null;
  const sorted = useMemo(
    () =>
      result
        ? [...result.cohorts]
            .filter((c) => c.complete)
            .sort((a, b) => a.lastedYears - b.lastedYears || a.endingReal - b.endingReal)
        : [],
    [result],
  );
  return (
    <>
      <PageHead
        group="explore"
        title="Against history"
        intro="Your plan replayed from every starting year since 1871, using the returns and inflation that actually followed. It shows how the plan copes with a bad run of early years."
        actions={<Badge>Estimated</Badge>}
      />
      {error && <Notice tone="danger">Historical replay failed: {error}</Notice>}
      <div className="lv-row">
        <Button onClick={running ? cancel : retry}>{running ? 'Cancel replay' : 'Run history again'}</Button>
      </div>
      {!result ? (
        <Card>
          <p className="lv-muted" role="status">
            {running ? 'Replaying history…' : 'Replay stopped. Run history again to retry.'}
          </p>
        </Card>
      ) : (
        <>
          <Card data-tour="history-stats">
            <div className="lv-grid">
              <Stat
                label="Start years that worked"
                value={`${result.successCount} of ${result.completeCount}`}
                note={formatPct(result.successRate, 1)}
                data-tour="history-success"
              />
              <Stat
                label="Hardest start year"
                value={result.worst?.startYear ?? '—'}
                note={
                  result.worst
                    ? result.worst.success
                      ? `Lowest point ${formatCompact(result.worst.minReal)}`
                      : `Money lasted ${result.worst.lastedYears} years`
                    : undefined
                }
                data-tour="worst-year"
              />
              <Stat
                label="Median ending wealth"
                value={formatCompact(result.medianEndingReal)}
                note="Today's dollars"
              />
              <Stat
                label="Unfinished start years"
                value={result.partialCount}
                note={`History ends in ${result.dataThrough}; these are shown faintly`}
              />
            </div>
          </Card>
          <Card title="Inspect a historical cohort">
            <p className="lv-small lv-muted">
              A start year identifies the historical return sequence applied to your plan. Full cohorts have
              at least {result.horizon} years of history; data ends in {result.dataThrough}. Historical
              coverage is not a future probability.
            </p>
            <div className="lv-row">
              {[
                ['Worst', result.worst],
                ['Median ending wealth', median],
                ['Best', result.best],
              ].map(([label, cohort]) =>
                typeof cohort === 'object' && cohort ? (
                  <Button key={String(label)} size="sm" onClick={() => setSelectedStart(cohort.startYear)}>
                    {String(label)} · {cohort.startYear}
                  </Button>
                ) : null,
              )}
              <Button size="sm" aria-pressed={allCohorts} onClick={() => setAllCohorts((v) => !v)}>
                {allCohorts ? 'Selected path only' : 'Show all paths'}
              </Button>
            </div>
            <div className="cohort-map" aria-label="Historical start years">
              {result.cohorts.map((co) => (
                <button
                  type="button"
                  key={co.startYear}
                  aria-pressed={selected?.startYear === co.startYear}
                  data-outcome={!co.complete ? 'partial' : co.success ? 'funded' : 'short'}
                  title={`${co.startYear}: ${!co.complete ? 'incomplete history' : co.success ? 'funded' : `short after ${co.lastedYears} years`}`}
                  onClick={() => setSelectedStart(co.startYear)}
                >
                  {co.startYear}
                  <span className="lv-sr-only">
                    {!co.complete ? ' incomplete history' : co.success ? ' funded' : ' ran short'}
                  </span>
                </button>
              ))}
            </div>
            {selected && (
              <p>
                Selected: {selected.startYear} ·{' '}
                {selected.complete
                  ? 'Full history'
                  : 'Incomplete history (history repeats beyond available data)'}{' '}
                · ending investments {formatMoney(selected.endingReal)} in today's dollars.
              </p>
            )}
          </Card>
          <Card
            title={
              <span className="lv-label-row">
                Every start year
                <HelpTip>
                  International stocks and REITs follow US stocks here because they have no long public
                  history. Bonds are 10-year Treasuries, which lost more in the 1970s than the intermediate
                  bonds used in the Bengen and Trinity studies, so a 4% plan here can look a few points worse
                  than those studies report.
                </HelpTip>
              </span>
            }
            data-tour="history-chart"
          >
            <Chart
              label="Investments over the plan for each historical start year; the hardest start year is highlighted"
              deps={[result, selectedStart, allCohorts]}
              height="var(--chart-h)"
              table={() => ({
                columns: ['Start year', 'Outcome', 'Years funded', 'Ending wealth', 'Lowest point'],
                rows: sorted.map((c) => [
                  c.startYear,
                  c.success ? 'Funded' : 'Ran short',
                  c.lastedYears,
                  formatMoney(c.endingReal),
                  formatMoney(c.minReal),
                ]),
              })}
              build={(c) => ({
                grid: { left: 56, right: 16, top: 16, bottom: 32 },
                tooltip: {
                  ...tooltip(c),
                  trigger: 'item',
                  formatter: (p: { seriesName: string; value: number; dataIndex: number }) =>
                    `Started ${p.seriesName}<br/>Year ${p.dataIndex + 1}: ${formatMoney(p.value)}`,
                },
                xAxis: {
                  type: 'category',
                  data: Array.from({ length: result.horizon }, (_, i) => i + 1),
                  name: 'Years into the plan',
                  nameLocation: 'middle',
                  nameGap: 24,
                  nameTextStyle: { color: c.ink3 },
                  ...axis(c),
                  splitLine: { show: false },
                },
                yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
                series: (allCohorts ? result.cohorts : selected ? [selected] : []).map((co) => {
                  const worst = co.startYear === selected?.startYear;
                  return {
                    name: String(co.startYear),
                    type: 'line',
                    symbol: 'none',
                    z: worst ? 5 : co.success ? 1 : 2,
                    lineStyle: {
                      width: worst ? 3 : 1,
                      color: worst ? c.accent : co.success ? c.primary : c.danger,
                      opacity: worst ? 1 : co.complete ? 0.28 : 0.1,
                    },
                    data: co.series,
                    emphasis: { lineStyle: { width: 2.5, opacity: 1 } },
                  };
                }),
              })}
            />
            <p className="lv-muted lv-small">
              Each line is a historical cohort, in today's dollars. The selected cohort is emphasized. Red
              paths ran short.
            </p>
          </Card>
          {selected && (
            <details>
              <summary>Selected path: annual investment balances</summary>
              <div className="lv-table-wrap" role="region" tabIndex={0} aria-label="Selected historical path">
                <table className="lv-table">
                  <thead>
                    <tr>
                      <th>Year into plan</th>
                      <th>Historical year</th>
                      <th>Investments, today's dollars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.series.map((v, i) => (
                      <tr key={i}>
                        <th>{i + 1}</th>
                        <td>
                          {selected.startYear + i <= result.dataThrough
                            ? selected.startYear + i
                            : 'Repeated history'}
                        </td>
                        <td>{formatMoney(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <Card title="The ten hardest start years" data-tour="worst-table">
            <div className="lv-table-wrap" tabIndex={0} role="region" aria-label="Hardest starting years">
              <table className="lv-table">
                <thead>
                  <tr>
                    <th scope="col">Start year</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Years funded</th>
                    <th scope="col">Lowest point</th>
                    <th scope="col">Ending wealth</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 10).map((c) => (
                    <tr key={c.startYear}>
                      <th scope="row">{c.startYear}</th>
                      <td>{c.success ? 'Funded' : 'Ran short'}</td>
                      <td>{c.lastedYears}</td>
                      <td>{formatMoney(c.minReal)}</td>
                      <td>{formatMoney(c.endingReal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
