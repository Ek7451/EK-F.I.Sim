/**
 * Engine benchmark (plan 13). Writes bench/latest.json and compares with bench/baseline.json;
 * a regression above 20% exits non-zero. Run with `pnpm bench`; refresh the baseline with `pnpm bench -- --update`.
 * Timings are single-threaded on the machine that runs them; the app splits Monte Carlo across up to 4 workers.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngineData } from '@fisim/data/src/node';
import { compilePlan, projectCompiled, runMonteCarlo, sampleBasic, sampleEarlyRetiree } from '../src';

const here = dirname(fileURLToPath(import.meta.url));
const data = loadEngineData();

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function time(fn: () => void, reps: number): number {
  fn();
  const out: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    fn();
    out.push(performance.now() - t0);
  }
  return median(out);
}

// 62-year horizon, full tax and healthcare (sample-basic: age 34 to 95).
const basic = sampleBasic(2026);
const early = sampleEarlyRetiree(2026);
const results: Record<string, number> = {
  deterministic_60y_ms: time(() => projectCompiled(compilePlan(basic, data)), 40),
  deterministic_couple_ms: time(() => projectCompiled(compilePlan(early, data)), 40),
  montecarlo_1000_single_thread_ms: time(() => runMonteCarlo(compilePlan(basic, data), { runs: 1000 }), 3),
  montecarlo_1000_couple_single_thread_ms: time(
    () => runMonteCarlo(compilePlan(early, data), { runs: 1000 }),
    3,
  ),
};
results.montecarlo_10000_estimate_4_workers_ms = (results.montecarlo_1000_single_thread_ms * 10) / 4;

const budgets: Record<string, number> = {
  deterministic_60y_ms: 50,
  deterministic_couple_ms: 50,
  montecarlo_1000_single_thread_ms: 2000 * 4,
  montecarlo_10000_estimate_4_workers_ms: 15000,
};
const latest = { node: process.version, date: new Date().toISOString().slice(0, 10), results };
writeFileSync(join(here, 'latest.json'), JSON.stringify(latest, null, 1) + '\n');
console.table(
  Object.fromEntries(
    Object.entries(results).map(([k, v]) => [k, { ms: +v.toFixed(2), budget: budgets[k] ?? '' }]),
  ),
);

const basePath = join(here, 'baseline.json');
let failed = false;
if (process.argv.includes('--update') || !existsSync(basePath)) {
  writeFileSync(basePath, JSON.stringify(latest, null, 1) + '\n');
  console.log('baseline written');
} else {
  const base = JSON.parse(readFileSync(basePath, 'utf8')) as typeof latest;
  for (const k in results) {
    const b = base.results[k];
    if (b && results[k] > b * 1.2 && results[k] - b > 0.5) {
      console.error(`REGRESSION ${k}: ${results[k].toFixed(2)} ms vs baseline ${b.toFixed(2)} ms`);
      failed = true;
    }
  }
}
for (const k in budgets) {
  if (results[k] > budgets[k]) {
    console.error(`OVER BUDGET ${k}: ${results[k].toFixed(2)} ms > ${budgets[k]} ms`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
