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
import { PageHead } from '../../shell/Shell';

type Cohort = BacktestResult['cohorts'][number];

const outcomeOf = (co: Cohort): 'partial' | 'funded' | 'short' =>
  !co.complete ? 'partial' : co.success ? 'funded' : 'short';

/** What one start year did, in a phrase (the cell's accessible name and its hover text). */
const cellLabel = (co: Cohort): string =>
  !co.complete
    ? `${co.startYear}: unfinished, history covers ${co.series.length} ${co.series.length === 1 ? 'year' : 'years'}`
    : co.success
      ? `${co.startYear}: funded, lowest point ${formatMoney(co.minReal)}, ended with ${formatMoney(co.endingReal)}`
      : `${co.startYear}: ran short after ${co.lastedYears} ${co.lastedYears === 1 ? 'year' : 'years'}`;

/**
 * Every start year as one small cell, a decade to a row. Funded years are shaded by where they ended (five
 * steps, lightest = least left); years that ran short and years history has not finished are marked by
 * pattern as well as colour. One tab stop; arrow keys move by a year or a decade.
 */
function CohortMap({
  cohorts,
  selected,
  onSelect,
}: {
  cohorts: Cohort[];
  selected: number | null;
  onSelect: (year: number) => void;
}): ReactNode {
  const grid = useRef<HTMLDivElement>(null);
  const byYear = useMemo(() => new Map(cohorts.map((c) => [c.startYear, c])), [cohorts]);
  // Quintile of ending wealth among the funded, complete cohorts.
  const level = useMemo(() => {
    const ends = cohorts
      .filter((c) => c.complete && c.success)
      .map((c) => c.endingReal)
      .sort((a, b) => a - b);
    return (co: Cohort): number => {
      if (!ends.length) return 3;
      let rank = 0;
      while (rank < ends.length && ends[rank] <= co.endingReal) rank++;
      return Math.min(5, Math.max(1, Math.ceil((rank / ends.length) * 5)));
    };
  }, [cohorts]);
  if (!cohorts.length) return null;
  const first = cohorts[0].startYear;
  const last = cohorts[cohorts.length - 1].startYear;
  const decades: number[] = [];
  for (let d = Math.floor(first / 10) * 10; d <= last; d += 10) decades.push(d);
  const focusYear = (year: number): void => {
    const y = Math.max(first, Math.min(last, year));
    onSelect(y);
    // Every cell is already in the page, so focus can move at once (no frame to wait for).
    grid.current?.querySelector<HTMLElement>(`[data-year="${y}"]`)?.focus();
  };
  const onKey = (e: KeyboardEvent, year: number): void => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -10, ArrowDown: 10 };
    if (e.key in step) {
      e.preventDefault();
      focusYear(year + step[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusYear(first);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusYear(last);
    }
  };
  const tabYear = selected !== null && byYear.has(selected) ? selected : first;
  return (
    <div
      className="hx-map"
      ref={grid}
      role="group"
      aria-label="Historical start years. Arrow keys move by a year or a decade."
    >
      <div className="hx-map-head" aria-hidden="true">
        <span />
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i}>{i}</span>
        ))}
      </div>
      {decades.map((d) => (
        <div className="hx-map-row" key={d}>
          <span className="hx-map-decade" aria-hidden="true">
            {d}s
          </span>
          {Array.from({ length: 10 }, (_, i) => {
            const co = byYear.get(d + i);
            if (!co) return <span key={i} className="hx-cell" data-empty="" aria-hidden="true" />;
            const outcome = outcomeOf(co);
            return (
              <button
                type="button"
                key={i}
                className="hx-cell"
                data-year={co.startYear}
                data-outcome={outcome}
                data-level={outcome === 'funded' ? level(co) : undefined}
                aria-pressed={selected === co.startYear}
                aria-label={cellLabel(co)}
                title={cellLabel(co)}
                tabIndex={co.startYear === tabYear ? 0 : -1}
                onClick={() => onSelect(co.startYear)}
                onKeyDown={(e) => onKey(e, co.startYear)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function HistoryPage(): ReactNode {
  const { result, running, error, retry, cancel } = useBacktest(true);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [allCohorts, setAllCohorts] = useState(true);
  const selected = result?.cohorts.find((c) => c.startYear === selectedStart) ?? result?.worst ?? null;
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
        intro="Your plan replayed from every starting year since 1871, using what markets and inflation actually did next. It shows how the plan copes with a bad run of early years."
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
          <Card variant="hero" data-tour="history-stats">
            <div className="hx-band">
              <Stat
                label="Start years that worked"
                value={`${result.successCount} of ${result.completeCount}`}
                note={`${formatPct(result.successRate, 1)} of full histories`}
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
                note={`History ends in ${result.dataThrough}`}
              />
            </div>
          </Card>
          <div className="hx-main">
            <div className="hx-side">
              <Card title="Pick a start year" data-tour="history-map">
                <p className="lv-small lv-muted">
                  Each square is your plan started in that year and run through the {result.horizon} years
                  that really followed. A stronger colour means more left at the end.
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
                        onClick={() => setSelectedStart(cohort.startYear)}
                      >
                        {label} · {cohort.startYear}
                      </Button>
                    ) : null,
                  )}
                </div>
                <CohortMap
                  cohorts={result.cohorts}
                  selected={selected?.startYear ?? null}
                  onSelect={setSelectedStart}
                />
                <p className="hx-key lv-small lv-muted">
                  <span>
                    <i data-level="1" />
                    <i data-level="3" />
                    <i data-level="5" />
                    Funded: less to more left
                  </span>
                  <span>
                    <i data-outcome="short" />
                    Ran short
                  </span>
                  <span>
                    <i data-outcome="partial" />
                    Unfinished
                  </span>
                </p>
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
                              onClick={() => setSelectedStart(c.startYear)}
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
                  {selected ? `Starting in ${selected.startYear}` : 'Every start year'}
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
                    One line per start year, in today's dollars. The lit line is{' '}
                    {selected?.startYear ?? 'the selection'}; red lines ran short; click a line to select it.
                  </p>
                }
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
                  grid: { left: 56, right: 16, top: 12, bottom: 46 },
                  tooltip: {
                    ...tooltip(c),
                    trigger: 'item',
                    formatter: (p: { seriesName: string; value: number; dataIndex: number }) =>
                      tooltipCard(c, {
                        title: `Started in ${p.seriesName}`,
                        subtitle: `Year ${p.dataIndex + 1} of the plan · ${Number(p.seriesName) + p.dataIndex} in history`,
                        rows: [{ name: 'Investments', value: formatMoney(p.value) }],
                      }),
                  },
                  xAxis: {
                    type: 'category',
                    data: Array.from({ length: result.horizon }, (_, i) => i + 1),
                    name: 'Year of the plan',
                    nameLocation: 'middle',
                    nameGap: 28,
                    nameTextStyle: { color: c.ink3, fontSize: 11 },
                    boundaryGap: false,
                    ...axis(c),
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
              {selected && (
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
                          <th scope="col">Investments, today's dollars</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.series.map((v, i) => (
                          <tr key={i}>
                            <th scope="row">{i + 1}</th>
                            <td>{selected.startYear + i}</td>
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
