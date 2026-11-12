import type { Plan, Scenario } from '@fisim/engine';
import { produce } from 'immer';
import { create } from 'zustand';
import { newId, usePlan, useStore } from './store';
import { markPreview } from '../engine/timing';

export interface DraftTransaction {
  base: Plan;
  plan: Plan;
  label: string;
}
interface DraftState {
  transaction: DraftTransaction | null;
  invalidFields: Record<string, boolean>;
  resetId: number;
  setInvalid: (id: string, invalid: boolean) => void;
  edit: (base: Plan, label: string, recipe: (plan: Plan) => void) => void;
  restore: (transaction: DraftTransaction | null) => void;
  discard: () => void;
  apply: () => boolean;
  saveScenario: (name: string) => boolean;
}

/** Entity paths remain valid when a collection is reordered. Structural changes replace the collection. */
export function scenarioChanges(
  base: unknown,
  next: unknown,
  path: (string | number)[] = [],
): Scenario['patches'] {
  if (JSON.stringify(base) === JSON.stringify(next)) return [];
  if (Array.isArray(base) && Array.isArray(next)) {
    const entities = base.every((x) => x && typeof x === 'object' && 'id' in x);
    if (entities && base.length === next.length && base.every((x, i) => x.id === next[i]?.id))
      return base.flatMap((x, i) => scenarioChanges(x, next[i], [...path, `@${x.id}`]));
    return [{ path, value: next }];
  }
  if (base && next && typeof base === 'object' && typeof next === 'object') {
    // Replace the containing object when an optional field disappears. A patch
    // whose value is undefined cannot survive JSON export or persistence.
    const nextRecord = next as Record<string, unknown>;
    if (
      path.length &&
      Object.keys(base).some(
        (key) => !['updatedAt', 'scenarios'].includes(key) && nextRecord[key] === undefined,
      )
    )
      return [{ path, value: next }];
    return Object.keys(next)
      .filter((key) => !['updatedAt', 'scenarios'].includes(key))
      .flatMap((key) =>
        scenarioChanges((base as Record<string, unknown>)[key], (next as Record<string, unknown>)[key], [
          ...path,
          key,
        ]),
      );
  }
  return [{ path, value: next }];
}

function currentBase(): Plan | null {
  const s = useStore.getState();
  return s.sandbox?.plan ?? s.plans[s.settings.activePlanId ?? ''] ?? null;
}
export const useDraft = create<DraftState>((set, get) => ({
  transaction: null,
  invalidFields: {},
  resetId: 0,
  setInvalid: (id, invalid) =>
    set((s) => {
      const fields = { ...s.invalidFields };
      if (invalid) fields[id] = true;
      else delete fields[id];
      return { invalidFields: fields };
    }),
  edit: (base, label, recipe) => {
    if (useStore.getState().sandbox?.observeOnly || useStore.getState().scenarioId) return;
    const old = get().transaction;
    if (old && old.base.id === base.id && old.base !== base) return;
    const transaction = old?.base === base ? old : { base, plan: base, label };
    const start = performance.now();
    const plan = produce(transaction.plan, recipe);
    markPreview(plan, start);
    set({ transaction: { ...transaction, label, plan } });
  },
  restore: (transaction) => set({ transaction }),
  discard: () => set((s) => ({ transaction: null, invalidFields: {}, resetId: s.resetId + 1 })),
  apply: () => {
    const t = get().transaction;
    if (!t || currentBase() !== t.base || Object.keys(get().invalidFields).length) return false;
    useStore.getState().update((d) => {
      Object.assign(d, t.plan);
    });
    set({ transaction: null });
    return true;
  },
  saveScenario: (name) => {
    const t = get().transaction;
    if (!t || currentBase() !== t.base || Object.keys(get().invalidFields).length) return false;
    const patches = scenarioChanges(t.base, t.plan);
    if (!patches.length) return false;
    useStore.getState().update((d) => {
      d.scenarios.push({ id: newId('scenario'), name: name.trim() || t.label, patches });
    });
    set({ transaction: null });
    return true;
  },
}));

export function usePreviewPlan(): Plan | null {
  const base = usePlan();
  const scenario = useStore((s) => s.scenarioId);
  const t = useDraft((s) => s.transaction);
  return !scenario && t?.base === base ? t.plan : base;
}
