/** Core flows (release gate 16): create, edit, reload, offline, export, import, undo, simulate, report. */
import { expect, test } from '@playwright/test';
import { go, ROUTES, seed, watchErrors } from './helpers';

test('first visit opens the wizard, which builds a working plan', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/start$/);
  await page.getByLabel('Your first name').fill('Riley');
  await page.locator('[data-tour="wizard-next"]').click();
  await page.getByLabel('Yearly pay before tax').fill('95000');
  for (let i = 0; i < 4; i++) await page.locator('[data-tour="wizard-next"]').click();
  await page.locator('[data-tour="wizard-skip-tour"]').click();
  await expect(page.locator('[data-tour="home-stats"]')).toBeVisible();
  await expect(page.locator('[data-tour="home-stats"]')).toContainText('$');
  await expect(page.locator('[data-tour="home-covered"]')).toContainText(/Every year|Short in/);
  expect(errors).toEqual([]);
});

test('the wizard asks each partner about pay, saving, lifespan and retirement, and shows its assumptions', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('/start');
  await page.getByLabel('Your first name').fill('Riley');
  await page.getByRole('switch', { name: 'Plan with a partner' }).check();
  await page.getByLabel("Partner's first name").fill('Jo');
  const partner = page.getByRole('group', { name: 'Your partner' });
  await expect(partner.getByLabel('Plan until age')).toHaveValue('95');
  await expect(partner.getByText(/Chance of reaching 95/)).toBeVisible();
  await page.locator('[data-tour="wizard-next"]').click();

  // Step 2: a block per earner, with the employer match shown and the result spelled out.
  const jo = page.getByRole('group', { name: 'Jo' });
  await jo.getByLabel('Yearly pay before tax').fill('70000');
  await jo.getByLabel('Contribution (share of pay)').fill('10');
  await expect(jo.getByText(/\$7,000.*a year from Jo plus \$2,100 from the employer/)).toBeVisible();
  // Above the IRS limit, the readout says so.
  await jo.getByLabel('Contribution (share of pay)').fill('50');
  await expect(jo.getByText(/over the \d{4} limit/)).toBeVisible();
  await jo.getByLabel('Contribution (share of pay)').fill('10');

  for (let i = 0; i < 3; i++) await page.locator('[data-tour="wizard-next"]').click();
  await expect(
    page.getByRole('group', { name: 'Jo' }).getByLabel('Age you would like to retire'),
  ).toBeVisible();
  await page.locator('[data-tour="wizard-next"]').click();

  const review = page.locator('[data-tour="wizard-review"]');
  for (const item of ['Lifespan', 'Investment returns', 'Social Security', 'Healthcare', 'Taxes'])
    await expect(review.getByText(item, { exact: true })).toBeVisible();
  await expect(review).toContainText('Married filing jointly');
  await page.locator('[data-tour="wizard-skip-tour"]').click();
  await expect(page.locator('[data-tour="home-stats"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('fields explain themselves from an (i) beside the label', async ({ page }) => {
  await page.goto('/start');
  const field = page.getByRole('group', { name: 'You' });
  const help = field
    .locator('.lv-label-row')
    .filter({ hasText: 'Plan until age' })
    .getByRole('button', { name: 'Help' });
  // Keyboard focus opens it (and so does hover with a mouse, or a tap on a phone).
  await help.focus();
  await expect(page.getByRole('tooltip')).toContainText('The age to plan for');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  // Plan editors pick up their help from the shared copy without per-screen wiring.
  await seed(page);
  await go(page, '/plan/assumptions');
  await expect(
    page
      .locator('.lv-label-row')
      .filter({ hasText: 'Inflation' })
      .first()
      .getByRole('button', { name: 'Help' }),
  ).toBeVisible();
});

test('every screen renders without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await seed(page);
  for (const route of ROUTES) {
    await go(page, route);
    await expect(page.locator('main h1'), route).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' }), route).toHaveCount(0);
    // No sideways scrolling at any size (UX-08).
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `${route} fits the viewport width`,
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('edits are saved as you type, survive a reload, and can be undone', async ({ page }) => {
  await seed(page);
  await go(page, '/plan/assumptions');
  const name = page.getByLabel('Plan name');
  await name.fill('Renamed plan');
  await expect(page.locator('#plan-switch .lv-ellipsis')).toHaveText('Renamed plan');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByLabel('Plan name')).toHaveValue('Renamed plan');

  await page.getByLabel('Inflation', { exact: true }).fill('4');
  await page.getByLabel('Inflation', { exact: true }).blur();
  await page.locator('[data-tour="undo"]').click();
  await expect(page.getByLabel('Inflation', { exact: true })).not.toHaveValue('4');
  await page.locator('[data-tour="redo"]').click();
  await expect(page.getByLabel('Inflation', { exact: true })).toHaveValue('4');
});

test('a change to the plan changes the projection', async ({ page }) => {
  await seed(page);
  await go(page, '/explore/projection');
  const stats = page.locator('[data-tour="projection-stats"]');
  await expect(stats).toContainText('$');
  const before = await stats.textContent();
  await go(page, '/plan/assumptions');
  await page.getByLabel('US stocks return').fill('2');
  await go(page, '/explore/projection');
  await expect(stats).not.toHaveText(before ?? '');
});

test('the projection chart keeps drawing when the selected year changes', async ({ page }) => {
  await seed(page);
  await go(page, '/explore/projection');
  const chart = page.locator('[data-tour="net-worth-chart"]');
  // Count painted pixels on the chart canvas (0 when the canvas is gone or blank).
  const painted = (): Promise<number> =>
    chart.evaluate((root) => {
      const c = root.querySelector('canvas');
      if (!c || !c.width) return 0;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
      return n;
    });
  await expect.poll(painted, { timeout: 15_000 }).toBeGreaterThan(1000);
  const detail = page.locator('[data-tour="year-detail"]');
  const before = await detail.locator('h2, h3').first().textContent();
  const slider = page.getByRole('slider', { name: /Year/ });
  await slider.focus();
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');
  await expect(detail.locator('h2, h3').first()).not.toHaveText(before ?? '');
  // A re-render used to dispose the chart and leave an empty box.
  await page.waitForTimeout(600);
  expect(await painted()).toBeGreaterThan(1000);
});

test('chance of success runs, reports a percentage and is reproducible', async ({ page }) => {
  await seed(page);
  await go(page, '/explore/success');
  const rate = page.locator('[data-tour="success-rate"]');
  const finished = /(\d[\d,]*) of \1 runs/;
  await expect(rate).toContainText(finished, { timeout: 60_000 });
  const first = await rate.textContent();
  expect(first).toMatch(/\d+%/);
  await page.reload();
  await expect(rate).toContainText(finished, { timeout: 60_000 });
  expect(await rate.textContent()).toBe(first);
});

test('encrypted backup: export, delete, import brings the plan back', async ({ page }, info) => {
  await seed(page);
  await go(page, '/settings');
  const backup = page.locator('[data-tour="settings-backup"]');
  await backup.getByLabel('Backup passphrase').fill('correct horse battery');
  await backup.getByLabel('Passphrase again').fill('correct horse battery');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    backup.getByRole('button', { name: 'Download encrypted backup' }).click(),
  ]);
  const file = info.outputPath('backup.longview');
  await dl.saveAs(file);
  const text = (await import('node:fs')).readFileSync(file, 'utf8');
  expect(text).not.toContain('retiring at 50'); // nothing readable in the file

  await page.getByRole('button', { name: /^Delete My plan/ }).click();
  await page.getByRole('button', { name: 'Delete plan' }).click();
  await expect(page.getByText('No plans on this device yet.')).toBeVisible();

  await backup.getByLabel('Backup file').setInputFiles(file);
  await backup.getByLabel('Its passphrase').fill('wrong passphrase');
  await backup.getByRole('button', { name: 'Import' }).click();
  await expect(backup.getByRole('alert')).toContainText('does not open this file');
  await backup.getByLabel('Its passphrase').fill('correct horse battery');
  await backup.getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('[data-tour="settings-plans"]')).toContainText('retiring at 50');
});

test('reports: CSV and PDF are generated on the device', async ({ page }) => {
  await seed(page);
  await go(page, '/reports');
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-tour="download-csv"]').click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-tour="download-pdf"]').click(),
  ]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
  const fs = await import('node:fs');
  expect(
    fs
      .readFileSync((await pdf.path())!)
      .subarray(0, 5)
      .toString(),
  ).toBe('%PDF-');
  expect(fs.readFileSync((await csv.path())!, 'utf8').split('\n').length).toBeGreaterThan(20);
});

test('compare: a what-if variant shows a difference', async ({ page }) => {
  await seed(page);
  await go(page, '/compare');
  await page.locator('[data-tour="add-variant"]').click();
  await expect(page.locator('[data-tour="variant-list"]')).toBeVisible();
  await expect(page.locator('[data-tour="compare-table"]')).toContainText('$');
});

test('theme choice applies and persists', async ({ page }) => {
  await seed(page);
  await go(page, '/settings');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('works offline after the first visit', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'service worker check runs once');
  await seed(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Wait until the precache is filled and this page is controlled.
  await page.reload();
  await expect
    .poll(async () => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(async () => page.evaluate(async () => (await caches.keys()).length), { timeout: 30_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(4000);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('[data-tour="home-stats"]')).toContainText('$');
  await go(page, '/explore/projection');
  await expect(page.locator('[data-tour="projection-stats"]')).toContainText('$');
  await go(page, '/plan/assumptions');
  await page.getByLabel('Plan name').fill('Edited offline');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByLabel('Plan name')).toHaveValue('Edited offline');
});
