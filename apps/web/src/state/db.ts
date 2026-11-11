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
}

let dbp: Promise<IDBPDatabase> | null = null;

export function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB('longview', 1, {
      upgrade(d) {
        d.createObjectStore('plans', { keyPath: 'id' });
        const snaps = d.createObjectStore('snapshots', { keyPath: 'key', autoIncrement: true });
        snaps.createIndex('planId', 'planId');
        d.createObjectStore('actuals', { keyPath: 'planId' });
        d.createObjectStore('syncQueue', { keyPath: 'key', autoIncrement: true });
        d.createObjectStore('settings');
      },
    });
  }
  return dbp;
}

export async function allPlans(): Promise<StoredPlan[]> {
  return (await db()).getAll('plans');
}
export async function putPlan(p: StoredPlan): Promise<void> {
  await (await db()).put('plans', p);
}
export async function removePlan(id: string): Promise<void> {
  await (await db()).delete('plans', id);
}
export async function addSnapshot(s: Snapshot): Promise<void> {
  const d = await db();
  await d.add('snapshots', s);
  // Keep the 20 most recent snapshots per plan.
  const keys = await d.getAllKeysFromIndex('snapshots', 'planId', s.planId);
  for (const k of keys.slice(0, Math.max(0, keys.length - 20))) await d.delete('snapshots', k);
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
export async function enqueue(item: QueueItem): Promise<void> {
  const d = await db();
  const all = (await d.getAll('syncQueue')) as QueueItem[];
  // Collapse repeated edits to the same plan into one pending item.
  for (const q of all)
    if (q.planId === item.planId && q.key !== undefined) await d.delete('syncQueue', q.key);
  await d.add('syncQueue', item);
}
export async function queue(): Promise<QueueItem[]> {
  return (await db()).getAll('syncQueue');
}
export async function dequeue(key: number): Promise<void> {
  await (await db()).delete('syncQueue', key);
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
