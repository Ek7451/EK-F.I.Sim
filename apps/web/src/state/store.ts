/**
 * App state (D2): Zustand store with an Immer patch log that also drives undo/redo (UX-04).
 * Plans persist to IndexedDB after every change. Guided tours run on a sandbox copy that is never saved.
 */
import { blankPlan, loadPlan, PlanZ, SAMPLE_PLANS, type Plan, type SamplePlanId } from '@fisim/engine';
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';
import {
  addSnapshot,
  allPlans,
  enqueue,
  getSetting,
  putPlan,
  removePlan,
  setSetting,
  type StoredPlan,
} from './db';

enablePatches();

export type Theme = 'system' | 'light' | 'dark';
export interface TourProgress {
  completed: boolean;
  step: number;
  dismissed: boolean;
  updatedAt: string;
}
export interface Settings {
  theme: Theme;
  activePlanId: string | null;
  tours: Record<string, TourProgress>;
  /** Feature prompts dismissed for good (one-time "Take the tour" prompts). */
  promptsDismissed: string[];
  syncUrl: string;
  syncEnabled: boolean;
  lastBackupAt: string | null;
  onboarded: boolean;
}
const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  activePlanId: null,
  tours: {},
  promptsDismissed: [],
  syncUrl: '',
  syncEnabled: false,
  lastBackupAt: null,
  onboarded: false,
};

interface History {
  undo: { patches: Patch[]; inverse: Patch[] }[];
  redo: { patches: Patch[]; inverse: Patch[] }[];
}

export interface PlanMeta {
  syncVersion: number;
  dirty: boolean;
  readOnly: boolean;
  /** Schema version found on disk when it is newer than this app. */
  newerVersion?: number;
}

interface State {
  ready: boolean;
  plans: Record<string, Plan>;
  meta: Record<string, PlanMeta>;
  history: Record<string, History>;
  settings: Settings;
  scenarioId: string | null;
  /** Tour sandbox: a sample plan (or an observe-only view of the user's plan). */
  sandbox: { plan: Plan; observeOnly: boolean } | null;
  notices: { id: number; text: string; tone?: 'ok' | 'warn' | 'danger' }[];

  init(): Promise<void>;
  createPlan(name: string, from?: Plan): Promise<string>;
  createFromSample(id: SamplePlanId): Promise<string>;
  duplicatePlan(id: string): Promise<string>;
  deletePlan(id: string): Promise<void>;
  importPlan(raw: unknown): Promise<string>;
  replacePlan(plan: Plan, meta?: Partial<PlanMeta>): Promise<void>;
  setActive(id: string): void;
  setScenario(id: string | null): void;
  update(recipe: (draft: Plan) => void): void;
  undo(): void;
  redo(): void;
  setSettings(patch: Partial<Settings>): void;
  setTour(id: string, p: Partial<TourProgress>): void;
  enterSandbox(plan: Plan, observeOnly: boolean): void;
  exitSandbox(): void;
  setMeta(id: string, patch: Partial<PlanMeta>): void;
  notify(text: string, tone?: 'ok' | 'warn' | 'danger'): void;
  dismissNotice(id: number): void;
}

const uid = (): string =>
  (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(
    /[^A-Za-z0-9_-]/g,
    '',
  );
let noticeId = 1;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function persist(plan: Plan, meta: PlanMeta): void {
  const prev = saveTimers.get(plan.id);
  if (prev) clearTimeout(prev);
  saveTimers.set(
    plan.id,
    setTimeout(() => {
      saveTimers.delete(plan.id);
      void putPlan({
        id: plan.id,
        plan,
        updatedAt: plan.updatedAt,
        syncVersion: meta.syncVersion,
        dirty: meta.dirty,
      }).then(() =>
        meta.dirty ? enqueue({ planId: plan.id, op: 'put', queuedAt: new Date().toISOString() }) : undefined,
      );
    }, 150),
  );
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  plans: {},
  meta: {},
  history: {},
  settings: DEFAULT_SETTINGS,
  scenarioId: null,
  sandbox: null,
  notices: [],

  async init() {
    if (get().ready) return;
    const settings = { ...DEFAULT_SETTINGS, ...((await getSetting<Partial<Settings>>('app')) ?? {}) };
    const stored: StoredPlan[] = await allPlans();
    const plans: Record<string, Plan> = {};
    const meta: Record<string, PlanMeta> = {};
    for (const s of stored) {
      const loaded = loadPlan(s.plan);
      if (loaded.readOnly) {
        // Newer schema than this app understands: keep the file untouched and show an "update the app" notice.
        meta[s.id] = {
          syncVersion: s.syncVersion,
          dirty: false,
          readOnly: true,
          newerVersion: loaded.fromVersion,
        };
        continue;
      }
      if (!loaded.plan) continue;
      if (loaded.migrated) {
        // Back up before any migration is used (plan 5.2).
        await addSnapshot({
          planId: s.id,
          takenAt: new Date().toISOString(),
          reason: 'pre-migration',
          plan: s.plan,
        });
        await putPlan({ ...s, plan: loaded.plan });
      }
      plans[s.id] = loaded.plan;
      meta[s.id] = { syncVersion: s.syncVersion, dirty: s.dirty, readOnly: false };
    }
    const ids = Object.keys(plans);
    const activePlanId =
      settings.activePlanId && plans[settings.activePlanId] ? settings.activePlanId : (ids[0] ?? null);
    set({ ready: true, plans, meta, settings: { ...settings, activePlanId } });
  },

  async createPlan(name, from) {
    const id = uid();
    const now = new Date().toISOString();
    const base = from ? structuredClone(from) : blankPlan(id, name, new Date().getFullYear());
    const plan: Plan = { ...base, id, name, createdAt: now, updatedAt: now };
    await get().replacePlan(plan, { dirty: true, syncVersion: 0 });
    get().setActive(id);
    return id;
  },
  async createFromSample(sample) {
    const p = SAMPLE_PLANS[sample](new Date().getFullYear());
    return get().createPlan(p.name.replace(/^Sample: /, 'My plan: '), p);
  },
  async duplicatePlan(id) {
    const src = get().plans[id];
    return get().createPlan(`${src.name} (copy)`, src);
  },
  async deletePlan(id) {
    const { plans, meta, history, settings } = get();
    const next = { ...plans };
    delete next[id];
    const nm = { ...meta };
    delete nm[id];
    const nh = { ...history };
    delete nh[id];
    await removePlan(id);
    await enqueue({ planId: id, op: 'delete', queuedAt: new Date().toISOString() });
    const activePlanId =
      settings.activePlanId === id ? (Object.keys(next)[0] ?? null) : settings.activePlanId;
    set({ plans: next, meta: nm, history: nh });
    get().setSettings({ activePlanId });
  },
  async importPlan(raw) {
    const loaded = loadPlan(raw);
    if (loaded.readOnly)
      throw new Error(
        'This backup was made by a newer version of the app. Update the app, then import it again.',
      );
    if (!loaded.plan) throw new Error(loaded.error ?? 'This file is not a plan.');
    const existing = get().plans[loaded.plan.id];
    if (existing)
      await addSnapshot({
        planId: existing.id,
        takenAt: new Date().toISOString(),
        reason: 'pre-import',
        plan: existing,
      });
    await get().replacePlan(loaded.plan, { dirty: true });
    get().setActive(loaded.plan.id);
    return loaded.plan.id;
  },
  async replacePlan(plan, metaPatch) {
    const parsed = PlanZ.parse(plan);
    const prev = get().meta[parsed.id] ?? { syncVersion: 0, dirty: false, readOnly: false };
    const m = { ...prev, ...metaPatch, readOnly: false };
    set((s) => ({
      plans: { ...s.plans, [parsed.id]: parsed },
      meta: { ...s.meta, [parsed.id]: m },
      history: { ...s.history, [parsed.id]: { undo: [], redo: [] } },
    }));
    await putPlan({
      id: parsed.id,
      plan: parsed,
      updatedAt: parsed.updatedAt,
      syncVersion: m.syncVersion,
      dirty: m.dirty,
    });
    if (m.dirty) await enqueue({ planId: parsed.id, op: 'put', queuedAt: new Date().toISOString() });
  },
  setActive(id) {
    set({ scenarioId: null });
    get().setSettings({ activePlanId: id });
  },
  setScenario(id) {
    set({ scenarioId: id });
  },

  update(recipe) {
    const s = get();
    if (s.sandbox) {
      if (s.sandbox.observeOnly) return;
      const [next] = produceWithPatches(s.sandbox.plan, recipe);
      set({ sandbox: { ...s.sandbox, plan: next } });
      return;
    }
    const id = s.settings.activePlanId;
    if (!id || !s.plans[id] || s.meta[id]?.readOnly) return;
    const [next, patches, inverse] = produceWithPatches(s.plans[id], (d) => {
      recipe(d);
      d.updatedAt = new Date().toISOString();
    });
    if (patches.length <= 1 && patches.every((p) => p.path[0] === 'updatedAt')) return;
    const h = s.history[id] ?? { undo: [], redo: [] };
    const meta = { ...s.meta[id], dirty: true };
    set({
      plans: { ...s.plans, [id]: next },
      meta: { ...s.meta, [id]: meta },
      history: { ...s.history, [id]: { undo: [...h.undo.slice(-99), { patches, inverse }], redo: [] } },
    });
    persist(next, meta);
  },
  undo() {
    const s = get();
    const id = s.settings.activePlanId;
    if (s.sandbox || !id) return;
    const h = s.history[id];
    const last = h?.undo[h.undo.length - 1];
    if (!last) return;
    const next = applyPatches(s.plans[id], last.inverse);
    const meta = { ...s.meta[id], dirty: true };
    set({
      plans: { ...s.plans, [id]: next },
      meta: { ...s.meta, [id]: meta },
      history: { ...s.history, [id]: { undo: h.undo.slice(0, -1), redo: [...h.redo, last] } },
    });
    persist(next, meta);
  },
  redo() {
    const s = get();
    const id = s.settings.activePlanId;
    if (s.sandbox || !id) return;
    const h = s.history[id];
    const last = h?.redo[h.redo.length - 1];
    if (!last) return;
    const next = applyPatches(s.plans[id], last.patches);
    const meta = { ...s.meta[id], dirty: true };
    set({
      plans: { ...s.plans, [id]: next },
      meta: { ...s.meta, [id]: meta },
      history: { ...s.history, [id]: { undo: [...h.undo, last], redo: h.redo.slice(0, -1) } },
    });
    persist(next, meta);
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    void setSetting('app', settings);
  },
  setTour(id, p) {
    const cur = get().settings.tours[id] ?? { completed: false, step: 0, dismissed: false, updatedAt: '' };
    get().setSettings({
      tours: { ...get().settings.tours, [id]: { ...cur, ...p, updatedAt: new Date().toISOString() } },
    });
  },
  enterSandbox(plan, observeOnly) {
    set({ sandbox: { plan: structuredClone(plan), observeOnly }, scenarioId: null });
  },
  exitSandbox() {
    set({ sandbox: null, scenarioId: null });
  },
  setMeta(id, patch) {
    set((s) => ({
      meta: {
        ...s.meta,
        [id]: { ...(s.meta[id] ?? { syncVersion: 0, dirty: false, readOnly: false }), ...patch },
      },
    }));
  },
  notify(text, tone) {
    const id = noticeId++;
    set((s) => ({ notices: [...s.notices.slice(-2), { id, text, tone }] }));
    setTimeout(() => get().dismissNotice(id), 6000);
  },
  dismissNotice(id) {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  },
}));

/** The plan on screen: the tour sandbox if one is active, otherwise the active plan. */
export function usePlan(): Plan | null {
  return useStore(
    (s) => s.sandbox?.plan ?? (s.settings.activePlanId ? (s.plans[s.settings.activePlanId] ?? null) : null),
  );
}
export const useUpdate = (): State['update'] => useStore((s) => s.update);
export const newId = (prefix: string): string => `${prefix}-${uid().slice(0, 8)}`;
