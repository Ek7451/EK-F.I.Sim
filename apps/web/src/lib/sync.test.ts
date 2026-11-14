import { afterEach, expect, it, vi } from 'vitest';
import { sampleEarlyRetiree } from '@fisim/engine';
import { useStore } from '../state/store';
import { clearPlanData, putPlan, queue, dequeue, setSetting } from '../state/db';
import {
  endCloudSession,
  flushCloudSync,
  resolveConflict,
  setUpSync,
  startCloudSync,
  syncNow,
  turnOffSync,
  useSync,
} from './sync';

vi.mock('../state/db', () => ({
  addSnapshot: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
  deleteSetting: vi.fn().mockResolvedValue(undefined),
  clearPlanData: vi.fn().mockResolvedValue(undefined),
  putPlan: vi.fn().mockResolvedValue(undefined),
  removePlan: vi.fn().mockResolvedValue(undefined),
  enqueue: vi.fn().mockResolvedValue(undefined),
  queue: vi.fn().mockResolvedValue([]),
  dequeue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@fisim/crypto', () => ({
  createKeyBundle: async () => ({ bundle: {}, dek: {}, recoveryKey: 'test-only' }),
  encryptPlan: async (_key: unknown, _id: string, _version: number, data: Uint8Array) => data,
  decryptPlan: async (_key: unknown, _id: string, _version: number, data: Uint8Array) => data,
  changePassphrase: vi.fn(),
  resetPassphraseWithRecoveryKey: vi.fn(),
  unlockWithPassphrase: vi.fn(),
  unlockWithRecoveryKey: vi.fn(),
}));
afterEach(async () => {
  await turnOffSync();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('keeps edits made during an upload dirty and preserves their current local copy', async () => {
  vi.stubGlobal('navigator', { onLine: true });
  const plan = sampleEarlyRetiree(2026);
  useStore.setState({
    plans: { [plan.id]: plan },
    meta: { [plan.id]: { syncVersion: 0, dirty: true, readOnly: false } },
    settings: { ...useStore.getState().settings, syncUrl: 'https://sync.example.test' },
  });
  let release = () => {};
  let uploading = false;
  let count = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith(`/plans/${plan.id}`)) {
        if (++count === 1) {
          uploading = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return Response.json({ id: plan.id, version: count, updatedAt: plan.updatedAt, size: 1 });
      }
      if (url.endsWith('/plans')) return Response.json([]);
      if (init.method === 'GET') return new Response(null, { status: 404 });
      return Response.json({ version: 1, updatedAt: plan.updatedAt, size: 1 });
    }),
  );
  await setUpSync('test-only-passphrase');
  await vi.waitFor(() => expect(uploading).toBe(true));
  await useStore
    .getState()
    .replacePlan({ ...plan, name: 'Edited while upload was pending' }, { dirty: true });
  release();
  await syncNow(true);
  expect(useStore.getState().meta[plan.id]).toMatchObject({ syncVersion: 1, dirty: true });
  expect(putPlan).toHaveBeenLastCalledWith(
    expect.objectContaining({
      dirty: true,
      plan: expect.objectContaining({ name: 'Edited while upload was pending' }),
    }),
  );
  await syncNow(true);
  expect(useStore.getState().meta[plan.id]).toMatchObject({ syncVersion: 2, dirty: false });
  await resolveConflict(
    {
      planId: plan.id,
      planName: plan.name,
      serverVersion: 2,
      serverUpdatedAt: plan.updatedAt,
      deletedOnServer: false,
    },
    'mine',
  );
  await syncNow();
  expect(putPlan).toHaveBeenLastCalledWith(expect.objectContaining({ syncVersion: 3, dirty: false }));
});

it('does not delete a newer cloud version when replaying an offline deletion', async () => {
  vi.stubGlobal('navigator', { onLine: true });
  useStore.setState({
    plans: {},
    meta: {},
    settings: { ...useStore.getState().settings, syncUrl: 'https://sync.example.test' },
  });
  vi.mocked(queue).mockResolvedValue([
    {
      key: 1,
      planId: 'deleted-plan',
      planName: 'My plan',
      op: 'delete',
      syncVersion: 2,
      queuedAt: new Date().toISOString(),
    },
  ]);
  const deletedVersions: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'DELETE') {
        deletedVersions.push(new Headers(init.headers).get('If-Match')!);
        return Response.json({ version: 3, updatedAt: '2026-11-12', deleted: false }, { status: 409 });
      }
      if (url.endsWith('/plans'))
        return Response.json([
          { id: 'deleted-plan', version: 3, updatedAt: '2026-11-12', size: 1, deleted: false },
        ]);
      if (init.method === 'GET') return new Response(null, { status: 404 });
      return Response.json({ version: 1, updatedAt: '2026-11-12', size: 1 });
    }),
  );
  await setUpSync('test-only-passphrase');
  await syncNow(true);
  expect(deletedVersions).toEqual(['2']);
  expect(useSync.getState().conflicts).toEqual([
    expect.objectContaining({ planId: 'deleted-plan', serverVersion: 3, deletedLocally: true }),
  ]);
  expect(dequeue).not.toHaveBeenCalled();
});

it('signing in uploads every plan with no further step, and signing out clears them from the device', async () => {
  vi.stubGlobal('navigator', { onLine: true });
  vi.mocked(queue).mockResolvedValue([]);
  const plan = sampleEarlyRetiree(2026);
  useStore.setState({
    plans: { [plan.id]: plan },
    meta: { [plan.id]: { syncVersion: 0, dirty: false, readOnly: false } },
    settings: { ...useStore.getState().settings, syncUrl: '', syncEnabled: false, activePlanId: plan.id },
  });
  const uploads: { url: string; account: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'PUT' && url.includes('/v1/plans/')) {
        uploads.push({ url, account: new Headers(init.headers).get('X-Longview-Account') });
        return Response.json({ id: plan.id, version: 1, updatedAt: plan.updatedAt, size: 1 });
      }
      if (url.endsWith('/v1/plans')) return Response.json([]);
      if (init.method === 'GET') return new Response(null, { status: 404 });
      return Response.json({ version: 1, updatedAt: plan.updatedAt, size: 1 });
    }),
  );
  const key = {} as CryptoKey;
  await startCloudSync({ id: 'user-1', username: 'alice' }, key);
  // Encrypted (here: passed through the mocked cipher) and uploaded at once, to this account only.
  expect(uploads).toEqual([{ url: `/api/v1/plans/${plan.id}`, account: 'user-1' }]);
  expect(setSetting).toHaveBeenCalledWith('cloudKey', { userId: 'user-1', key });
  expect(useStore.getState().settings).toMatchObject({ syncEnabled: true, syncUrl: '/api' });
  expect(useStore.getState().meta[plan.id]).toMatchObject({ syncVersion: 1, dirty: false });
  expect(useSync.getState().status).toBe('idle');

  // Nothing unsent: signing out may go ahead, and it removes the plans from this browser.
  expect(await flushCloudSync()).toBe(true);
  await endCloudSession();
  expect(clearPlanData).toHaveBeenCalled();
  expect(useStore.getState().plans).toEqual({});
  expect(useStore.getState().settings).toMatchObject({ syncEnabled: false, syncUrl: '', activePlanId: null });
  expect(useSync.getState().status).toBe('off');
});

it('will not let a sign-out lose an edit the cloud has not received', async () => {
  vi.stubGlobal('navigator', { onLine: true });
  vi.mocked(queue).mockResolvedValue([]);
  const plan = sampleEarlyRetiree(2026);
  useStore.setState({
    plans: { [plan.id]: plan },
    meta: { [plan.id]: { syncVersion: 0, dirty: false, readOnly: false } },
    settings: { ...useStore.getState().settings, syncUrl: '', syncEnabled: false },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/v1/plans')) return Response.json([]);
      if (init.method === 'GET') return new Response(null, { status: 404 });
      return Response.json({ version: 1, updatedAt: plan.updatedAt, size: 1 });
    }),
  );
  await startCloudSync({ id: 'user-1', username: 'alice' }, {} as CryptoKey);
  // Now the connection drops and an edit waits on this device.
  vi.stubGlobal('navigator', { onLine: false });
  await useStore.getState().replacePlan({ ...plan, name: 'Edited offline' }, { dirty: true });
  expect(await flushCloudSync()).toBe(false);
  await endCloudSession();
});
