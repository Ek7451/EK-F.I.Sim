/**
 * Monte Carlo summary: merges per-run chunks into bands and statistics. Kept apart from the runner so the app's
 * main thread can summarise worker results without loading the projection loop.
 */
import type { Compiled } from '../compile';
import { returnMeansUsed, type PathSettings, type ReturnMeans } from './paths';

export interface McChunk {
  from: number;
  to: number;
  years: number;
  /** Investable assets in today's dollars (deflated by year-end CPI), [run * years + t]; NaN after the last death. */
  investable: Float32Array;
  success: Uint8Array;
  failYear: Int32Array;
  endingReal: Float64Array;
  /** Net estate to heirs in today's dollars at the end of the run. */
  estateReal: Float64Array;
  /** Net worth at the end of the run (everything owned less debts), today's dollars. */
  netWorthEndReal: Float64Array;
  lifetimeTaxReal: Float64Array;
  lastYearIndex: Int32Array;
  /** Years in which spending fell below plan (a flexible rule cut it, or a shortfall). */
  cutYears: Int32Array;
  /** Lowest ratio of actual to planned spending in any year (1 = never below plan). */
  minSpendRatio: Float64Array;
}

export interface McSummary {
  runs: number;
  seed: number;
  method: 'bootstrap' | 'parametric';
  /** Geometric nominal annual means the runs used, and whether they came from the plan or from raw history. */
  meansUsed: ReturnMeans;
  startYear: number;
  years: number[];
  /** Share of runs counted a success: spending covered every year, and the legacy goal when it counts. */
  successRate: number;
  /** Share of runs with spending covered every year (the success rate when no goal counts). */
  fundedRate: number;
  /** The ending net-worth goal (today's dollars) and the share of runs that meet it; null when none is set. */
  legacyGoal: { goal: number; metRate: number; countsForSuccess: boolean } | null;
  /**
   * Percentile bands of investable assets in today's dollars, by year. With stochastic longevity, a year's bands use
   * only the runs still going that year (see `activeShare`).
   */
  bands: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] };
  /** Share of runs still going (someone alive) by year. */
  activeShare: number[];
  /** Share of runs still solvent (no shortfall so far) by year. */
  solventShare: number[];
  /** Count of first-failure years. */
  failureYears: { year: number; count: number }[];
  /** Ending investable wealth distribution in today's dollars (sorted ascending). */
  endingWealth: number[];
  endingPercentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  /** Net estate to heirs (after estate tax and heirs' tax on pre-tax accounts), today's dollars, sorted ascending. */
  netEstate: number[];
  netEstatePercentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  /** Spending cuts: how often and how deeply spending fell below plan. */
  spendingCuts: {
    /** Share of runs with at least one year below plan. */
    shareOfRuns: number;
    /** Years below plan per run: median and 90th percentile. */
    medianYears: number;
    p90Years: number;
    /** Lowest spending as a fraction of plan in any year: median run and the worst-10% run. */
    lowestVsPlan: { p50: number; p10: number };
  };
  medianLifetimeTax: number;
  /** A few sample paths for display. */
  samples: number[][];
}

export function quantileSorted(sorted: ArrayLike<number>, n: number, q: number): number {
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const pctiles = (sorted: number[]): { p10: number; p25: number; p50: number; p75: number; p90: number } => ({
  p10: quantileSorted(sorted, sorted.length, 0.1),
  p25: quantileSorted(sorted, sorted.length, 0.25),
  p50: quantileSorted(sorted, sorted.length, 0.5),
  p75: quantileSorted(sorted, sorted.length, 0.75),
  p90: quantileSorted(sorted, sorted.length, 0.9),
});

export function summarizeMonteCarlo(
  c: Compiled,
  chunks: McChunk[],
  seed: number,
  method: 'bootstrap' | 'parametric',
  settings?: Partial<PathSettings>,
): McSummary {
  const years = c.maxYears;
  let runs = 0;
  for (const ch of chunks) runs += ch.to - ch.from;
  const bands = {
    p10: [] as number[],
    p25: [] as number[],
    p50: [] as number[],
    p75: [] as number[],
    p90: [] as number[],
  };
  const solventShare: number[] = [];
  const activeShare: number[] = [];
  const col = new Float64Array(runs);
  let usedYears = 0;
  for (let t = 0; t < years; t++) {
    let n = 0;
    let solvent = 0;
    for (const ch of chunks) {
      const cnt = ch.to - ch.from;
      for (let r = 0; r < cnt; r++) {
        const v = ch.investable[r * years + t];
        const fy = ch.failYear[r];
        if (fy < 0 || fy > c.startYear + t) solvent++;
        // Runs that have ended (everyone has died) drop out of the bands instead of carrying a balance forward.
        if (Number.isNaN(v)) continue;
        col[n++] = v;
        usedYears = Math.max(usedYears, t + 1);
      }
    }
    const sorted = col.subarray(0, n).slice().sort();
    bands.p10.push(quantileSorted(sorted, n, 0.1));
    bands.p25.push(quantileSorted(sorted, n, 0.25));
    bands.p50.push(quantileSorted(sorted, n, 0.5));
    bands.p75.push(quantileSorted(sorted, n, 0.75));
    bands.p90.push(quantileSorted(sorted, n, 0.9));
    solventShare.push(runs ? solvent / runs : 0);
    activeShare.push(runs ? n / runs : 0);
  }
  for (const key of Object.keys(bands) as (keyof typeof bands)[]) bands[key].length = usedYears;
  solventShare.length = usedYears;
  activeShare.length = usedYears;
  let ok = 0;
  let withCuts = 0;
  const est = c.plan.strategies.estate;
  const goal = est.legacyGoal / 100;
  let goalOk = 0;
  let bothOk = 0;
  const fail = new Map<number, number>();
  const ending: number[] = [];
  const estate: number[] = [];
  const taxes: number[] = [];
  const cutYears: number[] = [];
  const minRatios: number[] = [];
  const samples: number[][] = [];
  for (const ch of chunks) {
    const cnt = ch.to - ch.from;
    for (let r = 0; r < cnt; r++) {
      if (ch.success[r]) ok++;
      const met = ch.netWorthEndReal[r] >= goal - 0.5;
      if (met) goalOk++;
      if (ch.success[r] && met) bothOk++;
      // Only a run that ran short has a year it ran short in. A funded run that missed the ending goal does not.
      if (!ch.success[r]) fail.set(ch.failYear[r], (fail.get(ch.failYear[r]) ?? 0) + 1);
      ending.push(ch.endingReal[r]);
      estate.push(ch.estateReal[r]);
      taxes.push(ch.lifetimeTaxReal[r]);
      cutYears.push(ch.cutYears[r]);
      minRatios.push(ch.minSpendRatio[r]);
      if (ch.cutYears[r] > 0) withCuts++;
      if (samples.length < 12) {
        const s: number[] = [];
        for (let t = 0; t <= ch.lastYearIndex[r]; t++) s.push(ch.investable[r * years + t]);
        samples.push(s);
      }
    }
  }
  const asc = (a: number, b: number): number => a - b;
  ending.sort(asc);
  estate.sort(asc);
  taxes.sort(asc);
  cutYears.sort(asc);
  minRatios.sort(asc);
  const full = { ...c.plan.assumptions.monteCarlo, ...settings, method };
  return {
    runs,
    seed,
    method,
    meansUsed: returnMeansUsed(c, {
      method,
      blockLength: full.blockLength,
      inflation: full.inflation,
      stochasticLongevity: full.stochasticLongevity,
      bootstrapMeans: full.bootstrapMeans,
    }),
    startYear: c.startYear,
    years: Array.from({ length: usedYears }, (_, i) => c.startYear + i),
    successRate: runs ? (goal > 0 && est.legacyGoalForSuccess ? bothOk : ok) / runs : 0,
    fundedRate: runs ? ok / runs : 0,
    legacyGoal:
      goal > 0
        ? { goal, metRate: runs ? goalOk / runs : 0, countsForSuccess: est.legacyGoalForSuccess }
        : null,
    bands,
    activeShare,
    solventShare,
    failureYears: [...fail.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    endingWealth: ending,
    endingPercentiles: pctiles(ending),
    netEstate: estate,
    netEstatePercentiles: pctiles(estate),
    spendingCuts: {
      shareOfRuns: runs ? withCuts / runs : 0,
      medianYears: quantileSorted(cutYears, runs, 0.5),
      p90Years: quantileSorted(cutYears, runs, 0.9),
      lowestVsPlan: {
        p50: quantileSorted(minRatios, runs, 0.5),
        p10: quantileSorted(minRatios, runs, 0.1),
      },
    },
    medianLifetimeTax: quantileSorted(taxes, runs, 0.5),
    samples,
  };
}

/** Convenience: run everything on the calling thread. */
