/** Local-first persistence in IndexedDB (SYNC-01, plan 11): plans, snapshots, actuals, syncQueue, settings. */
import { openDB, type IDBPDatabase } from 'idb';

export interface StoredPlan {
  id: string;
  /** Raw plan JSON as saved (possibly an older schema version until migrated). */
  plan: unknown;
  updatedAt: string;
  /** Last version the sync server acknowledged (0 = never synced). */
  syncVersion: number;
  /** True when there are local edits the server has not seen. */
  dirty: boolean;
}

export interface Snapshot {
  key?: number;
  planId: string;
  takenAt: string;
  reason: 'pre-migration' | 'manual' | 'conflict' | 'pre-import';
  plan: unknown;
}

export interface QueueItem {
  key?: number;
  planId: string;
  op: 'put' | 'delete';
  queuedAt: string;
  /** The version actually seen before a local deletion, never a freshly fetched remote version. */
  syncVersion?: number;
  planName?: string;
}

let dbp: Promise<IDBPDatabase> | null = null;

export function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    let abandoned = false;
    let rejectBlocked!: (error: Error) => void;
    const blocked = new Promise<never>((_, reject) => {
      rejectBlocked = reject;
    });
    const opening = openDB('longview', 1, {
      blocked() {
        abandoned = true;
        rejectBlocked(
          new Error('Another Longview tab is holding the database open. Close that tab, then retry.'),
        );
      },
      blocking(_current, _next, event) {
        (event.target as IDBDatabase).close();
        dbp = null;
      },
      upgrade(d) {
        d.createObjectStore('plans', { keyPath: 'id' });
        const snaps = d.createObjectStore('snapshots', { keyPath: 'key', autoIncrement: true });
        snaps.createIndex('planId', 'planId');
        d.createObjectStore('actuals', { keyPath: 'planId' });
        d.createObjectStore('syncQueue', { keyPath: 'key', autoIncrement: true });
        d.createObjectStore('settings');
      },
      terminated() {
        dbp = null;
      },
    }).then((connection) => {
      if (abandoned) connection.close();
      return connection;
    });
    dbp = Promise.race([opening, blocked]).catch((error) => {
      dbp = null;
      throw error;
    });
  }
  return dbp;
}

export async function allPlans(): Promise<StoredPlan[]> {
  return (await db()).getAll('plans');
}
let workspaceEpoch = 0;
export async function openWorkspace(): Promise<void> {
  workspaceEpoch = (await getSetting<number>('workspaceEpoch')) ?? 0;
}
async function planTransaction() {
  const expectedEpoch = workspaceEpoch;
  const d = await db();
  const tx = d.transaction(['plans', 'syncQueue', 'settings', 'snapshots', 'actuals'], 'readwrite');
  const epoch = (await tx.objectStore('settings').get('workspaceEpoch')) ?? 0;
  if (epoch !== expectedEpoch) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error('This workspace changed in another tab. Reopen Longview before saving.');
  }
  return tx;
}
type PlanTransaction = Awaited<ReturnType<typeof planTransaction>>;
async function replaceIntent(tx: PlanTransaction, item: QueueItem): Promise<void> {
  const store = tx.objectStore('syncQueue');
  for (const old of (await store.getAll()) as QueueItem[])
    if (old.planId === item.planId && old.key !== undefined) await store.delete(old.key);
  await store.add(item);
}
export interface ImportRecord {
  record: StoredPlan;
  expectedRevision: string | null;
  original?: unknown;
}
/** Park unselected guest data and bind the workspace in one transaction. */
export async function adoptWorkspace(account: string, selected: string[]): Promise<void> {
  const tx = await planTransaction();
  const settings = tx.objectStore('settings');
  const bound = await settings.get('cloudAccountId');
  if (bound && bound !== account) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error('This workspace belongs to another account.');
  }
  if (!bound) {
    const ids = new Set(selected);
    const guest: Record<string, unknown[]> = {};
    for (const name of ['plans', 'snapshots', 'syncQueue', 'actuals']) {
      const store = tx.objectStore(name);
      const records = await store.getAll();
      guest[name] = records.filter((row) => !ids.has(row.planId ?? row.id));
      for (const row of records) {
        if (ids.has(row.planId ?? row.id)) continue;
        await store.delete(row[store.keyPath as string]);
      }
    }
    await settings.put(guest, 'guestWorkspace');
    await settings.put(account, 'cloudAccountId');
    const next = workspaceEpoch + 1;
    await settings.put(next, 'workspaceEpoch');
    await tx.done;
    workspaceEpoch = next;
    announceWorkspace(next);
    return;
  }
  await tx.done;
}
function announceWorkspace(epoch: number): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem('lv-workspace-reset', String(epoch));
  } catch {
    /* The transactional epoch still fences stale tabs. */
  }
}
export async function importRecords(records: ImportRecord[]): Promise<void> {
  const tx = await planTransaction();
  try {
    for (const { record, expectedRevision, original } of records) {
      const store = tx.objectStore('plans');
      const old = await store.get(record.id);
      if ((old?.updatedAt ?? null) !== expectedRevision)
        throw new Error('Plans changed since review. Reopen the import.');
      const snapshots = tx.objectStore('snapshots');
      const entry = { planId: record.id, takenAt: new Date().toISOString() };
      if (old) await snapshots.add({ ...entry, plan: old.plan, reason: 'pre-import' });
      if (original !== undefined) await snapshots.add({ ...entry, plan: original, reason: 'pre-migration' });
      await store.put(record);
      await replaceIntent(tx, { planId: record.id, op: 'put', queuedAt: record.updatedAt });
    }
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already aborted by IndexedDB. */
    }
    await tx.done.catch(() => undefined);
    throw error;
  }
  await tx.done;
}
async function requireRevision(
  tx: PlanTransaction,
  id: string,
  expected: string | null | undefined,
): Promise<void> {
  if (expected === undefined) return;
  const row = await tx.objectStore('plans').get(id);
  if ((row?.updatedAt ?? null) === expected) return;
  tx.abort();
  await tx.done.catch(() => undefined);
  throw new Error(
    'A different tab saved or removed this plan. Reopen the workspace to review the latest revision.',
  );
}
export async function putPlan(p: StoredPlan, expectedRevision?: string | null): Promise<void> {
  const tx = await planTransaction();
  await requireRevision(tx, p.id, expectedRevision);
  const store = tx.objectStore('plans');
  const previous = (await store.get(p.id)) as StoredPlan | undefined;
  await store.put({ ...p, syncVersion: Math.max(p.syncVersion, previous?.syncVersion ?? 0) });
  if (p.dirty) await replaceIntent(tx, { planId: p.id, op: 'put', queuedAt: p.updatedAt });
  await tx.done;
}
/** Record a server acknowledgment against the durable revision. Later edits and tombstones survive it. */
export async function acknowledgePlan(id: string, uploaded: unknown, version: number): Promise<void> {
  const tx = await planTransaction();
  const plans = tx.objectStore('plans');
  const row = (await plans.get(id)) as StoredPlan | undefined;
  const queue = tx.objectStore('syncQueue');
  const intents = ((await queue.getAll()) as QueueItem[]).filter((q) => q.planId === id);
  if (row && row.syncVersion <= version) {
    const dirty = JSON.stringify(row.plan) !== JSON.stringify(uploaded);
    await plans.put({ ...row, dirty, syncVersion: version });
    if (dirty) await replaceIntent(tx, { planId: id, op: 'put', queuedAt: row.updatedAt });
    else for (const intent of intents) if (intent.key !== undefined) await queue.delete(intent.key);
  } else if (!row) {
    for (const intent of intents)
      if (intent.op === 'delete')
        await queue.put({ ...intent, syncVersion: Math.max(intent.syncVersion ?? 0, version) });
  }
  await tx.done;
}

export async function removePlan(
  id: string,
  intent: QueueItem | null,
  expectedRevision?: string,
): Promise<void> {
  const tx = await planTransaction();
  await requireRevision(tx, id, expectedRevision);
  await tx.objectStore('plans').delete(id);
  if (intent) await replaceIntent(tx, intent);
  else {
    const queue = tx.objectStore('syncQueue');
    for (const item of (await queue.getAll()) as QueueItem[])
      if (item.planId === id && item.key !== undefined) await queue.delete(item.key);
  }
  await tx.done;
}
export async function addSnapshot(s: Snapshot): Promise<void> {
  const tx = await planTransaction();
  const snapshots = tx.objectStore('snapshots');
  await snapshots.add(s);
  // Keep the 20 most recent snapshots per plan.
  const keys = await snapshots.index('planId').getAllKeys(s.planId);
  for (const k of keys.slice(0, Math.max(0, keys.length - 20))) await snapshots.delete(k);
  await tx.done;
}
export async function snapshotsFor(planId: string): Promise<Snapshot[]> {
  return (await db()).getAllFromIndex('snapshots', 'planId', planId);
}
export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db()).get('settings', key);
}
export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', value, key);
}
export async function deleteSetting(key: string): Promise<void> {
  await (await db()).delete('settings', key);
}
/** Signing out of the cloud: every plan, snapshot, logged balance and pending upload leaves this browser. */
export async function clearPlanData(): Promise<void> {
  const tx = await planTransaction();
  const settings = tx.objectStore('settings');
  const nextEpoch = ((await settings.get('workspaceEpoch')) ?? 0) + 1;
  await settings.put(nextEpoch, 'workspaceEpoch');
  for (const key of await settings.getAllKeys())
    if (typeof key === 'string' && key.startsWith('baseline:')) await settings.delete(key);
  const guest = await settings.get('guestWorkspace');
  await Promise.all([
    tx.objectStore('plans').clear(),
    tx.objectStore('snapshots').clear(),
    tx.objectStore('actuals').clear(),
    tx.objectStore('syncQueue').clear(),
  ]);
  if (guest) {
    for (const name of ['plans', 'snapshots', 'syncQueue', 'actuals'])
      for (const record of guest[name] ?? []) await tx.objectStore(name).put(record);
    await settings.delete('guestWorkspace');
  }
  await settings.delete('cloudAccountId');
  await tx.done;
  workspaceEpoch = nextEpoch;
  announceWorkspace(nextEpoch);
}
/** Move a legacy progress reference inside its plan and outbox before erasing the old copy. */
export async function migrateProgressBaselines(): Promise<void> {
  const d = await db();
  if (!(await d.getAllKeys('settings')).some((key) => typeof key === 'string' && key.startsWith('baseline:')))
    return;
  const { loadPlan, PlanZ } = await import('@fisim/engine');
  const tx = await planTransaction();
  const settings = tx.objectStore('settings');
  const plans = tx.objectStore('plans');
  for (const key of await settings.getAllKeys()) {
    if (typeof key !== 'string' || !key.startsWith('baseline:')) continue;
    const id = key.slice(9);
    const row = (await plans.get(id)) as StoredPlan | undefined;
    if (!row) continue;
    const loaded = loadPlan(row.plan);
    if (!loaded.plan || loaded.plan.id !== id) continue;
    const baseline = await settings.get(key);
    const now = new Date().toISOString();
    const result = PlanZ.safeParse({
      ...loaded.plan,
      progressBaseline: loaded.plan.progressBaseline ?? baseline,
      updatedAt: now,
    });
    if (!result.success) continue;
    await tx
      .objectStore('snapshots')
      .add({ planId: id, plan: row.plan, takenAt: now, reason: 'pre-migration' });
    await plans.put({ ...row, dirty: true, updatedAt: now, plan: result.data });
    await replaceIntent(tx, { planId: id, op: 'put', queuedAt: now });
    await settings.delete(key);
  }
  await tx.done;
}
export async function queue(): Promise<QueueItem[]> {
  return (await db()).getAll('syncQueue');
}
export async function dequeue(key: number): Promise<void> {
  const tx = await planTransaction();
  await tx.objectStore('syncQueue').delete(key);
  await tx.done;
}

/** Local error ring buffer the user can export for debugging (plan 14.4). No telemetry leaves the device. */
const ERR_KEY = 'errorLog';
export async function logError(message: string): Promise<void> {
  try {
    const cur = ((await getSetting<{ at: string; message: string }[]>(ERR_KEY)) ?? []).slice(-49);
    cur.push({ at: new Date().toISOString(), message: message.slice(0, 2000) });
    await setSetting(ERR_KEY, cur);
  } catch {
    /* storage unavailable */
  }
}
export async function errorLog(): Promise<{ at: string; message: string }[]> {
  return (await getSetting<{ at: string; message: string }[]>(ERR_KEY)) ?? [];
}
