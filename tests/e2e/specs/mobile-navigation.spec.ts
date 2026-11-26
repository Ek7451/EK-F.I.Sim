import { expect, test } from '@playwright/test';
import { seed } from './helpers';

test.beforeEach(async ({ page, isMobile }, info) => {
  test.skip(!isMobile && info.project.name !== 'phone');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await seed(page);
});

test('touch details stay inside the Home chart and the bottom navigation accepts the next tap', async ({
  page,
  browserName,
}) => {
  await page.locator('[data-tour="home-views"]').getByText('Cash flow', { exact: true }).tap();
  const chart = page.locator('[data-tour="home-chart"] canvas');
  await expect(chart).toBeVisible();
  const detail = page.locator('[data-tour="home-year"]');
  const initial = await detail.getAttribute('aria-label');
  await chart.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - innerHeight + 160));
  const nav = page.getByRole('navigation', { name: 'Main (phone)' });
  const box = (await chart.boundingBox())!;
  const tabs = (await nav.boundingBox())!;
  const x = Math.round(box.x + box.width * 0.68);
  const y = Math.round(tabs.y - 12);
  await page.touchscreen.tap(x, y);
  await expect(detail).not.toHaveAttribute('aria-label', initial!);
  await expect(detail.getByText('Withdrawals', { exact: true })).toBeVisible();
  const pinned = await detail.getAttribute('aria-label');
  await expect(page.locator('.home-chart-tooltip:visible')).toHaveCount(0);
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const start = await page.evaluate(() => scrollY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const dy of [10, 25, 45, 70, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - dy }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(start);
    await expect(detail).toHaveAttribute('aria-label', pinned!);
    // Chromium consumes a tap during kinetic scrolling to stop the fling.
    await page.evaluate(async () => {
      let last = scrollY;
      let still = 0;
      while (still < 5) {
        await new Promise(requestAnimationFrame);
        still = scrollY === last ? still + 1 : 0;
        last = scrollY;
      }
    });
  }
  await nav.getByRole('link', { name: 'Compare' }).tap();
  await expect(page).toHaveURL(/\/compare$/);
});
