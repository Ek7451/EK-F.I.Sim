/** Hooks that keep results in step with the plan: instant deterministic recompute, background Monte Carlo. */
import type { BacktestResult, McSummary, Plan, ProjectionResult } from '@fisim/engine';
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { logError } from '../state/db';
import { usePlan, useStore } from '../state/store';
import { backtest, monteCarlo, project, type McHandle } from './pool';

interface ResultState {
  projection: ProjectionResult | null;
  projectionKey: string;
  ms: number;
  error: string | null;
  mc: McSummary | null;
  mcKey: string;
  mcProgress: number;
  mcRunning: boolean;
}
const useResults = create<ResultState>(() => ({
  projection: null,
  projectionKey: '',
  ms: 0,
  error: null,
  mc: null,
  mcKey: '',
  mcProgress: 0,
  mcRunning: false,
}));

const keyOf = (plan: Plan, scenarioId: string | null): string =>
  `${plan.id}|${plan.updatedAt}|${scenarioId ?? ''}|${JSON.stringify(plan).length}`;

let seq = 0;
/** Deterministic projection for the plan on screen; recomputes whenever the plan changes. */
export function useProjection(): {
  result: ProjectionResult | null;
  ms: number;
  error: string | null;
  stale: boolean;
} {
  const plan = usePlan();
  const scenarioId = useStore((s) => s.scenarioId);
  const r = useResults();
  const planRef = useRef<Plan | null>(null);
  useEffect(() => {
    if (!plan || planRef.current === plan) return;
    planRef.current = plan;
    const key = keyOf(plan, scenarioId) + Math.random();
    const mine = ++seq;
    project(plan, scenarioId)
      .then(({ result, ms }) => {
        if (mine === seq) useResults.setState({ projection: result, projectionKey: key, ms, error: null });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        void logError(`projection: ${msg}`);
        if (mine === seq) useResults.setState({ error: msg });
      });
  }, [plan, scenarioId]);
  // A scenario switch must also trigger a recompute.
  useEffect(() => {
    planRef.current = null;
  }, [scenarioId]);
  const matches = !!plan && !!r.projection && r.projection.planId === plan.id;
  return { result: matches ? r.projection : null, ms: r.ms, error: r.error, stale: !matches };
}

let handle: McHandle | null = null;
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
  const r = useResults();
  const [nonce, setNonce] = useState(0);
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
    summary: r.mc,
    progress: r.mcProgress,
    running: r.mcRunning,
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
