/** Worker pool (plan 11): hardwareConcurrency - 1 workers, at most 4. Worker 0 is kept for the projection; Monte Carlo is split into batches across the rest. */
import type { BacktestResult, McChunk, McSummary, Plan, ProjectionResult } from '@fisim/engine';
import * as Comlink from 'comlink';
import { loadDataBundle, loadEngine } from './load';
import type { EngineApi } from './worker';

const size = Math.max(
  1,
  Math.min(4, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2) - 1),
);
let workers: Comlink.Remote<EngineApi>[] | null = null;
const failures = new WeakMap<Comlink.Remote<EngineApi>, Promise<never>>();
const dead = new WeakSet<Comlink.Remote<EngineApi>>();

function engineWorker(): Comlink.Remote<EngineApi> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const api = Comlink.wrap<EngineApi>(worker);
  const failure = new Promise<never>((_, reject) => {
    const fail = (): void => {
      dead.add(api);
      worker.terminate();
      reject(new Error('The calculation worker stopped. Retry to start a new worker.'));
    };
    worker.addEventListener('error', fail, { once: true });
    worker.addEventListener('messageerror', fail, { once: true });
  });
  // A worker can fail while idle. The next request recreates it; avoid an unhandled rejection.
  void failure.catch(() => undefined);
  failures.set(api, failure);
  return api;
}
function withFailure<T>(worker: Comlink.Remote<EngineApi>, work: Promise<T>): Promise<T> {
  return Promise.race([work, failures.get(worker)!]);
}

function pool(): Comlink.Remote<EngineApi>[] {
  if (!workers) {
    workers = Array.from({ length: size }, engineWorker);
  }
  workers = workers.map((worker) => (dead.has(worker) ? engineWorker() : worker));
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
  const worker = pool()[0];
  return withFailure(worker, worker.project(plan, scenarioId));
}

export function backtest(
  plan: Plan,
  scenarioId: string | null,
  signal?: AbortSignal,
): Promise<BacktestResult> {
  // Historical replay must never occupy the deterministic lane, including on single-core devices.
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const api = Comlink.wrap<EngineApi>(worker);
  return new Promise((resolve, reject) => {
    const stop = (): void => {
      worker.terminate();
      reject(new DOMException('Historical replay cancelled', 'AbortError'));
    };
    worker.addEventListener(
      'error',
      () => {
        worker.terminate();
        reject(new Error('Historical replay worker stopped. Retry to start again.'));
      },
      { once: true },
    );
    if (signal?.aborted) {
      stop();
      return;
    }
    signal?.addEventListener('abort', stop, { once: true });
    void api
      .backtest(plan, scenarioId)
      .then(resolve, reject)
      .finally(() => {
        signal?.removeEventListener('abort', stop);
        worker.terminate();
      });
  });
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
  // Small chunks bound the time an edit waits when simulation and projection share one worker.
  const batch = size === 1 ? 4 : Math.min(40, Math.max(10, Math.ceil(total / (lanes.length * 20))));
  let cancelled = false;
  let next = 0;
  const chunks: McChunk[] = [];
  // Compile once on the main thread only to size and label the summary (cheap, no simulation). The engine and
  // data load on demand, in parallel with the first batches.
  const ready = Promise.all([loadEngine(), loadDataBundle()]).then(([e, d]) => ({
    e,
    c: e.compilePlan(e.applyScenario(plan, scenarioId), d.bundledEngineData(), {
      stochasticLongevity: plan.assumptions.monteCarlo.stochasticLongevity,
    }),
  }));
  const summarize = async (): Promise<McSummary> => {
    const { e, c } = await ready;
    return e.summarizeMonteCarlo(
      c,
      [...chunks].sort((a, b) => a.from - b.from),
      plan.assumptions.monteCarlo.seed,
      plan.assumptions.monteCarlo.method,
    );
  };
  const lane = async (w: Comlink.Remote<EngineApi>): Promise<void> => {
    while (!cancelled && next < total) {
      const from = next;
      const to = Math.min(total, from + batch);
      next = to;
      const { chunk } = await withFailure(w, w.mcChunk(plan, scenarioId, key, from, to));
      if (cancelled) return;
      chunks.push(chunk);
      const partial = await summarize();
      if (cancelled) return;
      onProgress(partial.runs, total, partial);
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
