/** Hooks that keep results in step with the plan: instant deterministic recompute, background Monte Carlo. */
import type { BacktestResult, McSummary, Plan, ProjectionResult } from '@fisim/engine';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { logError } from '../state/db';
import { useStore } from '../state/store';
import { usePreviewPlan } from '../state/draft';
import { backtest, monteCarlo, project, type McHandle } from './pool';
import { measurePreviewPaint } from './timing';
import { resultKey, resultIdentity, type ResultIdentity } from './identity';

interface ResultState {
  projection: ProjectionResult | null;
  /** The plan object and scenario the current projection was computed from. */
  projectionPlan: Plan | null;
  projectionScenario: string | null;
  ms: number;
  error: string | null;
  errorPlan: Plan | null;
  errorScenario: string | null;
  completedAt: number | null;
  identity: ResultIdentity | null;
  mc: McSummary | null;
  mcKey: string;
  mcProgress: number;
  mcRunning: boolean;
  mcError: string | null;
}
const useResults = create<ResultState>(() => ({
  projection: null,
  projectionPlan: null,
  projectionScenario: null,
  ms: 0,
  error: null,
  errorPlan: null,
  errorScenario: null,
  completedAt: null,
  identity: null,
  mc: null,
  mcKey: '',
  mcProgress: 0,
  mcRunning: false,
  mcError: null,
}));

const keyOf = resultKey;

// One projection request per (plan object, scenario), however many components are listening.
let seq = 0;
let requested: { plan: Plan; scenarioId: string | null } | null = null;
function requestProjection(plan: Plan, scenarioId: string | null): void {
  if (requested && requested.plan === plan && requested.scenarioId === scenarioId) return;
  requested = { plan, scenarioId };
  const mine = ++seq;
  const identity = resultIdentity(plan, scenarioId);
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
          completedAt: Date.now(),
          identity: { ...identity, completedAt: Date.now() },
        });
    })
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      void logError(`projection: ${msg}`);
      if (mine === seq) {
        useResults.setState({ error: msg, errorPlan: plan, errorScenario: scenarioId });
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
  retry: () => void;
  identity: ResultIdentity | null;
} {
  const plan = usePreviewPlan();
  const scenarioId = useStore((s) => s.scenarioId);
  // Narrow subscriptions: Monte Carlo progress must not re-render projection screens.
  const projection = useResults((s) => s.projection);
  const projectionPlan = useResults((s) => s.projectionPlan);
  const projectionScenario = useResults((s) => s.projectionScenario);
  const ms = useResults((s) => s.ms);
  const identity = useResults((s) => s.identity);
  const error = useResults((s) => (s.errorPlan === plan && s.errorScenario === scenarioId ? s.error : null));
  useEffect(() => {
    if (plan) requestProjection(plan, scenarioId);
  }, [plan, scenarioId]);
  const matches =
    !!plan && !!projection && projection.planId === plan.id && projectionScenario === scenarioId;
  useEffect(() => {
    if (matches && projectionPlan === plan && plan) measurePreviewPaint(plan);
  }, [matches, projectionPlan, plan]);
  return {
    result: matches ? projection : null,
    ms,
    error,
    stale: !matches || projectionPlan !== plan,
    identity: matches ? identity : null,
    retry: () => {
      if (plan) {
        requested = null;
        requestProjection(plan, scenarioId);
      }
    },
  };
}

let handle: McHandle | null = null;
let mcPendingTimer: ReturnType<typeof setTimeout> | null = null;
let mcGeneration = 0;
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
  error: string | null;
  partial: boolean;
} {
  const plan = usePreviewPlan();
  const scenarioId = useStore((s) => s.scenarioId);
  const mc = useResults((s) => (enabled ? s.mc : null));
  const progress = useResults((s) => (enabled ? s.mcProgress : 0));
  const running = useResults((s) => enabled && s.mcRunning);
  const [nonce, setNonce] = useState(0);
  const ownedKey = useResults((s) => s.mcKey);
  const error = useResults((s) => s.mcError);
  const key = plan ? keyOf(plan, scenarioId) + `|${nonce}` : '';
  const matches = ownedKey === key;
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
        if (mcPendingTimer) clearTimeout(mcPendingTimer);
        mcPendingTimer = null;
        mcGeneration++;
        // Forget the key so the run starts again (rather than showing a partial result) next time.
        useResults.setState({ mcRunning: false, mcKey: '' });
      }, 500);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !plan) return;
    if (useResults.getState().mcKey === key && (handle || mcPendingTimer || !useResults.getState().mcRunning))
      return;
    if (mcPendingTimer) clearTimeout(mcPendingTimer);
    handle?.cancel();
    handle = null;
    const generation = ++mcGeneration;
    useResults.setState({ mcKey: key, mc: null, mcRunning: true, mcProgress: 0, mcError: null });
    mcPendingTimer = setTimeout(() => {
      mcPendingTimer = null;
      if (generation !== mcGeneration) return;
      handle?.cancel();
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
          if (handle === h)
            useResults.setState({ mcRunning: false, mcError: e instanceof Error ? e.message : String(e) });
        });
    }, 250);
    // The pending run belongs to the shared request, not whichever subscriber scheduled it.
    // Consumer cleanup above cancels only when no mounted view still needs the result.
  }, [enabled, plan, scenarioId, key]);
  return {
    summary: matches ? mc : null,
    progress: matches ? progress : 0,
    running: enabled && (!matches || running),
    error: matches ? error : null,
    partial: matches && !!mc && progress < 1,
    cancel: () => {
      handle?.cancel();
      handle = null;
      if (mcPendingTimer) clearTimeout(mcPendingTimer);
      mcPendingTimer = null;
      mcGeneration++;
      useResults.setState({ mcRunning: false });
    },
    rerun: () => setNonce((n) => n + 1),
  };
}

export function useBacktest(enabled: boolean): {
  result: BacktestResult | null;
  running: boolean;
  error: string | null;
  retry: () => void;
  cancel: () => void;
} {
  const plan = usePreviewPlan();
  const scenarioId = useStore((s) => s.scenarioId);
  const [state, setState] = useState<{
    result: BacktestResult | null;
    running: boolean;
    key: string;
    error: string | null;
  }>({
    result: null,
    running: false,
    key: '',
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const key = plan ? keyOf(plan, scenarioId) : '';
  useEffect(() => {
    if (!enabled || !plan || cancelled) return;
    let live = true;
    const controller = new AbortController();
    setState({ result: null, running: true, key, error: null });
    const t = setTimeout(() => {
      backtest(plan, scenarioId, controller.signal)
        .then((result) => {
          if (live) setState({ result, running: false, key, error: null });
        })
        .catch((e: unknown) => {
          void logError(`backtest: ${e instanceof Error ? e.message : String(e)}`);
          if (live)
            setState((s) => ({ ...s, running: false, error: e instanceof Error ? e.message : String(e) }));
        });
    }, 200);
    return () => {
      live = false;
      controller.abort();
      clearTimeout(t);
    };
  }, [enabled, plan, scenarioId, key, nonce, cancelled]);
  return {
    ...(state.key === key ? state : { result: null, running: enabled, error: null }),
    running: !cancelled && (state.key === key ? state.running : enabled),
    retry: () => {
      setCancelled(false);
      setNonce((n) => n + 1);
    },
    cancel: () => setCancelled(true),
  };
}

/** One-off projection of any plan/scenario (compare mode, reports). */
export function useProjectionOf(plan: Plan | null, scenarioId: string | null): ProjectionResult | null {
  return useProjectionRequest(plan, scenarioId).result;
}

export function useProjectionRequest(
  plan: Plan | null,
  scenarioId: string | null,
): { result: ProjectionResult | null; error: string | null; retry: () => void } {
  const [res, setRes] = useState<{ result: ProjectionResult; plan: Plan; scenarioId: string | null } | null>(
    null,
  );
  const [failure, setFailure] = useState<{ plan: Plan; scenarioId: string | null; message: string } | null>(
    null,
  );
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!plan) {
      setRes(null);
      return;
    }
    let live = true;
    setFailure(null);
    project(plan, scenarioId)
      .then(({ result }) => {
        if (live) setRes({ result, plan, scenarioId });
      })
      .catch((e: unknown) => {
        if (live) setFailure({ plan, scenarioId, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      live = false;
    };
  }, [plan, scenarioId, nonce]);
  return {
    result: res?.plan === plan && res?.scenarioId === scenarioId ? res.result : null,
    error: failure?.plan === plan && failure?.scenarioId === scenarioId ? failure.message : null,
    retry: () => setNonce((n) => n + 1),
  };
}
