import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredPlan } from './db';
import { sampleBasic } from '@fisim/engine';

describe('R3 IndexedDB lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  const row = (id: string, revision: string): StoredPlan => ({
    id,
    updatedAt: revision,
    dirty: true,
    syncVersion: 0,
    plan: { ...sampleBasic(2026), id, updatedAt: revision },
  });
  it('N02/N08 aborts an entire batch including snapshots and outbox when a later collision fails', async () => {
    const d = await import('./db');
    await d.putPlan(row('a', 'one'));
    const before = await d.queue();
    await expect(
      d.importRecords([
        { record: row('a', 'two'), expectedRevision: 'one' },
        { record: row('b', 'two'), expectedRevision: 'wrong' },
      ]),
    ).rejects.toThrow('changed');
    expect(await d.allPlans()).toEqual([row('a', 'one')]);
    expect(await d.queue()).toEqual(before);
    expect(await d.snapshotsFor('a')).toEqual([]);
  });
  it('commits the restored plan selection and preserves device preferences before returning', async () => {
    const d = await import('./db');
    await d.setSetting('app', { theme: 'dark', activePlanId: 'other' });
    const original = row('recovery', 'one');
    await d.putPlan(original);
    await d.importRecords([{ record: row('recovery', 'two'), expectedRevision: 'one' }]);
    expect(await d.getSetting('app')).toEqual({ theme: 'dark', activePlanId: 'recovery', onboarded: true });
    expect((await d.snapshotsFor('recovery'))[0].plan).toEqual(original.plan);
  });
  it('N03 blocks stale updates after delete and after workspace revocation', async () => {
    const d = await import('./db');
    await d.putPlan(row('a', 'one'), null);
    await d.removePlan('a', { planId: 'a', op: 'delete', queuedAt: 'two' }, 'one');
    await expect(d.putPlan(row('a', 'three'), 'one')).rejects.toThrow('different tab');
    await (await d.db()).put('settings', 20, 'workspaceEpoch');
    await expect(d.putPlan(row('a', 'four'))).rejects.toThrow('workspace changed');
    expect(await d.allPlans()).toEqual([]);
    expect((await d.queue()).map((q) => q.op)).toEqual(['delete']);
  });
  it('N02 acknowledges only the uploaded bytes and preserves a newer edit or tombstone', async () => {
    const d = await import('./db');
    const a = row('a', 'one'),
      b = row('a', 'two');
    await d.putPlan(a, null);
    await d.putPlan(b, a.updatedAt);
    await d.acknowledgePlan('a', a.plan, 1);
    expect((await d.allPlans())[0]).toMatchObject({ dirty: true, syncVersion: 1, plan: b.plan });
    expect(await d.queue()).toHaveLength(1);
    await d.acknowledgePlan('a', b.plan, 2);
    expect((await d.allPlans())[0]).toMatchObject({ dirty: false, syncVersion: 2 });
    expect(await d.queue()).toHaveLength(0);
    await d.removePlan('a', { planId: 'a', op: 'delete', queuedAt: 'three', syncVersion: 2 }, b.updatedAt);
    await d.acknowledgePlan('a', b.plan, 3);
    expect(await d.allPlans()).toHaveLength(0);
    expect(await d.queue()).toEqual([expect.objectContaining({ op: 'delete', syncVersion: 3 })]);
  });
  it('N05 separates unselected guest plans and restores them on logout', async () => {
    const d = await import('./db');
    await d.putPlan(row('mine', 'one'));
    await d.putPlan(row('guest', 'one'));
    await d.adoptWorkspace('account', ['mine']);
    expect((await d.allPlans()).map((p) => p.id)).toEqual(['mine']);
    expect((await d.queue()).map((p) => p.planId)).toEqual(['mine']);
    await d.clearPlanData();
    expect((await d.allPlans()).map((p) => p.id)).toEqual(['guest']);
    expect((await d.queue()).map((p) => p.planId)).toEqual(['guest']);
  });
  it('N07 backs up the original before attaching a legacy baseline and preserves invalid records', async () => {
    const d = await import('./db');
    const r = row('p', 'one');
    const legacy = { ...sampleBasic(2026), id: 'p', schemaVersion: 2 };
    await d.putPlan({ ...r, plan: legacy });
    const baseline = { startYear: 2026, takenAt: '2026-01-01', points: [{ year: 2026, investable: 100 }] };
    await d.setSetting('baseline:p', baseline);
    await d.putPlan({ ...row('broken', 'one'), plan: { schemaVersion: 2, people: 'invalid' } });
    await d.setSetting('baseline:broken', baseline);
    await d.migrateProgressBaselines();
    expect((await d.snapshotsFor('p'))[0].plan).toEqual(legacy);
    expect((await d.allPlans()).find((p) => p.id === 'p')?.plan).toMatchObject({
      schemaVersion: 3,
      progressBaseline: baseline,
    });
    expect(await d.getSetting('baseline:broken')).toEqual(baseline);
    expect(await d.getSetting('baseline:p')).toBeUndefined();
  });
});
