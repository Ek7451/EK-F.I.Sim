import { expect, it, vi } from 'vitest';
import { sampleEarlyRetiree, loadPlan } from '@fisim/engine';
import { useStore } from './store';
import { addSnapshot, allPlans, getSetting, putPlan } from './db';
vi.mock('./db', () => ({
  addSnapshot: vi.fn().mockResolvedValue(undefined),
  allPlans: vi.fn(),
  getSetting: vi.fn(),
  putPlan: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../engine/load', () => ({ loadEngine: async () => ({ loadPlan }) }));
it('stores an intact pre-migration recovery snapshot before writing schema v2', async () => {
  const p = sampleEarlyRetiree(2026);
  const raw = {
    ...p,
    schemaVersion: 1,
    scenarios: [
      { id: 'later', name: 'Later', patches: [{ path: ['milestones', 0, 'when', 'age'], value: 51 }] },
    ],
  };
  const backup = JSON.stringify(raw);
  vi.mocked(allPlans).mockResolvedValue([
    { id: p.id, plan: raw, updatedAt: p.updatedAt, syncVersion: 3, dirty: false },
  ]);
  vi.mocked(getSetting).mockResolvedValue({ activePlanId: p.id });
  useStore.setState({ ready: false });
  await useStore.getState().init();
  expect(addSnapshot).toHaveBeenCalledWith(expect.objectContaining({ reason: 'pre-migration', plan: raw }));
  expect(vi.mocked(addSnapshot).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(putPlan).mock.invocationCallOrder[0],
  );
  expect(JSON.stringify(raw)).toBe(backup);
  expect(useStore.getState().plans[p.id].schemaVersion).toBe(2);
  expect(useStore.getState().plans[p.id].scenarios[0].patches[0].path[1]).toBe(`@${p.milestones[0].id}`);
  expect(loadPlan(JSON.parse(backup)).plan).toEqual(useStore.getState().plans[p.id]);
});
