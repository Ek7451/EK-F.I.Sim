import { expect, test, type Page } from '@playwright/test';
import type { Plan } from '../../../packages/engine/src';
import { workspaceFixtures } from '../fixtures/workspace';
import { dismissPrompt, go, watchErrors } from './helpers';

async function loadFixture(page: Page, plan: Plan): Promise<void> {
  await page.goto('/start');
  await expect(page.locator('main h1')).toBeVisible();
  await page.evaluate(async (p) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('longview', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['plans', 'settings'], 'readwrite');
      tx.objectStore('plans').put({
        id: p.id,
        plan: p,
        updatedAt: p.updatedAt,
        syncVersion: 0,
        dirty: false,
      });
      tx.objectStore('settings').put(
        { activePlanId: p.id, onboarded: true, theme: 'light', promptsDismissed: ['projection'] },
        'app',
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, plan);
  await page.goto('/explore/projection');
  await dismissPrompt(page);
  await expect(page.locator('[data-tour="projection-stats"]')).toContainText('$');
}

for (const [name, plan] of Object.entries(workspaceFixtures())) {
  test(`stress fixture ${name}: usable charts and inputs`, async ({ page }, info) => {
    test.skip(info.project.name === 'tablet');
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loadFixture(page, plan);
    for (const route of [
      '/explore/projection',
      '/explore/cashflow',
      '/explore/taxes',
      '/explore/estate',
      '/plan/snapshot',
      '/compare',
    ]) {
      await go(page, route);
      await expect(page.locator('main h1')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), {
          message: `${name} ${route} reflows`,
        })
        .toBe(true);
      await expect(page.getByText('Something went wrong on this screen')).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('single worker: simulation cancellation and warm input-to-paint profile', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 1 }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadFixture(page, workspaceFixtures().early);
  await go(page, '/explore/success');
  await expect(page.locator('[data-tour="success-rate"]')).toContainText(/of 1,000 runs/, { timeout: 15000 });
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  if (await stop.isVisible()) await stop.click();
  await go(page, '/explore/projection');
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  const age = page.getByLabel('Exact age');
  await age.fill('51');
  await expect(page.getByRole('button', { name: 'Apply to plan' })).toBeEnabled();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    performance.clearMeasures('longview:input-to-result');
    document.addEventListener(
      'input',
      () => {
        const start = performance.now();
        requestAnimationFrame(() =>
          performance.measure('longview:input-feedback', { start, end: performance.now() }),
        );
      },
      true,
    );
    const observer = new PerformanceObserver((list) =>
      list
        .getEntries()
        .forEach((e) =>
          performance.measure('longview:long-task', { start: e.startTime, duration: e.duration }),
        ),
    );
    observer.observe({ type: 'longtask' });
    let last = performance.now();
    const frame = (now: number): void => {
      performance.measure('longview:frame', { start: last, end: now });
      last = now;
      if (performance.getEntriesByName('longview:input-to-result').length < 20) requestAnimationFrame(frame);
      else observer.disconnect();
    };
    requestAnimationFrame(frame);
  });
  for (let i = 0; i < 20; i++) {
    await age.fill(String(50 + (i % 2)));
    await expect
      .poll(() => page.evaluate(() => performance.getEntriesByName('longview:input-to-result').length))
      .toBeGreaterThan(i);
  }
  const samples = await page.evaluate(() =>
    performance
      .getEntriesByName('longview:input-to-result')
      .map((e) => e.duration)
      .sort((a, b) => a - b),
  );
  const paint = await page.evaluate(() => ({
    feedback: performance
      .getEntriesByName('longview:input-feedback')
      .map((e) => e.duration)
      .sort((a, b) => a - b),
    frames: performance
      .getEntriesByName('longview:frame')
      .map((e) => e.duration)
      .sort((a, b) => a - b),
    longTasks: performance.getEntriesByName('longview:long-task').map((e) => e.duration),
  }));
  const profile = {
    samples,
    p95: samples[Math.ceil(samples.length * 0.95) - 1],
    feedbackP95: paint.feedback[Math.ceil(paint.feedback.length * 0.95) - 1],
    frameP95: paint.frames[Math.ceil(paint.frames.length * 0.95) - 1],
    longTasks: paint.longTasks,
  };
  console.log('Workspace input-to-visible-result profile', JSON.stringify(profile));
  await info.attach('input-to-visible-result', {
    body: JSON.stringify(profile, null, 2),
    contentType: 'application/json',
  });
  expect(profile.p95).toBeLessThan(200);
  expect(profile.feedbackP95).toBeLessThan(100);
});
