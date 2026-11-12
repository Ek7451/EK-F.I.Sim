/**
 * One screen, no scroll (brand.md §2.3, review plan Phase 4): on a 1440×900 desktop and a 1366×768 laptop, each
 * major screen's key visual is fully inside the first viewport.
 */
import { expect, test } from '@playwright/test';
import { dismissPrompt, seed } from './helpers';

const SCREENS: [route: string, target: string][] = [
  ['/', 'home-chart'],
  ['/', 'home-stats'],
  ['/explore/projection', 'projection-stats'],
  ['/explore/projection', 'net-worth-chart'],
  ['/explore/projection', 'year-detail'],
  ['/explore/success', 'fan-chart'],
  ['/explore/taxes', 'tax-chart'],
  ['/explore/cashflow', 'sankey'],
  ['/explore/history', 'history-chart'],
  ['/explore/estate', 'estate-stats'],
];

for (const size of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
]) {
  test.describe(`${size.width}×${size.height}`, () => {
    test.use({ viewport: size });
    test('key visuals fit without scrolling', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop', 'desktop layouts only');
      await seed(page, 'couple');
      for (const [route, target] of SCREENS) {
        await page.goto(route);
        await dismissPrompt(page);
        const el = page.locator(`[data-tour="${target}"]`).first();
        await expect(el).toBeVisible();
        // Let lazy charts and Monte Carlo progress settle their size.
        await page.waitForTimeout(400);
        const bottom = await el.evaluate((n) => n.getBoundingClientRect().bottom);
        expect(bottom, `${route} ${target}`).toBeLessThanOrEqual(size.height);
      }
    });
  });
}
