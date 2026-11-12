import type { Plan } from '@fisim/engine';
import { DATA_RELEASE } from '@fisim/data/src/engine-data';

export interface ResultIdentity {
  planId: string;
  scenarioId: string | null;
  revision: string;
  engineVersion: string;
  dataRelease: string;
  requestedAt: number;
  completedAt: number | null;
}
/** In-memory content identity includes simulation parameters; no timestamp or string-length collisions. */
export function resultKey(plan: Plan, scenarioId: string | null): string {
  return JSON.stringify([
    typeof __APP_VERSION__ === 'undefined' ? 'test' : __APP_VERSION__,
    DATA_RELEASE,
    plan,
    scenarioId,
  ]);
}
export function resultIdentity(plan: Plan, scenarioId: string | null): ResultIdentity {
  return {
    planId: plan.id,
    scenarioId,
    revision: resultKey(plan, scenarioId),
    engineVersion: typeof __APP_VERSION__ === 'undefined' ? 'test' : __APP_VERSION__,
    dataRelease: DATA_RELEASE,
    requestedAt: Date.now(),
    completedAt: null,
  };
}
