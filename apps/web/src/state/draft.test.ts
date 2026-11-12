import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyScenario, sampleEarlyRetiree } from '@fisim/engine';
import { scenarioChanges, useDraft } from './draft';
import { useStore } from './store';

vi.mock('./db', () => ({
  putPlan: vi.fn().mockResolvedValue(undefined),
  enqueue: vi.fn().mockResolvedValue(undefined),
  setSetting: vi.fn().mockResolvedValue(undefined),
}));

describe('planning transactions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const plan = sampleEarlyRetiree(2026);
    useStore.setState({
      plans: { [plan.id]: plan },
      history: {},
      meta: { [plan.id]: { dirty: false, readOnly: false, syncVersion: 0 } },
      settings: { ...useStore.getState().settings, activePlanId: plan.id },
      sandbox: null,
    });
    useDraft.getState().discard();
  });
  const base = () => useStore.getState().plans[useStore.getState().settings.activePlanId!];
  const change = (age: number) =>
    useDraft.getState().edit(base(), 'Retirement timing', (p) => {
      const m = p.milestones.find((x) => x.kind === 'retirement');
      if (m?.when.type === 'age') m.when.age = age;
    });
  it('many previews leave the baseline untouched, then apply as exactly one undo step', () => {
    const original = base();
    for (const age of [51, 52, 54, 51]) change(age);
    expect(base()).toBe(original);
    expect(useStore.getState().history[original.id]).toBeUndefined();
    expect(useDraft.getState().apply()).toBe(true);
    expect(useStore.getState().history[original.id].undo).toHaveLength(1);
    useStore.getState().undo();
    expect(base().milestones).toEqual(original.milestones);
    useStore.getState().redo();
    expect(base().milestones).not.toEqual(original.milestones);
  });
  it('discard and cancelled gestures restore the exact pre-gesture draft', () => {
    const original = base();
    change(51);
    const before = useDraft.getState().transaction;
    change(56);
    useDraft.getState().restore(before);
    expect(useDraft.getState().transaction).toBe(before);
    useDraft.getState().discard();
    expect(base()).toBe(original);
    expect(useStore.getState().history[original.id]).toBeUndefined();
  });
  it('saves a scenario without altering baseline assumptions, and applies it after reordering', () => {
    const original = base();
    change(51);
    expect(useDraft.getState().saveScenario('One more year')).toBe(true);
    const saved = base();
    expect(saved.milestones).toEqual(original.milestones);
    const expected = applyScenario(saved, saved.scenarios.at(-1)!.id);
    const reordered = { ...saved, milestones: [...saved.milestones].reverse() };
    const candidate = applyScenario(reordered, saved.scenarios.at(-1)!.id);
    for (const m of expected.milestones) expect(candidate.milestones.find((x) => x.id === m.id)).toEqual(m);
  });
  it('rejects applying a draft after the baseline changes', () => {
    change(51);
    useStore.getState().update((p) => {
      p.name = 'Concurrent change';
    });
    expect(useDraft.getState().apply()).toBe(false);
    expect(useDraft.getState().saveScenario('Conflict')).toBe(false);
  });
  it('preserves optional-field removal through scenario JSON export', () => {
    const original = base();
    const withNote = { ...original, accounts: original.accounts.map((a) => ({ ...a, note: 'Old note' })) };
    const edited = {
      ...withNote,
      accounts: withNote.accounts.map((a) => ({ ...a, note: undefined })),
    };
    const patches = JSON.parse(JSON.stringify(scenarioChanges(withNote, edited)));
    const restored = applyScenario(
      { ...withNote, scenarios: [{ id: 'clear-note', name: 'Clear note', patches }] },
      'clear-note',
    );
    expect(restored.accounts).toEqual(JSON.parse(JSON.stringify(edited.accounts)));
  });
  it('rejects deleted entity targets instead of changing a neighboring milestone', () => {
    const original = base();
    change(51);
    const t = useDraft.getState().transaction!;
    const patches = scenarioChanges(t.base, t.plan);
    const target = original.milestones.find((m) => m.kind === 'retirement')!;
    const removed = {
      ...original,
      milestones: original.milestones.filter((m) => m.id !== target.id),
      scenarios: [{ id: 'removed', name: 'Removed item', patches }],
    };
    expect(() => applyScenario(removed, 'removed')).toThrow(/removed or changed item/);
  });
});
