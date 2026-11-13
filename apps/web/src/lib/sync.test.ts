import { afterEach, expect, it, vi } from 'vitest';
import { sampleEarlyRetiree } from '@fisim/engine';
import { useStore } from '../state/store';
import { putPlan, queue, dequeue } from '../state/db';
import { resolveConflict, setUpSync, syncNow, turnOffSync, useSync } from './sync';

vi.mock('../state/db', () => ({
  addSnapshot: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
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
