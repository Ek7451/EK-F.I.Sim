/**
 * Monte Carlo runner (SIM-02, SIM-03, SIM-10). Runs are independent streams keyed by (seed, run index),
 * so a chunk [from, to) can be computed on any worker and merged with identical results.
 * Only per-run summaries and one float per run-year are kept (plan 7.1); full paths are not stored.
 */
import type { Compiled } from '../compile';
import { runPath } from '../projection';
import { generatePath, type PathSettings } from './paths';

export interface McChunk {
  from: number;
  to: number;
  years: number;
  /** Investable assets in today's dollars, [run * years + t]; NaN after the last death. */
  investable: Float32Array;
  success: Uint8Array;
  failYear: Int32Array;
  endingReal: Float64Array;
  lifetimeTaxReal: Float64Array;
  lastYearIndex: Int32Array;
}

export interface McSummary {
  runs: number;
  seed: number;
  method: 'bootstrap' | 'parametric';
  startYear: number;
  years: number[];
  successRate: number;
  /** Percentile bands of investable assets in today's dollars, by year. */
  bands: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] };
  /** Share of runs still solvent (no shortfall so far) by year. */
  solventShare: number[];
  /** Count of first-failure years. */
  failureYears: { year: number; count: number }[];
  /** Ending wealth distribution in today's dollars (sorted ascending). */
  endingWealth: number[];
  endingPercentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
  medianLifetimeTax: number;
  /** A few sample paths for display. */
  samples: number[][];
}

export function mcSettings(c: Compiled): PathSettings & { runs: number; seed: number } {
  const m = c.plan.assumptions.monteCarlo;
  return {
    method: m.method,
    blockLength: m.blockLength,
    inflation: m.inflation,
    stochasticLongevity: m.stochasticLongevity,
    runs: m.runs,
    seed: m.seed,
  };
}

export function runMonteCarloChunk(
  c: Compiled,
  settings: PathSettings & { seed: number },
  from: number,
  to: number,
  shouldCancel?: () => boolean,
): McChunk {
  const years = c.maxYears;
  const count = to - from;
  const chunk: McChunk = {
    from,
    to,
    years,
    investable: new Float32Array(count * years).fill(NaN),
    success: new Uint8Array(count),
    failYear: new Int32Array(count).fill(-1),
    endingReal: new Float64Array(count),
    lifetimeTaxReal: new Float64Array(count),
    lastYearIndex: new Int32Array(count),
  };
  for (let r = 0; r < count; r++) {
    if (shouldCancel && r % 16 === 0 && shouldCancel()) {
      chunk.to = from + r;
      break;
    }
    const path = generatePath(c, settings, settings.seed, from + r);
    const res = runPath(c, path);
    const o = r * years;
    for (let t = 0; t < res.n; t++)
      chunk.investable[o + t] = res.investable[t] / res.cpi[t] / (1 + path.inflation[t]);
    chunk.success[r] = res.success ? 1 : 0;
    chunk.failYear[r] = res.failedYear ?? -1;
    const last = Math.max(0, res.n - 1);
    chunk.endingReal[r] = chunk.investable[o + last];
    chunk.lifetimeTaxReal[r] = res.lifetimeTax;
    chunk.lastYearIndex[r] = last;
  }
  return chunk;
}

function quantileSorted(sorted: ArrayLike<number>, n: number, q: number): number {
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarizeMonteCarlo(
  c: Compiled,
  chunks: McChunk[],
  seed: number,
  method: 'bootstrap' | 'parametric',
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
  const col = new Float64Array(runs);
  let usedYears = 0;
  for (let t = 0; t < years; t++) {
    let n = 0;
    let solvent = 0;
    for (const ch of chunks) {
      const cnt = ch.to - ch.from;
      for (let r = 0; r < cnt; r++) {
        const v = ch.investable[r * years + t];
        // Runs that ended (death) carry their last value forward so bands are not biased to survivors.
        const val = Number.isNaN(v) ? ch.endingReal[r] : v;
        col[n++] = val;
        const fy = ch.failYear[r];
        if (fy < 0 || fy > c.startYear + t) solvent++;
        if (!Number.isNaN(v)) usedYears = Math.max(usedYears, t + 1);
      }
    }
    const sorted = col.subarray(0, n).slice().sort();
    bands.p10.push(quantileSorted(sorted, n, 0.1));
    bands.p25.push(quantileSorted(sorted, n, 0.25));
    bands.p50.push(quantileSorted(sorted, n, 0.5));
    bands.p75.push(quantileSorted(sorted, n, 0.75));
    bands.p90.push(quantileSorted(sorted, n, 0.9));
    solventShare.push(n ? solvent / n : 0);
  }
  for (const key of Object.keys(bands) as (keyof typeof bands)[]) bands[key].length = usedYears;
  solventShare.length = usedYears;
  let ok = 0;
  const fail = new Map<number, number>();
  const ending: number[] = [];
  const taxes: number[] = [];
  const samples: number[][] = [];
  for (const ch of chunks) {
    const cnt = ch.to - ch.from;
    for (let r = 0; r < cnt; r++) {
      if (ch.success[r]) ok++;
      else fail.set(ch.failYear[r], (fail.get(ch.failYear[r]) ?? 0) + 1);
      ending.push(ch.endingReal[r]);
      taxes.push(ch.lifetimeTaxReal[r]);
      if (samples.length < 12) {
        const s: number[] = [];
        for (let t = 0; t <= ch.lastYearIndex[r]; t++) s.push(ch.investable[r * years + t]);
        samples.push(s);
      }
    }
  }
  ending.sort((a, b) => a - b);
  taxes.sort((a, b) => a - b);
  return {
    runs,
    seed,
    method,
    startYear: c.startYear,
    years: Array.from({ length: usedYears }, (_, i) => c.startYear + i),
    successRate: runs ? ok / runs : 0,
    bands,
    solventShare,
    failureYears: [...fail.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
    endingWealth: ending,
    endingPercentiles: {
      p10: quantileSorted(ending, runs, 0.1),
      p25: quantileSorted(ending, runs, 0.25),
      p50: quantileSorted(ending, runs, 0.5),
      p75: quantileSorted(ending, runs, 0.75),
      p90: quantileSorted(ending, runs, 0.9),
    },
    medianLifetimeTax: quantileSorted(taxes, runs, 0.5),
    samples,
  };
}

/** Convenience: run everything on the calling thread. */
export function runMonteCarlo(
  c: Compiled,
  overrides: Partial<PathSettings & { runs: number; seed: number }> = {},
): McSummary {
  const s = { ...mcSettings(c), ...overrides };
  const chunk = runMonteCarloChunk(c, s, 0, s.runs);
  return summarizeMonteCarlo(c, [chunk], s.seed, s.method);
}
