/** Worker pool (plan 11): hardwareConcurrency - 1 workers, at most 4. Worker 0 is kept for the projection; Monte Carlo is split into batches across the rest. */
import { bundledEngineData } from '@fisim/data/src/bundle';
import {
  applyScenario,
  compilePlan,
  summarizeMonteCarlo,
  type BacktestResult,
  type McChunk,
  type McSummary,
  type Plan,
  type ProjectionResult,
} from '@fisim/engine';
import * as Comlink from 'comlink';
import type { EngineApi } from './worker';

const size = Math.max(
  1,
  Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2) - 1),
);
let workers: Comlink.Remote<EngineApi>[] | null = null;

function pool(): Comlink.Remote<EngineApi>[] {
  if (!workers) {
    workers = Array.from({ length: size }, () =>
      Comlink.wrap<EngineApi>(new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })),
    );
  }
  return workers;
}

export const poolSize = size;

/** Workers used for Monte Carlo: all but the first when there is more than one, so edits recompute promptly. */
function mcWorkers(): Comlink.Remote<EngineApi>[] {
  const all = pool();
  return all.length > 1 ? all.slice(1) : all;
}

export function project(
  plan: Plan,
  scenarioId: string | null,
): Promise<{ result: ProjectionResult; ms: number }> {
  return pool()[0].project(plan, scenarioId);
}

export function backtest(plan: Plan, scenarioId: string | null): Promise<BacktestResult> {
  return pool()[size - 1].backtest(plan, scenarioId);
}

export interface McHandle {
  cancel(): void;
  done: Promise<McSummary | null>;
}

/** Progressive, cancellable Monte Carlo. `onProgress` gets a partial summary as batches arrive. */
export function monteCarlo(
  plan: Plan,
  scenarioId: string | null,
  onProgress: (done: number, total: number, partial: McSummary) => void,
): McHandle {
  const total = plan.assumptions.monteCarlo.runs;
  const key = `${plan.id}|${plan.updatedAt}|${scenarioId}|${Math.random()}`;
  const lanes = mcWorkers();
  const batch = Math.max(20, Math.ceil(total / (lanes.length * 8)));
  let cancelled = false;
  let next = 0;
  const chunks: McChunk[] = [];
  // Compile once on the main thread only to size and label the summary (cheap, no simulation).
  const c = compilePlan(applyScenario(plan, scenarioId), bundledEngineData(), {
    stochasticLongevity: plan.assumptions.monteCarlo.stochasticLongevity,
  });
  const summarize = (): McSummary =>
    summarizeMonteCarlo(
      c,
      [...chunks].sort((a, b) => a.from - b.from),
      plan.assumptions.monteCarlo.seed,
      plan.assumptions.monteCarlo.method,
    );
  const lane = async (w: Comlink.Remote<EngineApi>): Promise<void> => {
    while (!cancelled && next < total) {
      const from = next;
      const to = Math.min(total, from + batch);
      next = to;
      const { chunk } = await w.mcChunk(plan, scenarioId, key, from, to);
      if (cancelled) return;
      chunks.push(chunk);
      let done = 0;
      for (const ch of chunks) done += ch.to - ch.from;
      onProgress(done, total, summarize());
    }
  };
  const done = Promise.all(lanes.map(lane)).then(() => (cancelled ? null : summarize()));
  return {
    cancel: () => {
      cancelled = true;
    },
    done,
  };
}
