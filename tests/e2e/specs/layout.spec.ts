/** Protected data-plot area replaces the former card-fit-only policy. */
import { expect, test, type Locator } from '@playwright/test';
import { dismissPrompt, go, seed } from './helpers';

test('a two-finger pinch keeps the phone UI at its original scale', async ({ page, browserName }, info) => {
  test.skip(info.project.name !== 'phone' || browserName !== 'chromium');
  const touch = await page.context().newCDPSession(page);
  async function pinch() {
    const contacts = (distance: number) => [
      { x: 190 - distance, y: 270, id: 0 },
      { x: 190 + distance, y: 270, id: 1 },
    ];
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: contacts(22) });
    for (let distance = 25; distance <= 105; distance += 4) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: contacts(distance) });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const scale = () => page.evaluate(() => window.visualViewport!.scale);
  // First prove the browser actually zooms in response to this gesture.
  await page.setContent(
    '<meta name="viewport" content="width=device-width,initial-scale=1"><p>Zoom control</p>',
  );
  await pinch();
  await expect.poll(scale).toBeGreaterThan(1.5);
  await page.goto('/start');
  await expect(page.locator('main h1')).toBeVisible();
  await pinch();
  expect(await scale()).toBeCloseTo(1, 2);
});

async function expectInsideScreen(panel: Locator): Promise<void> {
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      panel.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const v = window.visualViewport!;
        return (
          rect.left >= v.offsetLeft - 1 &&
          rect.top >= v.offsetTop - 1 &&
          rect.right <= v.offsetLeft + v.width + 1 &&
          rect.bottom <= v.offsetTop + v.height + 1 &&
          el.scrollWidth <= el.clientWidth + 1
        );
      }),
    )
    .toBe(true);
}

test('phone controls and overlays fit narrow, short and landscape screens', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await seed(page);
  for (const size of [
    { width: 320, height: 568 },
    { width: 360, height: 300 },
    { width: 667, height: 375 },
  ]) {
    await page.setViewportSize(size);
    await go(page, '/explore/cashflow');
    const actions = page.locator('[data-tour="sankey"] > header > .lv-row');
    await actions.scrollIntoViewIfNeeded();
    await expectInsideScreen(actions);
    await go(page, '/explore/taxes');
    await page.locator('[data-tour="explain-button"]').first().tap();
    await expectInsideScreen(page.locator('.lv-popover'));
    await page.keyboard.press('Escape');
    await go(page, '/plan/household');
    await page.locator('.lv-help:visible').first().tap();
    await expectInsideScreen(page.locator('.lv-helptip'));
    await page.keyboard.press('Escape');
    await go(page, '/plan/snapshot');
    await page.locator('[data-tour="add-account"]').tap();
    const dialog = page.getByRole('dialog');
    await expectInsideScreen(dialog);
    await expect(dialog).toBeFocused();
    const fieldSizes = await dialog
      .locator('input:visible:not([type=range]):not([type=checkbox]), select:visible, textarea:visible')
      .evaluateAll((fields) => fields.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    expect(Math.min(...fieldSizes)).toBeGreaterThanOrEqual(16);
    await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
    await page.getByRole('button', { name: /^Plan: / }).tap();
    await expectInsideScreen(page.getByRole('menu'));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'More', exact: true }).tap();
    await expectInsideScreen(page.locator('.rail[data-open=true]'));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused();
  }
});

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
