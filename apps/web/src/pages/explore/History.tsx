import './history.css';
import type { BacktestResult } from '@fisim/engine';
import {
  Badge,
  Button,
  Card,
  Fold,
  HelpTip,
  Notice,
  Stat,
  formatCompact,
  formatMoney,
  formatPct,
} from '@fisim/ui';
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Chart, axis, dawnLine, short, tooltip, tooltipCard } from '../../charts/Chart';
import { useBacktest } from '../../engine/useResults';
import { chartYearLabels, householdAges, yearWithAges } from '../../lib/chartYears';
import { PageHead } from '../../shell/Shell';

type Cohort = BacktestResult['cohorts'][number];
type HistoricalPoint = { seriesName: string; value: number; dataIndex: number };

const outcomeOf = (co: Cohort): 'partial' | 'funded' | 'short' =>
  !co.complete ? 'partial' : co.success ? 'funded' : 'short';

/** One tile per recorded year of the selected replay. All amounts are real year-end investments. */
function RunHeatMap({ run, result }: { run: Cohort; result: BacktestResult }): ReactNode {
  const [index, setIndex] = useState(run.series.length - 1);
  const grid = useRef<HTMLDivElement>(null);
  const low = run.minReal;
  const high = Math.max(...run.series);
  const year = run.startYear + index;
  const planYear = result.planStartYear + index;
  const move = (event: KeyboardEvent, i: number): void => {
    const targets: Record<string, number> = {
      ArrowLeft: i - 1,
      ArrowRight: i + 1,
      ArrowUp: i - 5,
      ArrowDown: i + 5,
      Home: 0,
      End: run.series.length - 1,
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(run.series.length - 1, targets[event.key]));
    grid.current?.querySelectorAll('button')[next]?.focus();
  };
  return (
    <section className="hx-heat" aria-label="Year-by-year investment heat map">
      <h3>Investments by historical year</h3>
      <p className="lv-small lv-muted">
        Each tile shows one year of this run. Tap a year for its balance and plan ages.
      </p>
      <div className="hx-heat-grid" ref={grid}>
        {run.series.map((balance, i) => {
          const historicalYear = run.startYear + i;
          const level = high === low ? 3 : 1 + Math.min(4, Math.floor((5 * (balance - low)) / (high - low)));
          return (
            <button
              type="button"
              key={historicalYear}
              data-level={level}
              aria-pressed={index === i}
              tabIndex={index === i ? 0 : -1}
              aria-label={`${historicalYear}, ${formatMoney(balance)}, ${householdAges(result.people, result.planStartYear + i)}`}
              onClick={() => setIndex(i)}
              onFocus={() => setIndex(i)}
              onKeyDown={(e) => move(e, i)}
            >
              {historicalYear}
            </button>
          );
        })}
      </div>
      <div className="hx-heat-key lv-small lv-muted">
        <span>{formatCompact(low)}</span>
        <i aria-hidden="true" />
        <span>{formatCompact(high)}</span>
      </div>
      <p className="hx-heat-detail" aria-live="polite" aria-atomic="true">
        <strong>
          {year} · {formatMoney(run.series[index])}
        </strong>
        <span>Year-end investments in today’s dollars</span>
        <span>
          Plan year {planYear} · {householdAges(result.people, planYear)}
        </span>
      </p>
    </section>
  );
}

export function HistoryPage(): ReactNode {
  const { result, running, error, retry, cancel } = useBacktest(true);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [allCohorts, setAllCohorts] = useState(false);
  const startPicker = useRef<HTMLDetailsElement>(null);
  const chooseRun = (year: number): void => {
    setSelectedStart(year);
    setAllCohorts(false);
  };
  const pickStart = (year: number): void => {
    chooseRun(year);
    if (startPicker.current) {
      startPicker.current.open = false;
      startPicker.current.querySelector('summary')?.focus();
    }
  };
  const selected =
    result?.cohorts.find((c) => c.startYear === selectedStart) ?? result?.worst ?? result?.cohorts[0] ?? null;
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
  // Where the selected start year stands among the finished ones, hardest first.
  const rank = selected?.complete ? sorted.findIndex((c) => c.startYear === selected.startYear) + 1 : 0;
  const lowIndex = selected ? selected.series.indexOf(Math.min(...selected.series)) : -1;
  const showHistoricalYears = !!selected && !allCohorts;
  const role =
    selected && result
      ? selected.startYear === result.worst?.startYear
        ? 'the hardest start on record for this plan'
        : selected.startYear === result.best?.startYear
          ? 'the kindest start on record for this plan'
          : selected.startYear === median?.startYear
            ? 'the middle outcome'
            : null
      : null;
  return (
    <>
      <PageHead
        group="explore"
        title="Against history"
        intro="History tests your plan against consecutive years of recorded returns and inflation. Outcomes simulates possible futures from your plan’s start year."
        actions={
          <>
            <Badge>Estimated</Badge>
            <Button size="sm" onClick={running ? cancel : retry}>
              {running ? 'Cancel replay' : 'Run history again'}
            </Button>
          </>
        }
      />
      {error && <Notice tone="danger">Historical replay failed: {error}</Notice>}
      {!result ? (
        <Card>
          <p className="lv-muted" role="status">
            {running ? 'Replaying history…' : 'Replay stopped. Run history again to retry.'}
          </p>
        </Card>
      ) : (
        <>
          <Card variant="hero" title="Across all historical runs" data-tour="history-stats">
            <div className="hx-band">
              <Stat
                label="Start years that worked"
                value={`${result.successCount} of ${result.completeCount}`}
                note={
                  result.successRate === null
                    ? `No full ${result.horizon}-year histories`
                    : `${formatPct(result.successRate, 1)} of full histories`
                }
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
                value={result.medianEndingReal === null ? 'N/A' : formatCompact(result.medianEndingReal)}
                note="Today's dollars"
              />
              <Stat
                label="Unfinished start years"
                value={result.partialCount}
                note={`History ends in ${result.dataThrough}`}
              />
            </div>
          </Card>
          <div className="hx-main">
            <div className="hx-side">
              <Card title="Pick a historical run" data-tour="history-map">
                {result.completeCount > 0 && (
                  <label className="lv-field">
                    <span className="lv-label">Full run ending in</span>
                    <select
                      className="lv-input"
                      value={selected?.complete ? selected.startYear : ''}
                      onChange={(e) => chooseRun(Number(e.target.value))}
                    >
                      {!selected?.complete && (
                        <option value="" disabled>
                          Choose an ending year
                        </option>
                      )}
                      {result.cohorts
                        .filter((co) => co.complete)
                        .reverse()
                        .map((co) => (
                          <option key={co.startYear} value={co.startYear}>
                            {co.startYear + result.horizon - 1} (started {co.startYear})
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {selected && (
                  <p className="hx-picked" role="status" aria-atomic="true">
                    <strong>
                      {selected.startYear}–{selected.startYear + selected.series.length - 1}
                    </strong>
                    {selected.complete
                      ? selected.success
                        ? `Funded all ${selected.years} years.`
                        : `Ran short after ${selected.lastedYears} years.`
                      : `Partial replay: ${selected.years} of ${result.horizon} years recorded.`}{' '}
                    Investments at the end of {selected.startYear + selected.series.length - 1}:{' '}
                    {formatMoney(selected.endingReal)} in today’s dollars.
                  </p>
                )}
                <details className="hx-start-picker" ref={startPicker}>
                  <summary>Choose by start year</summary>
                  <label className="lv-field">
                    <span className="lv-label">Historical start year</span>
                    <select
                      className="lv-input"
                      value={selected?.startYear ?? ''}
                      onChange={(e) => pickStart(Number(e.target.value))}
                    >
                      {result.cohorts
                        .slice()
                        .reverse()
                        .map((co) => (
                          <option key={co.startYear} value={co.startYear}>
                            {co.startYear}–{co.startYear + co.series.length - 1}
                            {co.complete ? '' : ' (partial)'}
                          </option>
                        ))}
                    </select>
                  </label>
                  <p className="lv-small lv-muted">
                    A full run needs {result.horizon} consecutive years. Later starts replay only through{' '}
                    {result.dataThrough} and are excluded from the success rate.
                  </p>
                  <div className="lv-row hx-picks">
                    {(
                      [
                        ['Hardest', result.worst],
                        ['Middle', median],
                        ['Kindest', result.best],
                      ] as [string, Cohort | null | undefined][]
                    ).map(([label, cohort]) =>
                      cohort ? (
                        <Button
                          key={label}
                          size="sm"
                          aria-pressed={selected?.startYear === cohort.startYear}
                          onClick={() => pickStart(cohort.startYear)}
                        >
                          {label} · {cohort.startYear}
                        </Button>
                      ) : null,
                    )}
                  </div>
                </details>
                {selected && selected.series.length > 0 && (
                  <RunHeatMap
                    key={`${selected.startYear}-${selected.series.length}`}
                    run={selected}
                    result={result}
                  />
                )}
              </Card>
              <Fold
                title="The ten hardest start years"
                summary={sorted.length ? `${sorted[0].startYear} was the hardest` : undefined}
                storageKey="history-hardest"
                data-tour="worst-table"
              >
                <div className="lv-table-wrap" tabIndex={0} role="region" aria-label="Hardest starting years">
                  <table className="lv-table">
                    <thead>
                      <tr>
                        <th scope="col">Start</th>
                        <th scope="col">Outcome</th>
                        <th scope="col">Years funded</th>
                        <th scope="col">Lowest point</th>
                        <th scope="col">Ending wealth</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.slice(0, 10).map((c) => (
                        <tr key={c.startYear}>
                          <th scope="row">
                            <button
                              type="button"
                              className="hx-link"
                              onClick={() => chooseRun(c.startYear)}
                              aria-label={`Show ${c.startYear}`}
                            >
                              {c.startYear}
                            </button>
                          </th>
                          <td>{c.success ? 'Funded' : 'Ran short'}</td>
                          <td>{c.lastedYears}</td>
                          <td>{formatCompact(c.minReal)}</td>
                          <td>{formatCompact(c.endingReal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Fold>
            </div>
            <Card
              title={
                <span className="lv-label-row">
                  {selected
                    ? `Starting in ${selected.startYear} · through ${selected.startYear + selected.series.length - 1}`
                    : 'Every start year'}
                  <HelpTip>
                    International stocks and REITs follow US stocks here because they have no long public
                    history. Bonds are 10-year Treasuries, which lost more in the 1970s than the intermediate
                    bonds used in the Bengen and Trinity studies, so a 4% plan here can look a few points
                    worse than those studies report. Historical coverage is not a future probability.
                  </HelpTip>
                </span>
              }
              actions={
                <Button size="sm" aria-pressed={allCohorts} onClick={() => setAllCohorts((v) => !v)}>
                  {allCohorts ? 'Selected path only' : 'Show all paths'}
                </Button>
              }
              data-tour="history-chart"
            >
              {selected && (
                <div className="hx-story" data-outcome={outcomeOf(selected)} aria-live="polite">
                  <p>
                    {!selected.complete ? (
                      <>
                        <strong>Unfinished.</strong> History only covers {selected.series.length} of the{' '}
                        {result.horizon} years this plan runs, so a {selected.startYear} start cannot be
                        judged yet. Investments stood at {formatCompact(selected.endingReal)} when the data
                        ends in {result.dataThrough}.
                      </>
                    ) : selected.success ? (
                      <>
                        <strong>Funded all {selected.lastedYears} years</strong>
                        {role ? `: ${role}` : ''}. Investments fell as low as{' '}
                        {formatCompact(selected.minReal)} in year {lowIndex + 1} (
                        {selected.startYear + lowIndex}) and ended at {formatCompact(selected.endingReal)}.
                      </>
                    ) : (
                      <>
                        <strong>
                          Ran short after {selected.lastedYears}{' '}
                          {selected.lastedYears === 1 ? 'year' : 'years'}
                        </strong>
                        {role ? `: ${role}` : ''}. Starting in {selected.startYear}, the money was gone by{' '}
                        {selected.startYear + selected.lastedYears}, {result.horizon - selected.lastedYears}{' '}
                        years before the plan ends.
                      </>
                    )}
                  </p>
                  <dl className="hx-story-facts">
                    <div>
                      <dt>Lowest point</dt>
                      <dd>{formatCompact(selected.minReal)}</dd>
                    </div>
                    <div>
                      <dt>{selected.complete ? 'Ending investments' : 'When the data ends'}</dt>
                      <dd>{formatCompact(selected.endingReal)}</dd>
                    </div>
                    <div>
                      <dt>Rank, hardest first</dt>
                      <dd>{rank ? `${rank} of ${sorted.length}` : 'Not ranked'}</dd>
                    </div>
                  </dl>
                </div>
              )}
              <Chart
                label="Investments over the plan for each historical start year; the selected start year is highlighted"
                deps={[result, selected?.startYear, allCohorts]}
                height="var(--hx-chart-h)"
                onItemClick={(p) => {
                  const y = Number(p.seriesName);
                  if (Number.isFinite(y) && y > 0) setSelectedStart(y);
                }}
                footer={
                  <p className="lv-muted lv-small" style={{ margin: 0 }}>
                    {showHistoricalYears
                      ? 'Recorded market years, with your age in each corresponding plan year. Investments are in today’s dollars.'
                      : 'Each line uses a different historical start. The horizontal axis aligns them by your plan year and age.'}
                  </p>
                }
                table={() =>
                  showHistoricalYears
                    ? {
                        columns: ['Historical year', 'Plan year and ages', 'Investments, today’s dollars'],
                        rows: selected.series.map((v, i) => [
                          selected.startYear + i,
                          `${result.planStartYear + i} · ${householdAges(result.people, result.planStartYear + i)}`,
                          formatMoney(v),
                        ]),
                      }
                    : {
                        columns: [
                          'Start year',
                          'End year',
                          'Outcome',
                          'Years funded',
                          'Ending wealth',
                          'Lowest point',
                        ],
                        rows: sorted.map((c) => [
                          c.startYear,
                          c.startYear + result.horizon - 1,
                          c.success ? 'Funded' : 'Ran short',
                          c.lastedYears,
                          formatMoney(c.endingReal),
                          formatMoney(c.minReal),
                        ]),
                      }
                }
                build={(c) => ({
                  grid: { left: 56, right: 16, top: 12, bottom: 46 },
                  tooltip: {
                    ...tooltip(c),
                    trigger: showHistoricalYears ? 'axis' : 'item',
                    formatter: (params: HistoricalPoint | HistoricalPoint[]) => {
                      const p = Array.isArray(params) ? params[0] : params;
                      if (!p) return '';
                      return tooltipCard(c, {
                        title: `Started in ${p.seriesName}`,
                        subtitle: `${Number(p.seriesName) + p.dataIndex} in history · plan year ${result.planStartYear + p.dataIndex} · ${householdAges(result.people, result.planStartYear + p.dataIndex)}`,
                        rows: [{ name: 'Investments', value: formatMoney(p.value) }],
                      });
                    },
                  },
                  xAxis: {
                    type: 'category',
                    data: showHistoricalYears
                      ? selected.series.map((_, i) => selected.startYear + i)
                      : Array.from({ length: result.horizon }, (_, i) => result.planStartYear + i),
                    name: showHistoricalYears ? 'Historical year' : 'Plan year',
                    nameLocation: 'middle',
                    nameGap: 28,
                    nameTextStyle: { color: c.ink3, fontSize: 11 },
                    boundaryGap: false,
                    ...axis(c),
                    ...chartYearLabels(c, (year) => {
                      const planYear = showHistoricalYears
                        ? result.planStartYear + year - selected.startYear
                        : year;
                      return yearWithAges({ year, ages: result.people.map((p) => planYear - p.birthYear) });
                    }),
                    splitLine: { show: false },
                  },
                  yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
                  series: (allCohorts ? result.cohorts : selected ? [selected] : []).map((co) => {
                    const lit = co.startYear === selected?.startYear;
                    return {
                      name: String(co.startYear),
                      type: 'line',
                      symbol: 'circle',
                      symbolSize: 8,
                      showSymbol: false,
                      z: lit ? 5 : co.success ? 1 : 2,
                      itemStyle: { color: lit ? c.dawn[2] : co.success ? c.primary : c.danger },
                      lineStyle: lit
                        ? dawnLine(c, 3.5)
                        : {
                            width: 1,
                            color: co.success ? c.primary : c.danger,
                            opacity: co.complete ? (co.success ? 0.2 : 0.5) : 0.1,
                          },
                      data: co.series,
                      emphasis: lit ? { disabled: true } : { lineStyle: { width: 2.5, opacity: 1 } },
                    };
                  }),
                })}
              />
              {allCohorts && selected && (
                <details className="hx-path">
                  <summary>Year-by-year balances for a {selected.startYear} start</summary>
                  <div
                    className="lv-table-wrap hx-path-table"
                    role="region"
                    tabIndex={0}
                    aria-label="Selected historical path"
                  >
                    <table className="lv-table">
                      <thead>
                        <tr>
                          <th scope="col">Year of the plan</th>
                          <th scope="col">Historical year</th>
                          <th scope="col">Plan year and ages</th>
                          <th scope="col">Investments, today's dollars</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.series.map((v, i) => (
                          <tr key={i}>
                            <th scope="row">{i + 1}</th>
                            <td>{selected.startYear + i}</td>
                            <td>
                              {result.planStartYear + i} ·{' '}
                              {householdAges(result.people, result.planStartYear + i)}
                            </td>
                            <td>{formatMoney(v)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
