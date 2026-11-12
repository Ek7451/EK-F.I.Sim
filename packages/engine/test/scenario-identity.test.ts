import { describe, expect, it } from 'vitest';
import { applyScenario, loadPlan, sampleEarlyRetiree } from '../src';

describe('v2 scenario identity and recovery', () => {
  it('migrates legacy index paths before reordering, preserving the original backup', () => {
    const sample = sampleEarlyRetiree(2026);
    const legacy = {
      ...sample,
      schemaVersion: 1,
      scenarios: [
        {
          id: 'legacy',
          name: 'Retire later',
          patches: [{ path: ['milestones', 0, 'when', 'age'], value: 51 }],
        },
      ],
    };
    const loaded = loadPlan(legacy);
    expect(loaded.migrated).toBe(true);
    expect(loaded.original).toBe(legacy);
    const p = loaded.plan!;
    expect(p.scenarios[0].patches[0].path[1]).toBe(`@${sample.milestones[0].id}`);
    p.milestones.reverse();
    const candidate = applyScenario(p, 'legacy');
    expect(candidate.milestones.find((x) => x.id === sample.milestones[0].id)?.when).toMatchObject({
      age: 51,
    });
    expect(legacy.scenarios[0].patches[0].path[1]).toBe(0);
    expect(loadPlan(JSON.parse(JSON.stringify(p))).plan).toEqual(p);
  });
  it('migrates an entire entity override and rejects a removed target', () => {
    const sample = sampleEarlyRetiree(2026);
    const legacy = {
      ...sample,
      schemaVersion: 1,
      scenarios: [
        {
          id: 'entity',
          name: 'Renamed event',
          patches: [{ path: ['milestones', 0], value: { ...sample.milestones[0], name: 'New name' } }],
        },
      ],
    };
    const p = loadPlan(legacy).plan!;
    expect(applyScenario(p, 'entity').milestones[0].name).toBe('New name');
    p.milestones.shift();
    expect(() => applyScenario(p, 'entity')).toThrow(/removed or changed/);
  });
});
