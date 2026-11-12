/** Hooks that keep results in step with the plan: instant deterministic recompute, background Monte Carlo. */
import type { BacktestResult, McSummary, Plan, ProjectionResult } from '@fisim/engine';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { logError } from '../state/db';
import { usePlan, useStore } from '../state/store';
import { backtest, monteCarlo, project, type McHandle } from './pool';

interface ResultState {
  projection: ProjectionResult | null;
  /** The plan object and scenario the current projection was computed from. */
  projectionPlan: Plan | null;
  projectionScenario: string | null;
  ms: number;
  error: string | null;
  mc: McSummary | null;
  mcKey: string;
  mcProgress: number;
  mcRunning: boolean;
}
const useResults = create<ResultState>(() => ({
  projection: null,
  projectionPlan: null,
  projectionScenario: null,
  ms: 0,
  error: null,
  mc: null,
  mcKey: '',
  mcProgress: 0,
  mcRunning: false,
}));

const keyOf = (plan: Plan, scenarioId: string | null): string =>
  `${plan.id}|${plan.updatedAt}|${scenarioId ?? ''}|${JSON.stringify(plan).length}`;

// One projection request per (plan object, scenario), however many components are listening.
let seq = 0;
let requested: { plan: Plan; scenarioId: string | null } | null = null;
function requestProjection(plan: Plan, scenarioId: string | null): void {
  if (requested && requested.plan === plan && requested.scenarioId === scenarioId) return;
  requested = { plan, scenarioId };
  const mine = ++seq;
  useResults.setState({ error: null });
  project(plan, scenarioId)
    .then(({ result, ms }) => {
      if (mine === seq)
        useResults.setState({
          projection: result,
          projectionPlan: plan,
          projectionScenario: scenarioId,
          ms,
          error: null,
        });
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      void logError(`projection: ${msg}`);
      if (mine === seq) {
        useResults.setState({ error: msg });
        // Allow the same plan to be retried after a failure.
        requested = null;
      }
    });
}

/** Deterministic projection for the plan on screen; recomputes whenever the plan or scenario changes. */
export function useProjection(): {
  result: ProjectionResult | null;
  ms: number;
  error: string | null;
  /** True while the result shown is from an earlier version of the plan (a recompute is in flight). */
  stale: boolean;
} {
  const plan = usePlan();
  const scenarioId = useStore((s) => s.scenarioId);
  // Narrow subscriptions: Monte Carlo progress must not re-render projection screens.
  const projection = useResults((s) => s.projection);
  const projectionPlan = useResults((s) => s.projectionPlan);
  const projectionScenario = useResults((s) => s.projectionScenario);
  const ms = useResults((s) => s.ms);
  const error = useResults((s) => s.error);
  useEffect(() => {
    if (plan) requestProjection(plan, scenarioId);
  }, [plan, scenarioId]);
  const matches =
    !!plan && !!projection && projection.planId === plan.id && projectionScenario === scenarioId;
  return {
    result: matches ? projection : null,
    ms,
    error,
    stale: !matches || projectionPlan !== plan,
  };
}

let handle: McHandle | null = null;
/** How many mounted components currently want Monte Carlo results. */
let mcConsumers = 0;
let mcIdleTimer: ReturnType<typeof setTimeout> | null = null;

/** Monte Carlo for the plan on screen. Runs when `enabled`, reruns on change, streams progress, can be cancelled. */
export function useMonteCarlo(enabled: boolean): {
  summary: McSummary | null;
  progress: number;
  running: boolean;
  cancel: () => void;
  rerun: () => void;
} {
  const plan = usePlan();
  const scenarioId = useStore((s) => s.scenarioId);
  const mc = useResults((s) => (enabled ? s.mc : null));
  const progress = useResults((s) => (enabled ? s.mcProgress : 0));
  const running = useResults((s) => enabled && s.mcRunning);
  const [nonce, setNonce] = useState(0);
  // Stop a run nobody is looking at, so it does not hold the workers.
  useEffect(() => {
    if (!enabled) return;
    mcConsumers++;
    if (mcIdleTimer) clearTimeout(mcIdleTimer);
    return () => {
      mcConsumers--;
      if (mcConsumers > 0) return;
      mcIdleTimer = setTimeout(() => {
        if (mcConsumers > 0 || !useResults.getState().mcRunning) return;
        handle?.cancel();
        handle = null;
        // Forget the key so the run starts again (rather than showing a partial result) next time.
        useResults.setState({ mcRunning: false, mcKey: '' });
      }, 500);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !plan) return;
    const key = keyOf(plan, scenarioId) + `|${nonce}`;
    if (useResults.getState().mcKey === key) return;
    const t = setTimeout(() => {
      handle?.cancel();
      useResults.setState({ mcKey: key, mcRunning: true, mcProgress: 0 });
      const h = monteCarlo(plan, scenarioId, (done, total, partial) => {
        if (handle === h) useResults.setState({ mc: partial, mcProgress: done / total });
      });
      handle = h;
      h.done
        .then((final) => {
          if (handle === h)
            useResults.setState({
              mc: final ?? useResults.getState().mc,
              mcRunning: false,
              mcProgress: final ? 1 : useResults.getState().mcProgress,
            });
        })
        .catch((e: unknown) => {
          void logError(`monte carlo: ${e instanceof Error ? e.message : String(e)}`);
          if (handle === h) useResults.setState({ mcRunning: false });
        });
    }, 250);
    return () => clearTimeout(t);
  }, [enabled, plan, scenarioId, nonce]);
  return {
    summary: mc,
    progress,
    running,
    cancel: () => {
      handle?.cancel();
      useResults.setState({ mcRunning: false });
    },
    rerun: () => setNonce((n) => n + 1),
  };
}

export function useBacktest(enabled: boolean): { result: BacktestResult | null; running: boolean } {
  const plan = usePlan();
  const scenarioId = useStore((s) => s.scenarioId);
  const [state, setState] = useState<{ result: BacktestResult | null; running: boolean }>({
    result: null,
    running: false,
  });
  useEffect(() => {
    if (!enabled || !plan) return;
    let live = true;
    setState((s) => ({ ...s, running: true }));
    const t = setTimeout(() => {
      backtest(plan, scenarioId)
        .then((result) => {
          if (live) setState({ result, running: false });
        })
        .catch((e: unknown) => {
          void logError(`backtest: ${e instanceof Error ? e.message : String(e)}`);
          if (live) setState((s) => ({ ...s, running: false }));
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [enabled, plan, scenarioId]);
  return state;
}

/** One-off projection of any plan/scenario (compare mode, reports). */
export function useProjectionOf(plan: Plan | null, scenarioId: string | null): ProjectionResult | null {
  const [res, setRes] = useState<ProjectionResult | null>(null);
  useEffect(() => {
    if (!plan) {
      setRes(null);
      return;
    }
    let live = true;
    project(plan, scenarioId)
      .then(({ result }) => {
        if (live) setRes(result);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [plan, scenarioId]);
  return res;
}
