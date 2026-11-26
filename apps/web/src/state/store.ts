/**
 * App state (D2): Zustand store with an Immer patch log that also drives undo/redo (UX-04).
 * Plans persist to IndexedDB after every change. Guided tours run on a sandbox copy that is never saved.
 */
import type { Plan, SamplePlanId } from '@fisim/engine';
import { loadEngine, validationMessage } from '../engine/load';
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { create } from 'zustand';
import {
  addSnapshot,
  allPlans,
  migrateProgressBaselines,
  clearPlanData,
  openWorkspace,
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
  /** Desktop navigation rail shows icons only. */
  railCollapsed: boolean;
}
const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  railCollapsed: false,
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
  validationError?: string;
  recoveryRevision?: string;
}

interface State {
  ready: boolean;
  plans: Record<string, Plan>;
  meta: Record<string, PlanMeta>;
  history: Record<string, History>;
  settings: Settings;
  scenarioId: string | null;
  saveStatus: Record<string, 'saving' | 'saved' | 'error'>;
  retrySave(): void;
  /** Tour sandbox: a sample plan (or an observe-only view of the user's plan). */
  sandbox: { plan: Plan; observeOnly: boolean } | null;
  notices: { id: number; text: string; tone?: 'ok' | 'warn' | 'danger' }[];

  init(): Promise<void>;
  createPlan(name: string, from?: Plan): Promise<string>;
  createFromSample(id: SamplePlanId): Promise<string>;
  duplicatePlan(id: string): Promise<string>;
  deletePlan(id: string, remoteOriginal?: Plan): Promise<void>;
  /** Remove every plan from this browser without telling the cloud (signing out). */
  clearPlans(): Promise<void>;
  importPlan(raw: unknown): Promise<string>;
  replacePlan(plan: Plan, meta?: Partial<PlanMeta>): Promise<void>;
  setActive(id: string): void;
  setScenario(id: string | null): void;
  update(recipe: (draft: Plan) => void, planId?: string): void;
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
const writes = new Set<Promise<void>>();
const pendingSaves = new Map<string, { base: string; tail: Promise<void> }>();
function persist(plan: Plan, meta: PlanMeta, previousRevision: string): void {
  const state = pendingSaves.get(plan.id) ?? { base: previousRevision, tail: Promise.resolve() };
  pendingSaves.set(plan.id, state);
  useStore.setState((s) => ({ saveStatus: { ...s.saveStatus, [plan.id]: 'saving' } }));
  const write = state.tail
    .then(async () => {
      await putPlan(
        { id: plan.id, plan, updatedAt: plan.updatedAt, syncVersion: meta.syncVersion, dirty: meta.dirty },
        state.base,
      );
      state.base = plan.updatedAt;
    })
    .then(
      () => mark('saved'),
      () => mark('error'),
    );
  state.tail = write;
  writes.add(write);
  void write.finally(() => {
    writes.delete(write);
    if (state.tail === write && state.base === plan.updatedAt) pendingSaves.delete(plan.id);
  });
  function mark(status: 'saved' | 'error'): void {
    if (useStore.getState().plans[plan.id] === plan)
      useStore.setState((s) => ({ saveStatus: { ...s.saveStatus, [plan.id]: status } }));
  }
}
function nextRevision(previous: string): string {
  return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
}
export async function flushLocalWrites(): Promise<boolean> {
  while (writes.size) await Promise.all(writes);
  return Object.entries(useStore.getState().saveStatus).every(
    ([id, status]) => !useStore.getState().plans[id] || status === 'saved',
  );
}

export const useStore = create<State>((set, get) => ({
  ready: false,
  plans: {},
  meta: {},
  history: {},
  settings: DEFAULT_SETTINGS,
  scenarioId: null,
  saveStatus: {},
  retrySave() {
    const s = get();
    const id = s.settings.activePlanId;
    if (id && s.plans[id]) persist(s.plans[id], s.meta[id], s.plans[id].updatedAt);
  },
  sandbox: null,
  notices: [],

  async init() {
    if (get().ready) return;
    const settings = { ...DEFAULT_SETTINGS, ...((await getSetting<Partial<Settings>>('app')) ?? {}) };
    await openWorkspace();
    await migrateProgressBaselines();
    const stored: StoredPlan[] = await allPlans();
    // Checking saved plans needs the engine; a first visit has none, so the start screen does not wait for it.
    const loadPlan = stored.length ? (await loadEngine()).loadPlan : null;
    const plans: Record<string, Plan> = {};
    const meta: Record<string, PlanMeta> = {};
    for (const s of stored) {
      const loaded = loadPlan!(s.plan);
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
      if (!loaded.plan || loaded.plan.id !== s.id) {
        meta[s.id] = {
          syncVersion: s.syncVersion,
          dirty: s.dirty,
          readOnly: true,
          validationError: loaded.error ?? 'Stored plan identity mismatch.',
          recoveryRevision: s.updatedAt,
        };
        continue;
      }
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
    const base = from
      ? structuredClone(from)
      : (await loadEngine()).blankPlan(id, name, new Date().getFullYear());
    const plan: Plan = { ...base, id, name, createdAt: now, updatedAt: now };
    await get().replacePlan(plan, { dirty: true, syncVersion: 0 });
    get().setActive(id);
    return id;
  },
  async createFromSample(sample) {
    const p = (await loadEngine()).SAMPLE_PLANS[sample](new Date().getFullYear());
    return get().createPlan(p.name.replace(/^Sample: /, 'My plan: '), p);
  },
  async duplicatePlan(id) {
    const src = get().plans[id];
    return get().createPlan(`${src.name} (copy)`, src);
  },
  async deletePlan(id, remoteOriginal) {
    const original = get().plans[id];
    if (remoteOriginal && remoteOriginal !== original)
      throw new Error('The local plan changed before applying the cloud deletion.');
    if (!original) return;
    const version = get().meta[id]?.syncVersion ?? 0;
    await flushLocalWrites();
    await addSnapshot({
      planId: id,
      plan: original,
      takenAt: new Date().toISOString(),
      reason: remoteOriginal ? 'conflict' : 'manual',
    });
    if (get().plans[id] !== original)
      throw new Error('The plan changed before deletion. Review the latest changes.');
    await removePlan(
      id,
      remoteOriginal
        ? null
        : {
            planId: id,
            op: 'delete',
            queuedAt: new Date().toISOString(),
            syncVersion: version,
            planName: original.name,
          },
      original.updatedAt,
    );
    if (get().plans[id] !== original)
      throw new Error('The plan changed during deletion. Reopen the workspace to review the latest changes.');
    const { plans, meta, history, settings } = get();
    const next = { ...plans },
      nm = { ...meta },
      nh = { ...history };
    delete next[id];
    delete nm[id];
    delete nh[id];
    set({ plans: next, meta: nm, history: nh });
    if (settings.activePlanId === id) get().setSettings({ activePlanId: Object.keys(next)[0] ?? null });
  },
  async clearPlans() {
    // Pending saves would write a plan straight back after it is cleared.
    await flushLocalWrites();
    await clearPlanData();
    pendingSaves.clear();
    try {
      sessionStorage.removeItem('lv-wizard');
    } catch {
      /* Storage unavailable. */
    }
    set({ plans: {}, meta: {}, history: {}, saveStatus: {}, scenarioId: null, sandbox: null });
    get().setSettings({ activePlanId: null });
    if ((await allPlans()).length) {
      set({ ready: false });
      await get().init();
    }
  },
  async importPlan(raw) {
    const loaded = (await loadEngine()).loadPlan(raw);
    if (loaded.readOnly)
      throw new Error(
        'This backup was made by a newer version of the app. Update the app, then import it again.',
      );
    if (!loaded.plan) throw new Error(loaded.error ?? 'This file is not a plan.');
    if (loaded.migrated)
      await addSnapshot({
        planId: loaded.plan.id,
        takenAt: new Date().toISOString(),
        reason: 'pre-migration',
        plan: raw,
      });
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
    const previous = get().plans[plan.id];
    const parsed = (await loadEngine()).PlanZ.parse(plan);
    const prev = get().meta[parsed.id] ?? { syncVersion: 0, dirty: false, readOnly: false };
    const m = { ...prev, ...metaPatch, readOnly: false };
    await putPlan(
      {
        id: parsed.id,
        plan: parsed,
        updatedAt: parsed.updatedAt,
        syncVersion: m.syncVersion,
        dirty: m.dirty,
      },
      previous?.updatedAt ?? null,
    );
    set((s) => ({
      plans: { ...s.plans, [parsed.id]: parsed },
      meta: { ...s.meta, [parsed.id]: m },
      history: { ...s.history, [parsed.id]: { undo: [], redo: [] } },
    }));
  },
  setActive(id) {
    set({ scenarioId: null });
    get().setSettings({ activePlanId: id });
  },
  setScenario(id) {
    set({ scenarioId: id });
  },

  update(recipe, planId) {
    const s = get();
    if (s.sandbox) {
      if (s.sandbox.observeOnly) return;
      const [next] = produceWithPatches(s.sandbox.plan, recipe);
      set({ sandbox: { ...s.sandbox, plan: next } });
      return;
    }
    const id = planId ?? s.settings.activePlanId;
    if (!id || !s.plans[id] || s.meta[id]?.readOnly) return;
    const [next, patches, inverse] = produceWithPatches(s.plans[id], (d) => {
      recipe(d);
      d.updatedAt = nextRevision(s.plans[id].updatedAt);
    });
    if (patches.length <= 1 && patches.every((p) => p.path[0] === 'updatedAt')) return;
    const error = validationMessage(next);
    if (error) {
      s.notify(error, 'warn');
      return;
    }
    const h = s.history[id] ?? { undo: [], redo: [] };
    const meta = { ...s.meta[id], dirty: true };
    set({
      plans: { ...s.plans, [id]: next },
      meta: { ...s.meta, [id]: meta },
      history: { ...s.history, [id]: { undo: [...h.undo.slice(-99), { patches, inverse }], redo: [] } },
    });
    persist(next, meta, s.plans[id].updatedAt);
  },
  undo() {
    const s = get();
    const id = s.settings.activePlanId;
    if (s.sandbox || !id) return;
    const h = s.history[id];
    const last = h?.undo[h.undo.length - 1];
    if (!last) return;
    const next = {
      ...applyPatches(s.plans[id], last.inverse),
      updatedAt: nextRevision(s.plans[id].updatedAt),
    };
    const meta = { ...s.meta[id], dirty: true };
    set({
      plans: { ...s.plans, [id]: next },
      meta: { ...s.meta, [id]: meta },
      history: { ...s.history, [id]: { undo: h.undo.slice(0, -1), redo: [...h.redo, last] } },
    });
    persist(next, meta, s.plans[id].updatedAt);
  },
  redo() {
    const s = get();
    const id = s.settings.activePlanId;
    if (s.sandbox || !id) return;
    const h = s.history[id];
    const last = h?.redo[h.redo.length - 1];
    if (!last) return;
    const next = {
      ...applyPatches(s.plans[id], last.patches),
      updatedAt: nextRevision(s.plans[id].updatedAt),
    };
    const meta = { ...s.meta[id], dirty: true };
    set({
      plans: { ...s.plans, [id]: next },
      meta: { ...s.meta, [id]: meta },
      history: { ...s.history, [id]: { undo: [...h.undo, last], redo: h.redo.slice(0, -1) } },
    });
    persist(next, meta, s.plans[id].updatedAt);
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
