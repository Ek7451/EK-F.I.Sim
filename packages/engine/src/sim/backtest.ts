/** Historical backtesting over rolling start-year cohorts (SIM-04, plan 7.2). */
import type { Compiled } from '../compile';
import { runPath } from '../projection';
import { historicalPath } from './paths';

export interface Cohort {
  startYear: number;
  complete: boolean;
  years: number;
  success: boolean;
  /** Years the portfolio lasted before the first shortfall (= years when it never failed). */
  lastedYears: number;
  endingReal: number;
  minReal: number;
  /** Investable assets in today's dollars by year. */
  series: number[];
}

export interface BacktestResult {
  horizon: number;
  cohorts: Cohort[];
  completeCount: number;
  successCount: number;
  successRate: number;
  worst: Cohort | null;
  best: Cohort | null;
  medianEndingReal: number;
  partialCount: number;
  dataThrough: number;
}

export function runBacktest(c: Compiled, opts: { fromYear?: number; toYear?: number } = {}): BacktestResult {
  const m = c.data.market;
  const horizon = c.maxYears;
  const cohorts: Cohort[] = [];
  for (let i = 0; i < m.years.length; i++) {
    const sy = m.years[i];
    if (opts.fromYear !== undefined && sy < opts.fromYear) continue;
    if (opts.toYear !== undefined && sy > opts.toYear) continue;
    const available = m.years.length - i;
    const path = historicalPath(c, i, horizon);
    const res = runPath(c, path);
    const series: number[] = [];
    let min = Infinity;
    for (let t = 0; t < res.n; t++) {
      const v = res.investable[t] / res.cpi[t] / (1 + path.inflation[t]);
      series.push(v);
      if (v < min) min = v;
    }
    const failedIdx = res.failedYear === null ? -1 : res.failedYear - c.startYear;
    cohorts.push({
      startYear: sy,
      complete: available >= horizon,
      years: res.n,
      success: res.success,
      lastedYears: failedIdx < 0 ? res.n : failedIdx,
      endingReal: series[series.length - 1] ?? 0,
      minReal: min,
      series,
    });
  }
  const complete = cohorts.filter((x) => x.complete);
  const ok = complete.filter((x) => x.success).length;
  const sortedEnd = complete.map((x) => x.endingReal).sort((a, b) => a - b);
  const byWorst = [...complete].sort((a, b) => a.lastedYears - b.lastedYears || a.endingReal - b.endingReal);
  return {
    horizon,
    cohorts,
    completeCount: complete.length,
    successCount: ok,
    successRate: complete.length ? ok / complete.length : 0,
    worst: byWorst[0] ?? null,
    best: byWorst[byWorst.length - 1] ?? null,
    medianEndingReal: sortedEnd.length ? sortedEnd[Math.floor((sortedEnd.length - 1) / 2)] : 0,
    partialCount: cohorts.length - complete.length,
    dataThrough: m.years[m.years.length - 1],
  };
}
