/**
 * End-to-end-encrypted sync (SYNC-02, SYNC-04). Plans are encrypted on this device with the data key before upload;
 * the server only ever stores ciphertext. Sign-in to the sync service (Cloudflare Access) is separate from the key.
 * Offline edits wait in the IndexedDB queue and are sent on the next sync; a version mismatch becomes a conflict
 * the user resolves (keep mine, keep theirs, or keep both).
 */
import {
  changePassphrase,
  createKeyBundle,
  decryptPlan,
  encryptPlan,
  resetPassphraseWithRecoveryKey,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type KeyBundle,
} from '@fisim/crypto';
import type { Plan } from '@fisim/engine';
import { loadEngine } from '../engine/load';
import { create } from 'zustand';
import { addSnapshot, dequeue, getSetting, queue, setSetting } from '../state/db';
import { useStore, type TourProgress } from '../state/store';
import { createSyncClient, isConflict, SyncError, type SyncClient } from '../sync/client';

export interface SyncConflict {
  planId: string;
  planName: string;
  serverVersion: number;
  serverUpdatedAt: string | null;
  deletedOnServer: boolean;
}

interface SyncState {
  status: 'off' | 'locked' | 'idle' | 'syncing' | 'offline' | 'error';
  message: string;
  lastSyncAt: string | null;
  conflicts: SyncConflict[];
  hasKeys: boolean;
}
export const useSync = create<SyncState>(() => ({
  status: 'off',
  message: '',
  lastSyncAt: null,
  conflicts: [],
  hasKeys: false,
}));

let dek: CryptoKey | null = null;
let bundle: KeyBundle | null = null;
let bundleVersion = 0;
let settingsVersion = 0;
const enc = new TextEncoder();
const dec = new TextDecoder();
const SETTINGS_ID = 'app-settings';

function client(): SyncClient {
  const url = useStore.getState().settings.syncUrl.trim();
  if (!url) throw new Error('Enter the address of your sync service first.');
  return createSyncClient({ baseUrl: url });
}
const fail = (e: unknown): string =>
  e instanceof SyncError
    ? e.status === 401 || e.status === 403
      ? 'Not signed in to the sync service. Open its address in a browser tab, sign in, then try again.'
      : e.message
    : e instanceof Error
      ? e.message
      : String(e);

export async function initSync(): Promise<void> {
  const s = useStore.getState().settings;
  bundle = (await getSetting<KeyBundle>('keyBundle')) ?? null;
  bundleVersion = (await getSetting<number>('keyBundleVersion')) ?? 0;
  settingsVersion = (await getSetting<number>('settingsSyncVersion')) ?? 0;
  useSync.setState({ status: s.syncEnabled ? 'locked' : 'off', hasKeys: !!bundle });
  window.addEventListener('online', () => {
    if (dek) void syncNow();
  });
}

/** First device: create the data key, wrap it with the passphrase and a recovery key, and upload the wrapped bundle. */
export async function setUpSync(passphrase: string): Promise<{ recoveryKey: string }> {
  const c = client();
  const existing = await c.getKeys();
  if (existing)
    throw new Error(
      'This account already has an encryption key. Use "Connect this device" with your passphrase.',
    );
  const made = await createKeyBundle(passphrase);
  const put = await c.putKeys(0, made.bundle);
  if (isConflict(put))
    throw new Error(
      'Another device set up sync at the same moment. Connect this device with that passphrase.',
    );
  bundle = made.bundle;
  bundleVersion = put.version;
  dek = made.dek;
  await setSetting('keyBundle', bundle);
  await setSetting('keyBundleVersion', bundleVersion);
  useStore.getState().setSettings({ syncEnabled: true });
  useSync.setState({ status: 'idle', hasKeys: true, message: '' });
  // Everything local needs a first upload.
  for (const id of Object.keys(useStore.getState().plans)) useStore.getState().setMeta(id, { dirty: true });
  void syncNow(true);
  return { recoveryKey: made.recoveryKey };
}

/** Another device, or a new session: fetch the wrapped bundle and unlock it with the passphrase. */
export async function unlockSync(passphrase: string): Promise<void> {
  if (!bundle) {
    const got = await client().getKeys();
    if (!got) throw new Error('No encryption key exists for this account yet. Set up sync first.');
    bundle = got.bundle as KeyBundle;
    bundleVersion = got.version;
    await setSetting('keyBundle', bundle);
    await setSetting('keyBundleVersion', bundleVersion);
  }
  dek = await unlockWithPassphrase(bundle, passphrase);
  useStore.getState().setSettings({ syncEnabled: true });
  useSync.setState({ status: 'idle', hasKeys: true, message: '' });
  void syncNow();
}

/** Lost passphrase: unlock with the recovery key and set a new passphrase. Plans are not re-encrypted. */
export async function recoverSync(recoveryKey: string, newPassphrase: string): Promise<void> {
  const c = client();
  const got = await c.getKeys();
  const b = (got?.bundle as KeyBundle | undefined) ?? bundle;
  if (!b) throw new Error('No encryption key exists for this account.');
  await unlockWithRecoveryKey(b, recoveryKey);
  const reset = await resetPassphraseWithRecoveryKey(b, recoveryKey, newPassphrase);
  const put = await c.putKeys(got?.version ?? bundleVersion, reset.bundle);
  if (isConflict(put)) throw new Error('The key changed on another device. Try again.');
  bundle = reset.bundle;
  bundleVersion = put.version;
  dek = reset.dek;
  await setSetting('keyBundle', bundle);
  await setSetting('keyBundleVersion', bundleVersion);
  useStore.getState().setSettings({ syncEnabled: true });
  useSync.setState({ status: 'idle', hasKeys: true, message: '' });
  void syncNow();
}

export async function changeSyncPassphrase(newPassphrase: string): Promise<void> {
  if (!dek || !bundle) throw new Error('Unlock sync first.');
  const next = await changePassphrase(bundle, dek, newPassphrase);
  const put = await client().putKeys(bundleVersion, next);
  if (isConflict(put)) throw new Error('The key changed on another device. Unlock again and retry.');
  bundle = next;
  bundleVersion = put.version;
  await setSetting('keyBundle', bundle);
  await setSetting('keyBundleVersion', bundleVersion);
}

export function lockSync(): void {
  dek = null;
  useSync.setState({ status: useStore.getState().settings.syncEnabled ? 'locked' : 'off' });
}
export async function turnOffSync(): Promise<void> {
  dek = null;
  useStore.getState().setSettings({ syncEnabled: false });
  useSync.setState({ status: 'off', conflicts: [] });
}
export const isUnlocked = (): boolean => !!dek;

async function upload(c: SyncClient, plan: Plan, expected: number): Promise<number | SyncConflict> {
  const blob = await encryptPlan(dek!, plan.id, expected + 1, enc.encode(JSON.stringify(plan)));
  const res = await c.putPlan(plan.id, expected, blob);
  if (isConflict(res))
    return {
      planId: plan.id,
      planName: plan.name,
      serverVersion: res.version,
      serverUpdatedAt: res.updatedAt,
      deletedOnServer: !!res.deleted,
    };
  return res.version;
}

async function download(c: SyncClient, id: string): Promise<{ plan: Plan; version: number } | null> {
  const got = await c.getPlan(id);
  if (!got) return null;
  const raw = JSON.parse(dec.decode(await decryptPlan(dek!, id, got.version, got.data)));
  const loaded = (await loadEngine()).loadPlan(raw);
  if (!loaded.plan) return null;
  return { plan: loaded.plan, version: got.version };
}

let running: Promise<void> | null = null;
/** Push queued edits, then pull anything newer. Safe to call often; calls made while one is running share it. */
export function syncNow(force = false): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!dek) {
      useSync.setState({ status: useStore.getState().settings.syncEnabled ? 'locked' : 'off' });
      return;
    }
    if (!navigator.onLine) {
      useSync.setState({
        status: 'offline',
        message: 'Offline: changes are saved here and will sync when you reconnect.',
      });
      return;
    }
    useSync.setState({ status: 'syncing', message: '' });
    const store = useStore.getState();
    const conflicts: SyncConflict[] = [];
    try {
      const c = client();
      // ---- push
      const pending = await queue();
      const ids = new Set(pending.map((q) => q.planId));
      if (force) for (const id of Object.keys(store.plans)) if (store.meta[id]?.dirty) ids.add(id);
      for (const id of ids) {
        const item = pending.find((q) => q.planId === id);
        const plan = useStore.getState().plans[id];
        const meta = useStore.getState().meta[id];
        if (item?.op === 'delete' || !plan) {
          const remote = (await c.listPlans()).find((p) => p.id === id && !p.deleted);
          if (remote) await c.deletePlan(id, remote.version);
        } else if (meta?.dirty || force) {
          const res = await upload(c, plan, meta?.syncVersion ?? 0);
          if (typeof res === 'number') {
            useStore.getState().setMeta(id, { syncVersion: res, dirty: false });
            const { putPlan } = await import('../state/db');
            await putPlan({ id, plan, updatedAt: plan.updatedAt, syncVersion: res, dirty: false });
          } else {
            conflicts.push(res);
            continue; // leave it queued until the user decides
          }
        }
        for (const q of pending) if (q.planId === id && q.key !== undefined) await dequeue(q.key);
      }
      // ---- pull
      const remote = await c.listPlans();
      for (const r of remote) {
        const meta = useStore.getState().meta[r.id];
        const local = useStore.getState().plans[r.id];
        if (conflicts.some((x) => x.planId === r.id)) continue;
        if (r.deleted) {
          if (local && !meta?.dirty && (meta?.syncVersion ?? 0) > 0 && r.version > (meta?.syncVersion ?? 0)) {
            await addSnapshot({
              planId: r.id,
              takenAt: new Date().toISOString(),
              reason: 'conflict',
              plan: local,
            });
            await useStore.getState().deletePlan(r.id);
            for (const q of await queue()) if (q.planId === r.id && q.key !== undefined) await dequeue(q.key);
          }
          continue;
        }
        if (!local || (r.version > (meta?.syncVersion ?? 0) && !meta?.dirty)) {
          const got = await download(c, r.id);
          if (got)
            await useStore.getState().replacePlan(got.plan, { syncVersion: got.version, dirty: false });
        }
      }
      await syncSettings(c);
      const now = new Date().toISOString();
      await setSetting('lastSyncAt', now);
      useSync.setState({
        status: 'idle',
        lastSyncAt: now,
        conflicts,
        message: conflicts.length
          ? 'Some plans changed on another device. Choose which version to keep.'
          : '',
      });
    } catch (e) {
      useSync.setState({ status: 'error', message: fail(e), conflicts });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Tour progress travels with sync (plan 10.2): merged per tour, newest wins. */
async function syncSettings(c: SyncClient): Promise<void> {
  const got = await c.getSettings();
  let remoteTours: Record<string, TourProgress> = {};
  if (got) {
    try {
      remoteTours =
        (
          JSON.parse(dec.decode(await decryptPlan(dek!, SETTINGS_ID, got.version, got.data))) as {
            tours?: Record<string, TourProgress>;
          }
        ).tours ?? {};
    } catch {
      remoteTours = {};
    }
    settingsVersion = got.version;
  }
  const local = useStore.getState().settings.tours;
  const merged: Record<string, TourProgress> = { ...remoteTours };
  let localNewer = false;
  for (const id in local) {
    if (!merged[id] || local[id].updatedAt > merged[id].updatedAt) {
      merged[id] = local[id];
      localNewer = true;
    }
  }
  if (JSON.stringify(merged) !== JSON.stringify(local)) useStore.getState().setSettings({ tours: merged });
  if (localNewer || !got) {
    const blob = await encryptPlan(
      dek!,
      SETTINGS_ID,
      settingsVersion + 1,
      enc.encode(JSON.stringify({ tours: merged })),
    );
    const res = await c.putSettings(settingsVersion, blob);
    if (!isConflict(res)) settingsVersion = res.version;
  }
  await setSetting('settingsSyncVersion', settingsVersion);
}

/** Resolve a conflict: keep this device's version, take the server's, or keep both (mine becomes a copy). */
export async function resolveConflict(
  conflict: SyncConflict,
  choice: 'mine' | 'theirs' | 'both',
): Promise<void> {
  if (!dek) throw new Error('Unlock sync first.');
  const c = client();
  const store = useStore.getState();
  const mine = store.plans[conflict.planId];
  if (mine)
    await addSnapshot({ planId: mine.id, takenAt: new Date().toISOString(), reason: 'conflict', plan: mine });
  if (choice === 'both' && mine) await store.createPlan(`${mine.name} (this device)`, mine);
  if (choice === 'mine' && mine) {
    const res = await upload(c, mine, conflict.serverVersion);
    if (typeof res !== 'number')
      throw new Error('The plan changed again on another device. Sync and choose again.');
    useStore.getState().setMeta(mine.id, { syncVersion: res, dirty: false });
  } else {
    const got = conflict.deletedOnServer ? null : await download(c, conflict.planId);
    if (got) await useStore.getState().replacePlan(got.plan, { syncVersion: got.version, dirty: false });
    else if (mine) await useStore.getState().deletePlan(mine.id);
  }
  for (const q of await queue())
    if (q.planId === conflict.planId && q.key !== undefined) await dequeue(q.key);
  useSync.setState((s) => ({ conflicts: s.conflicts.filter((x) => x.planId !== conflict.planId) }));
  void syncNow();
}
