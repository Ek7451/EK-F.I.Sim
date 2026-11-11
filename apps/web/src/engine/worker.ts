/// <reference lib="webworker" />
/** Engine worker (UX-03): runs projections, Monte Carlo chunks and backtests off the main thread. */
import { bundledEngineData, loadSlcsp } from '@fisim/data/src/bundle';
import {
  applyScenario,
  compilePlan,
  mcSettings,
  projectCompiled,
  runBacktest,
  runMonteCarloChunk,
  type BacktestResult,
  type Compiled,
  type EngineData,
  type McChunk,
  type Plan,
  type ProjectionResult,
} from '@fisim/engine';
import * as Comlink from 'comlink';

const data: EngineData = bundledEngineData();
let lastKey = '';
let lastCompiled: Compiled | null = null;

async function ensureSlcsp(plan: Plan): Promise<void> {
  const year = plan.settings.startYear;
  const states = new Set<string>();
  for (const p of plan.people) for (const r of p.residence) states.add(r.state);
  for (const m of plan.milestones) for (const e of m.effects) if (e.type === 'relocate') states.add(e.state);
  for (const st of states) {
    const got = await loadSlcsp(st, year);
    if (got) (data.slcsp[got.year] ??= {})[st] = got.file;
  }
  // The engine picks one plan year for all states: make sure every needed state exists under it.
  const ys = Object.keys(data.slcsp)
    .map(Number)
    .sort((a, b) => a - b);
  if (ys.length > 1) {
    let pick = ys[0];
    for (const y of ys) if (y <= year) pick = y;
    for (const y of ys)
      if (y !== pick) for (const st in data.slcsp[y]) data.slcsp[pick][st] ??= data.slcsp[y][st];
  }
}

async function compiled(
  plan: Plan,
  scenarioId: string | null,
  key: string,
  stochasticLongevity = false,
): Promise<Compiled> {
  const k = `${key}|${stochasticLongevity}`;
  if (lastCompiled && lastKey === k) return lastCompiled;
  await ensureSlcsp(plan);
  lastCompiled = compilePlan(applyScenario(plan, scenarioId), data, { stochasticLongevity });
  lastKey = k;
  return lastCompiled;
}

const api = {
  async project(plan: Plan, scenarioId: string | null): Promise<{ result: ProjectionResult; ms: number }> {
    await ensureSlcsp(plan);
    const t0 = performance.now();
    const c = compilePlan(applyScenario(plan, scenarioId), data);
    const result = projectCompiled(c, scenarioId);
    return { result, ms: performance.now() - t0 };
  },
  /** One batch of Monte Carlo runs [from, to). `key` identifies the plan revision so compilation is reused across batches. */
  async mcChunk(
    plan: Plan,
    scenarioId: string | null,
    key: string,
    from: number,
    to: number,
  ): Promise<{ chunk: McChunk; maxYears: number }> {
    const sl = plan.assumptions.monteCarlo.stochasticLongevity;
    const c = await compiled(plan, scenarioId, key, sl);
    const chunk = runMonteCarloChunk(c, mcSettings(c), from, to);
    return Comlink.transfer({ chunk, maxYears: c.maxYears }, [
      chunk.investable.buffer,
      chunk.endingReal.buffer,
      chunk.lifetimeTaxReal.buffer,
      chunk.success.buffer,
      chunk.failYear.buffer,
      chunk.lastYearIndex.buffer,
    ]);
  },
  async backtest(plan: Plan, scenarioId: string | null): Promise<BacktestResult> {
    await ensureSlcsp(plan);
    return runBacktest(compilePlan(applyScenario(plan, scenarioId), data));
  },
};

export type EngineApi = typeof api;
Comlink.expose(api);
