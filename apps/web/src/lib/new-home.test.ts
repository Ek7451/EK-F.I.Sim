import { SAMPLE_PLANS, loadPlan } from '@fisim/engine';
import { describe, expect, it } from 'vitest';
import { packPlans, unpackPlans } from './new-home';

describe('moving plans to the new address', () => {
  const plans = Object.values(SAMPLE_PLANS).map((make) => make(2026));

  it('round-trips every sample plan through the link, unchanged and loadable', async () => {
    const packed = await packPlans(plans);
    // Only characters that are safe in a link, with no padding.
    expect(packed).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await unpackPlans(packed);
    expect(back).toEqual(JSON.parse(JSON.stringify(plans)));
    for (const raw of back) expect(loadPlan(raw).plan).toBeTruthy();
  });

  it('keeps a typical set of plans well inside what a link can carry', async () => {
    expect((await packPlans(plans)).length).toBeLessThan(200_000);
  });

  it('refuses anything that is not a hand-over', async () => {
    await expect(unpackPlans('not-a-handover')).rejects.toThrow();
  });
});
