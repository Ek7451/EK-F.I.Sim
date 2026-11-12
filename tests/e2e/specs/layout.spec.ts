/** Protected data-plot area replaces the former card-fit-only policy. */
import { expect, test } from '@playwright/test';
import { dismissPrompt, go, seed } from './helpers';

test('projection plotting area, responsive widths and theme layouts', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.clock.setFixedTime(new Date('2026-11-11T12:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seed(page);
  await go(page, '/explore/projection');
  await dismissPrompt(page);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(size);
    const plot = page.getByRole('img', { name: 'Net worth by account type over time' });
    await expect(plot.locator('canvas')).toBeVisible();
    const box = (await plot.boundingBox())!;
    // Grid top=34, bottom=74: exclude legend, labels, funding strip and zoom control.
    expect(box.height - 108, `${size.width}px actual data plotting height`).toBeGreaterThanOrEqual(
      size.width === 1440 ? 360 : 280,
    );
    expect(box.width).toBeGreaterThanOrEqual(280);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), {
        message: `${size.width}px reflow completes`,
      })
      .toBe(true);
    if (size.width === 1440) {
      const outcomes = (await page.locator('[data-tour="projection-stats"]').boundingBox())!;
      expect(outcomes.y + outcomes.height).toBeLessThan(size.height);
      expect(box.y + box.height - 74).toBeLessThanOrEqual(size.height);
      await page.screenshot({ path: '../../output/playwright/workspace-desktop-light.png' });
      await expect(page).toHaveScreenshot('projection-desktop-light.png', {
        animations: 'disabled',
        mask: [page.locator('[data-tour="recompute-time"]')],
        maxDiffPixelRatio: 0.01,
      });
    }
    if (size.width === 390) {
      await page.screenshot({ path: '../../output/playwright/workspace-phone.png' });
      await expect(page).toHaveScreenshot('projection-phone.png', {
        animations: 'disabled',
        mask: [page.locator('[data-tour="recompute-time"]')],
        maxDiffPixelRatio: 0.01,
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await go(page, '/settings');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await go(page, '/explore/projection');
  await expect(
    page.getByRole('img', { name: 'Net worth by account type over time' }).locator('canvas'),
  ).toBeVisible();
  if (await page.getByRole('button', { name: 'Show details', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Show details', exact: true }).click();
  await page.screenshot({ path: '../../output/playwright/workspace-desktop-dark.png' });
  await expect(page).toHaveScreenshot('projection-desktop-dark.png', {
    animations: 'disabled',
    mask: [page.locator('[data-tour="recompute-time"]')],
    maxDiffPixelRatio: 0.01,
  });
  // 200% browser zoom on a 1440×900 display gives a 720×450 CSS viewport.
  await page.setViewportSize({ width: 720, height: 450 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    .toBe(true);
});
