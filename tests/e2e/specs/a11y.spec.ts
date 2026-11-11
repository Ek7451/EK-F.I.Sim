/** Automated accessibility checks (UX-07): axe WCAG 2.2 A/AA rules on every screen, in light and dark themes. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { go, ROUTES, seed } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function check(page: Page, label: string): Promise<void> {
  // Let charts and background results settle so the scan sees the finished screen.
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join('\n  ')}`,
  );
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`no axe violations on any screen (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: theme });
    await seed(page);
    for (const route of ROUTES) {
      await go(page, route);
      await check(page, `${route} [${theme}]`);
    }
  });
}

test('no axe violations in the wizard, a dialog and a running tour', async ({ page }) => {
  await page.goto('/start');
  await check(page, 'wizard');
  await seed(page);
  await go(page, '/plan/snapshot');
  await page.locator('[data-tour="add-account"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await check(page, 'account dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await go(page, '/help/tours');
  await page
    .locator('[data-tour-id="T-B02"]')
    .getByRole('button', { name: /^Start the tour/ })
    .click();
  await expect(page.getByTestId('tour-card')).toBeVisible();
  await check(page, 'tour step');
});

test('keyboard: skip link, focus is visible, dialogs trap and return focus', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard checks run on the desktop layout');
  await seed(page);
  await page.waitForTimeout(400);
  await page.goto('/');
  await expect(page.locator('main h1')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await go(page, '/plan/snapshot');
  const add = page.locator('[data-tour="add-account"]');
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Focus moves into the dialog when it opens, stays inside while tabbing, and returns to the trigger on close.
  await expect
    .poll(async () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
    .toBe(true);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
});
