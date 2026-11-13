import {
  Badge,
  Button,
  Card,
  Notice,
  Stat,
  formatCompact,
  formatMoney,
  formatPct,
  formatShare,
} from '@fisim/ui';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Chart, alpha, axis, barFill, dawnLine, short, tooltip, tooltipCard } from '../../charts/Chart';
import { useMonteCarlo } from '../../engine/useResults';
import { PageHead } from '../../shell/Shell';
import { usePlan } from '../../state/store';

/**
 * The success rate as an instrument dial: a three-quarter arc lit in the dawn spectrum. Decorative; the figure
 * itself is the Stat set inside it.
 */
function SuccessDial({ rate }: { rate: number | null }): ReactNode {
  const r = 58;
  const sweep = 0.75 * 2 * Math.PI * r;
  const lit = sweep * Math.max(0, Math.min(1, rate ?? 0));
  return (
    <svg className="dial" viewBox="0 0 140 140" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="dial-dawn" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--dawn-indigo)" />
          <stop offset="0.4" stopColor="var(--dawn-violet)" />
          <stop offset="0.72" stopColor="var(--dawn-rose)" />
          <stop offset="1" stopColor="var(--dawn-amber)" />
        </linearGradient>
      </defs>
      <g transform="rotate(135 70 70)" fill="none" strokeWidth="11" strokeLinecap="round">
        <circle className="dial-track" cx="70" cy="70" r={r} strokeDasharray={`${sweep} 999`} />
        <circle
          className="dial-lit"
          cx="70"
          cy="70"
          r={r}
          stroke="url(#dial-dawn)"
          strokeDasharray={`${lit} 999`}
        />
      </g>
    </svg>
  );
}

export function SuccessPage(): ReactNode {
  const plan = usePlan()!;
  const { summary, progress, running, cancel, rerun, error: simulationError, partial } = useMonteCarlo(true);
  const [showSamples, setShowSamples] = useState(false);
  const mc = plan.assumptions.monteCarlo;
  return (
    <>
      <PageHead
        group="explore"
        title="Chance of success"
        intro="Thousands of possible futures, each with its own sequence of returns and inflation. Success means every year's spending was paid for. A simulation is a range of estimates, not a prediction."
        actions={
          <span className="lv-row">
            <Badge>Estimated</Badge>
            <Badge>{mc.method === 'bootstrap' ? 'Replays real history in blocks' : 'Random draws'}</Badge>
          </span>
        }
      />
      {simulationError && (
        <Notice tone="danger">Simulation failed: {simulationError}. Use Run again to retry.</Notice>
      )}
      {partial && (
        <Notice tone="warn">
          Partial results · {summary?.runs.toLocaleString()} completed runs.{' '}
          {running ? 'The estimate is still updating.' : 'The run stopped before completion.'}
        </Notice>
      )}
      <Card variant="hero" data-tour="mc-status">
        <div className="lv-spread success-hero">
          <div className="success-dial" data-tour="success-rate">
            <SuccessDial rate={summary ? summary.successRate : null} />
            <Stat
              label="Chance of success"
              value={summary ? formatShare(summary.successRate) : '…'}
              note={
                summary
                  ? `${summary.runs.toLocaleString()} of ${mc.runs.toLocaleString()} runs · seed ${mc.seed}${summary.legacyGoal?.countsForSuccess ? ' · includes your ending goal' : ''}`
                  : running
                    ? 'Starting…'
                    : 'No completed runs'
              }
            />
          </div>
          <div className="lv-grid" style={{ flex: 1 }}>
            {summary?.legacyGoal ? (
              <Stat
                label={`Leave at least ${formatCompact(summary.legacyGoal.goal)}`}
                value={formatShare(summary.legacyGoal.metRate)}
                note={`of runs end with that much or more. Spending covered every year in ${formatShare(summary.fundedRate)}`}
                data-tour="legacy-goal-rate"
              />
            ) : null}
            <Stat
              label="Median ending investments"
              value={summary ? formatCompact(summary.endingPercentiles.p50) : '…'}
              note="Today's dollars"
            />
            <Stat
              label="Ending investments (10th percentile)"
              value={summary ? formatCompact(summary.endingPercentiles.p10) : '…'}
            />
            <Stat
              label="Ending investments (90th percentile)"
              value={summary ? formatCompact(summary.endingPercentiles.p90) : '…'}
            />
          </div>
          <div className="lv-row">
            {running ? (
              <Button onClick={cancel} data-tour="mc-cancel">
                Stop
              </Button>
            ) : (
              <Button onClick={rerun} data-tour="mc-rerun">
                Run again
              </Button>
            )}
          </div>
        </div>
        {running ? (
          <div
            className="lv-progress"
            style={{ marginTop: 16 }}
            role="progressbar"
            aria-label="Simulation progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        ) : (
          <p className="lv-small lv-muted" role="status">
            {progress === 1 ? 'Simulation complete' : 'Simulation stopped'}
          </p>
        )}
      </Card>
      {summary ? (
        <>
          <Card title="Spending resilience">
            <div className="lv-grid">
              <Stat
                label="Runs with spending below plan"
                value={formatPct(summary.spendingCuts.shareOfRuns)}
              />
              <Stat
                label="Years below plan, median run"
                value={summary.spendingCuts.medianYears.toFixed(1)}
                note={`90th percentile: ${summary.spendingCuts.p90Years.toFixed(1)} years`}
              />
              <Stat
                label="Lowest spending, median run"
                value={formatPct(summary.spendingCuts.lowestVsPlan.p50)}
                note="As a share of planned spending"
              />
              <Stat
                label="Lowest spending, 10th percentile"
                value={formatPct(summary.spendingCuts.lowestVsPlan.p10)}
                note="As a share of planned spending"
              />
            </div>
            <p className="lv-small lv-muted">
              Includes flexible-rule reductions and unfunded shortfalls. A funded run can still require
              spending changes. {partial ? 'These statistics describe completed runs so far.' : ''}
            </p>
          </Card>
          <Card
            title="Range of outcomes"
            data-tour="fan-chart"
            actions={
              <Button size="sm" aria-pressed={showSamples} onClick={() => setShowSamples((v) => !v)}>
                {showSamples ? 'Hide sample paths' : 'Show sample paths'}
              </Button>
            }
          >
            <Chart
              label="Investments over time: median with 25th to 75th and 10th to 90th percentile bands"
              deps={[summary, showSamples]}
              height="var(--chart-h)"
              table={() => ({
                columns: ['Year', '10th', '25th', 'Median', '75th', '90th', 'Still funded', 'Still alive'],
                rows: summary.years.map((y, i) => [
                  y,
                  formatMoney(summary.bands.p10[i]),
                  formatMoney(summary.bands.p25[i]),
                  formatMoney(summary.bands.p50[i]),
                  formatMoney(summary.bands.p75[i]),
                  formatMoney(summary.bands.p90[i]),
                  formatPct(summary.solventShare[i]),
                  formatPct(summary.activeShare[i]),
                ]),
              })}
              build={(c) => {
                const b = summary.bands;
                const band = (name: string, lo: number[], hi: number[], opacity: number): object[] => [
                  {
                    name: `${name} base`,
                    type: 'line',
                    stack: name,
                    symbol: 'none',
                    lineStyle: { opacity: 0 },
                    data: lo.map((v) => Math.max(0, v)),
                    tooltip: { show: false },
                    silent: true,
                  },
                  {
                    name,
                    type: 'line',
                    stack: name,
                    symbol: 'none',
                    lineStyle: { opacity: 0 },
                    areaStyle: { color: c.dawn[1], opacity },
                    data: hi.map((v, i) => Math.max(0, v - Math.max(0, lo[i]))),
                    silent: true,
                    tooltip: { show: false },
                  },
                ];
                return {
                  grid: { left: 56, right: 16, top: 16, bottom: 32 },
                  tooltip: {
                    ...tooltip(c),
                    trigger: 'axis',
                    formatter: (ps: { dataIndex: number }[]) => {
                      const i = ps[0].dataIndex;
                      return tooltipCard(c, {
                        title: `End of ${summary.years[i]}`,
                        subtitle: "Investments across runs, today's dollars",
                        rows: [
                          {
                            name: '90th percentile',
                            color: alpha(c.dawn[1], 0.35),
                            value: formatMoney(b.p90[i]),
                          },
                          {
                            name: '75th percentile',
                            color: alpha(c.dawn[1], 0.6),
                            value: formatMoney(b.p75[i]),
                          },
                          { name: 'Median', color: c.dawn[2], value: formatMoney(b.p50[i]) },
                          {
                            name: '25th percentile',
                            color: alpha(c.dawn[1], 0.6),
                            value: formatMoney(b.p25[i]),
                          },
                          {
                            name: '10th percentile',
                            color: alpha(c.dawn[1], 0.35),
                            value: formatMoney(b.p10[i]),
                          },
                        ],
                        notes: [{ text: `Still funded: ${formatShare(summary.solventShare[i])} of runs` }],
                      });
                    },
                  },
                  xAxis: {
                    type: 'category',
                    data: summary.years,
                    boundaryGap: false,
                    ...axis(c),
                    splitLine: { show: false },
                  },
                  yAxis: { type: 'value', ...axis(c), axisLabel: { color: c.ink3, formatter: short } },
                  series: [
                    ...band('10th to 90th', b.p10, b.p90, 0.18),
                    ...band('25th to 75th', b.p25, b.p75, 0.32),
                    ...(showSamples ? summary.samples.slice(0, 4) : []).map((s2, i) => ({
                      name: `Sample ${i + 1}`,
                      type: 'line',
                      symbol: 'none',
                      silent: true,
                      lineStyle: { width: 1, color: c.ink3, opacity: 0.5 },
                      data: s2,
                      tooltip: { show: false },
                    })),
                    {
                      name: 'Median',
                      type: 'line',
                      symbol: 'circle',
                      symbolSize: 10,
                      showSymbol: false,
                      lineStyle: dawnLine(c, 3.5),
                      itemStyle: { color: c.dawn[2], borderColor: '#fff', borderWidth: 2 },
                      data: b.p50,
                    },
                  ],
                };
              }}
            />
            <p className="lv-muted lv-small">
              Today's dollars. The dark band holds the middle half of runs; the light band holds eight in ten.
              Bands combine different runs at each year; they are not one realizable path or a confidence
              interval for the success probability. Optional thin lines are individual runs. With varying
              lifespans, bands include only runs with someone still alive; the table shows that share.
            </p>
          </Card>
          <div className="two-col" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
            <Card title="When plans ran short" data-tour="failure-years">
              {summary.failureYears.length === 0 ? (
                <p className="lv-muted">No run ran short of money.</p>
              ) : (
                <Chart
                  label="Number of runs that first ran short, by year"
                  deps={[summary]}
                  height={240}
                  table={() => ({
                    columns: ['Year', 'Runs'],
                    rows: summary.failureYears.map((f) => [f.year, f.count]),
                  })}
                  build={(c) => {
                    // Every year from the first failure to the last, so a gap between two bars is a real gap in time.
                    const counts = new Map(summary.failureYears.map((f) => [f.year, f.count]));
                    const first = Math.min(...counts.keys());
                    const last = Math.max(...counts.keys());
                    const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
                    return {
                      grid: { left: 40, right: 12, top: 12, bottom: 28 },
                      tooltip: { ...tooltip(c), trigger: 'axis' },
                      xAxis: { type: 'category', data: years, ...axis(c), splitLine: { show: false } },
                      yAxis: { type: 'value', minInterval: 1, ...axis(c) },
                      series: [
                        {
                          type: 'bar',
                          name: 'Runs',
                          barMaxWidth: 28,
                          data: years.map((y) => counts.get(y) ?? 0),
                          itemStyle: { color: barFill(c.danger), borderRadius: [6, 6, 0, 0] },
                        },
                      ],
                    };
                  }}
                />
              )}
            </Card>
            <Card title="How the simulation is set up" data-tour="mc-setup">
              <ul style={{ margin: 0, paddingLeft: 18 }} className="lv-stack">
                <li>
                  {mc.method === 'bootstrap'
                    ? `Each run strings together ${mc.blockLength}-year blocks of real history, so stocks, bonds, cash and inflation move together as they actually did.`
                    : 'Each run draws returns at random around your assumptions, keeping the usual relationships between asset classes.'}
                </li>
                {mc.method === 'bootstrap' ? (
                  <li>
                    {mc.bootstrapMeans === 'historical'
                      ? 'Replayed history keeps its own average returns, not the expected returns set under Assumptions. Past US returns were higher than most forward-looking assumptions, so these runs can look more generous than the single-path projection.'
                      : 'The replayed years keep their real ups and downs, re-centred so their long-run average matches the expected returns set under Assumptions.'}
                  </li>
                ) : null}
                <li>
                  {mc.stochasticLongevity
                    ? 'Lifespans vary from run to run using Social Security life tables.'
                    : 'Every run lasts to the ages set under Household.'}
                </li>
                <li>Seed {mc.seed}: the same plan and seed always give this exact result.</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                <Link to="/plan/assumptions">Change simulation settings →</Link>
              </p>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <p className="lv-muted" role="status">
            {running
              ? 'Running the first batch…'
              : 'No completed runs. Choose Run again to start a new simulation.'}
          </p>
        </Card>
      )}
    </>
  );
}
