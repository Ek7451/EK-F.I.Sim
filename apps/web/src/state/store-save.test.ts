import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sampleEarlyRetiree } from '@fisim/engine';
import { useStore } from './store';
import { putPlan } from './db';
vi.mock('./db', () => ({
  putPlan: vi.fn(),
  enqueue: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));
beforeEach(() => {
  vi.useFakeTimers();
  const plan = sampleEarlyRetiree(2026);
  useStore.setState({
    plans: { [plan.id]: plan },
    meta: { [plan.id]: { dirty: false, readOnly: false, syncVersion: 0 } },
    settings: { ...useStore.getState().settings, activePlanId: plan.id },
    saveStatus: {},
    sandbox: null,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it('reports a failed write and retries the current revision without losing edits', async () => {
  vi.mocked(putPlan).mockRejectedValueOnce(new Error('Quota exceeded')).mockResolvedValue(undefined);
  useStore.getState().update((p) => {
    p.name = 'Unsaved change';
  });
  const id = useStore.getState().settings.activePlanId!;
  expect(useStore.getState().saveStatus[id]).toBe('saving');
  await vi.advanceTimersByTimeAsync(200);
  expect(useStore.getState().saveStatus[id]).toBe('error');
  expect(useStore.getState().plans[id].name).toBe('Unsaved change');
  useStore.getState().retrySave();
  await vi.advanceTimersByTimeAsync(200);
  expect(useStore.getState().saveStatus[id]).toBe('saved');
  expect(putPlan).toHaveBeenLastCalledWith(
    expect.objectContaining({ plan: expect.objectContaining({ name: 'Unsaved change' }) }),
  );
});
