/**
 * Monte Carlo runner (SIM-02, SIM-03, SIM-10). Runs are independent streams keyed by (seed, run index),
 * so a chunk [from, to) can be computed on any worker and merged with identical results.
 * Only per-run summaries and one float per run-year are kept (plan 7.1); full paths are not stored.
 */
import type { Compiled } from '../compile';
import { runPath } from '../projection';
import { generatePath, type PathSettings } from './paths';
import { summarizeMonteCarlo, type McChunk, type McSummary } from './summary';

export * from './summary';

export function mcSettings(c: Compiled): PathSettings & { runs: number; seed: number } {
  const m = c.plan.assumptions.monteCarlo;
  return {
    method: m.method,
    blockLength: m.blockLength,
    inflation: m.inflation,
    stochasticLongevity: m.stochasticLongevity,
    bootstrapMeans: m.bootstrapMeans,
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
    estateReal: new Float64Array(count),
    netWorthEndReal: new Float64Array(count),
    lifetimeTaxReal: new Float64Array(count),
    lastYearIndex: new Int32Array(count),
    cutYears: new Int32Array(count),
    minSpendRatio: new Float64Array(count),
  };
  for (let r = 0; r < count; r++) {
    if (shouldCancel && r % 16 === 0 && shouldCancel()) {
      chunk.to = from + r;
      break;
    }
    const path = generatePath(c, settings, settings.seed, from + r);
    const res = runPath(c, path);
    const o = r * years;
    let cuts = 0;
    let minRatio = 1;
    for (let t = 0; t < res.n; t++) {
      chunk.investable[o + t] = res.investable[t] / res.cpiEnd[t];
      const ratio = res.spendRatio[t];
      if (ratio < 0.999) cuts++;
      if (ratio < minRatio) minRatio = ratio;
    }
    chunk.success[r] = res.success ? 1 : 0;
    chunk.failYear[r] = res.failedYear ?? -1;
    const last = Math.max(0, res.n - 1);
    chunk.endingReal[r] = chunk.investable[o + last];
    chunk.estateReal[r] = res.estate.netToHeirs / (res.cpiEnd[last] || 1);
    chunk.netWorthEndReal[r] = res.estate.value / (res.cpiEnd[last] || 1);
    chunk.lifetimeTaxReal[r] = res.lifetimeTax;
    chunk.lastYearIndex[r] = last;
    chunk.cutYears[r] = cuts;
    chunk.minSpendRatio[r] = minRatio;
  }
  return chunk;
}

export function runMonteCarlo(
  c: Compiled,
  overrides: Partial<PathSettings & { runs: number; seed: number }> = {},
): McSummary {
  const s = { ...mcSettings(c), ...overrides };
  const chunk = runMonteCarloChunk(c, s, 0, s.runs);
  return summarizeMonteCarlo(c, [chunk], s.seed, s.method, s);
}
