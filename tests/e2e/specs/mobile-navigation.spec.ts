import { expect, test } from '@playwright/test';
import { go, seed } from './helpers';

test.beforeEach(async ({ page, isMobile }, info) => {
  test.skip(!isMobile && info.project.name !== 'phone');
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await seed(page);
});

test('ending-year and start-year choices update the visible result and historical balances', async ({
  page,
}) => {
  await go(page, '/explore/history');
  const picker = page.locator('[data-tour="history-map"]');
  const end = picker.getByRole('combobox', { name: 'Full run ending in' });
  const result = picker.getByRole('status');
  const chart = page.locator('[data-tour="history-chart"]');
  const map = picker.getByRole('region', { name: 'Year-by-year investment heat map' });
  const tiles = map.getByRole('button');
  await end.selectOption({ label: '2014 (started 1966)' });
  await expect(tiles).toHaveCount(49);
  await expect(tiles.first()).toHaveText('1966');
  await expect(tiles.last()).toHaveText('2014');
  await chart.getByRole('button', { name: 'Show as table' }).tap();
  const last = chart.locator('tbody tr').last();
  await expect(last.getByRole('rowheader')).toHaveText('2014');
  const balance2014 = await last.locator('td').last().innerText();
  await expect(result).toContainText(balance2014);
  const detail = map.locator('.hx-heat-detail');
  await expect(detail).toContainText(balance2014);
  const sharedYear = map.getByRole('button', { name: /^2000,/ });
  const oldBalance = await sharedYear.getAttribute('aria-label');
  const overlapColors = () =>
    tiles.evaluateAll((buttons) =>
      buttons
        .filter((button) => Number(button.textContent) >= 1972 && Number(button.textContent) <= 2014)
        .map((button) => getComputedStyle(button).backgroundColor),
    );
  const oldColors = await overlapColors();
  await end.selectOption({ label: '2020 (started 1972)' });
  await expect(tiles.first()).toHaveText('1972');
  await expect(tiles.last()).toHaveText('2020');
  await expect(map.getByRole('button', { name: /^1966,/ })).toHaveCount(0);
  await expect(sharedYear).not.toHaveAttribute('aria-label', oldBalance!);
  expect(await overlapColors()).not.toEqual(oldColors);
  await expect(last.getByRole('rowheader')).toHaveText('2020');
  await expect(last.locator('td').last()).not.toHaveText(balance2014);
  await expect(result).toContainText('1972–2020');
  await expect(result).toContainText(await last.locator('td').last().innerText());
  await sharedYear.tap();
  const sharedRow = chart.getByRole('row', { name: /^2000 / });
  await expect(detail).toContainText(await sharedRow.locator('td').last().innerText());
  await expect(detail).toContainText(await sharedRow.locator('td').first().innerText());
  await picker.getByText('Choose by start year', { exact: true }).tap();
  await picker.getByRole('combobox', { name: 'Historical start year' }).selectOption('2020');
  await expect(result).toContainText('2020–2025');
  await expect(result).toContainText('6 of 49 years');
  await expect(end).toHaveValue('');
  await expect(chart.locator('tbody tr')).toHaveCount(6);
  await expect(tiles).toHaveCount(6);
  await expect(tiles.first()).toHaveText('2020');
  await expect(tiles.last()).toHaveText('2025');
  await expect(detail).toContainText('2025');
});

test('historical mode shows the market rates and reveals additional inputs on request', async ({ page }) => {
  await go(page, '/plan/assumptions');
  const rates = page.locator('[data-tour="returns"]');
  const mode = rates.getByRole('combobox', { name: 'Expected returns' });
  await mode.selectOption('historicalAverage');
  await expect(rates.locator('input[type="range"]:visible')).toHaveCount(0);
  await expect(rates.getByText('9.36%', { exact: true })).toBeVisible();
  const override = rates.getByRole('switch', { name: 'Use my own inflation rate' });
  const inflation = rates.getByRole('textbox', { name: 'Annual inflation' });
  const historicalInflation = rates.getByText('Historical inflation', { exact: true }).locator('+ dd');
  const originalRate = await historicalInflation.innerText();
  await override.check();
  await inflation.fill('4.25');
  await inflation.blur();
  await expect(rates).toContainText('inflation 4.25%');
  await expect(page.locator('.save-status')).toHaveText('Saved on device');
  await page.reload();
  await expect(override).toBeChecked();
  await expect(inflation).toHaveValue('4.25');
  await expect(mode).toHaveValue('historicalAverage');
  await override.uncheck();
  await expect(historicalInflation).toHaveText(originalRate);
  await expect(inflation).toHaveCount(0);
  await rates.getByText('Edit additional assumptions', { exact: true }).tap();
  await rates.getByRole('textbox', { name: 'International stocks return' }).fill('5.25');
  await expect(rates.getByText('9.36%', { exact: true })).toBeVisible();
  await expect(mode).toHaveValue('historicalAverage');
  await mode.selectOption('fixed');
  await expect(rates.getByRole('textbox', { name: 'International stocks return' })).toHaveValue('5.25');
  await expect(rates.getByRole('textbox', { name: 'US stocks return' })).toBeVisible();
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
    // Release a stationary finger so the next tap exercises navigation after a drag.
    await page.waitForTimeout(250);
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

test('edit income, find HSA use and navigate results and More by their visible labels', async ({ page }) => {
  const main = page.getByRole('main');
  const tabs = page.getByRole('navigation', { name: 'Main (phone)' });
  await main.getByRole('link', { name: 'Edit plan', exact: true }).tap();
  const directory = main.getByRole('navigation', { name: 'Plan inputs' });
  await expect(directory.getByRole('link', { name: /^Savings and contributions/ })).toBeVisible();
  await directory.getByRole('link', { name: /^Income/ }).tap();
  await main
    .getByRole('button', { name: /^Edit / })
    .first()
    .tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).tap();
  await main.getByRole('link', { name: 'All plan inputs' }).tap();
  await directory.getByRole('link', { name: /^Saving and withdrawal strategy/ }).tap();
  await expect(page).toHaveURL(/\/plan\/strategy$/);
  await expect(main.getByRole('button', { name: 'Pay medical bills', exact: true })).toBeVisible();
  await tabs.getByRole('link', { name: 'Results' }).tap();
  await main.getByLabel('Results pages').selectOption('/explore/taxes');
  await expect(main.getByRole('heading', { name: 'Taxes', exact: true })).toBeVisible();
  const more = tabs.getByRole('button', { name: 'More' });
  await more.tap();
  await page.goBack();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.tap();
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'Reports' })
    .tap();
  await expect(page).toHaveURL(/\/reports$/);
  await more.tap();
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('link', { name: 'App settings' })
    .tap();
  await expect(main.getByRole('heading', { name: 'App settings', exact: true })).toBeVisible();
});

test('Home chart values remain accessible in the full data table', async ({ page }) => {
  const card = page.locator('[data-tour="home-chart"]');
  const detail = card.locator('[data-tour="home-year"]');
  for (const name of ['Net worth', 'Accounts', 'Cash flow', 'Spending', 'Taxes']) {
    await card.getByRole('button', { name, exact: true }).tap();
    const plot = card.getByRole('img');
    await expect(plot.locator('canvas')).toBeVisible();
    await plot.focus();
    await page.keyboard.press('End');
    const year = (await detail.locator('strong').first().innerText()).trim();
    const ages = await detail.locator('.home-year-when span').innerText();
    const values = await detail.locator('.lv-stat-value').allTextContents();
    await card.getByRole('button', { name: 'Show as table' }).tap();
    const row = card.getByRole('rowheader', { name: `${year} · ${ages}`, exact: true }).locator('..');
    await expect(row).toHaveCount(1);
    const cells = await row.getByRole('cell').allTextContents();
    expect(cells.length).toBeGreaterThan(0);
    expect(cells).toEqual(values.slice(0, cells.length));
    await card.getByRole('button', { name: 'Show chart' }).tap();
  }
});
