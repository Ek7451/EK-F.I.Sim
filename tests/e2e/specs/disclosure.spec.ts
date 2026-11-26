import { expect, test } from '@playwright/test';
import { go, seed } from './helpers';

test('setup offers reachable destinations and skips questions without pay', async ({ page }) => {
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/start$/);
  await expect(page.getByRole('link', { name: 'Results', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Plan:|Discard wizard draft/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Single, mid-career' })).toBeHidden();
  await page.getByRole('link', { name: 'Import a backup' }).click();
  await expect(page.getByLabel('Backup file')).toBeVisible();
  await expect(page.getByText('Export all plans', { exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Start a plan', exact: true }).click();
  await page.getByLabel('State you live in').selectOption('TX');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const pay = page.getByLabel('Yearly pay before tax');
  await pay.fill('0');
  await pay.blur();
  await expect(page.getByLabel('Contribution (share of pay)')).toBeHidden();
  await expect(page.getByText('Use an example plan')).toBeHidden();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('HSA added per year')).toBeHidden();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit retirement' })).toBeHidden();
  await page.getByRole('button', { name: 'Edit annual pay' }).click();
  await pay.fill('60000');
  await pay.blur();
  await expect(page.getByLabel('Contribution (share of pay)')).toBeVisible();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByLabel('Age you would like to retire')).toBeVisible();
});

test('year details, plan actions and explanations open only when requested', async ({ page }) => {
  await seed(page, 'basic');
  await go(page, '/explore/projection');
  const details = page.getByRole('button', { name: 'Show details', exact: true });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(page.getByRole('slider', { name: 'Year', exact: true })).toBeVisible();
  const close = page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByLabel('Results pages').selectOption('/explore/cashflow');
  await page.getByLabel('Results pages').selectOption('/explore/projection');
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  const about = page.getByRole('button', { name: 'About Projection' });
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await about.tap();
  else await about.hover();
  await expect(page.getByRole('tooltip')).toContainText('expected returns');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await go(page, '/settings');
  const actions = page.getByRole('button', { name: /^Actions for/ });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Rename plan' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await go(page, '/reports');
  await expect(page.getByLabel('Version of the plan')).toBeHidden();
});

test.describe('public cloud presentation', () => {
  test.use({ serviceWorkers: 'block' });

  test('account forms and management actions follow the selected task', async ({
    page,
    context,
    baseURL,
  }) => {
    // Exercise the hostname-gated UI against the local build with two synthetic session states.
    const origin = 'https://longviewplanner.pages.dev';
    let signedIn = false;
    await context.route(origin + '/**', async (route) => {
      const { pathname, search } = new URL(route.request().url());
      if (pathname === '/api/auth/get-session')
        return route.fulfill({
          json: signedIn ? { user: { id: 'fixture', username: 'test_planner' } } : null,
        });
      if (pathname.startsWith('/api/')) return route.fulfill({ json: [] });
      const response = await route.fetch({ url: new URL(pathname + search, baseURL).href });
      return route.fulfill({ response });
    });
    await page.goto(origin + '/start');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Confirm password')).toBeHidden();
    await dialog.getByRole('button', { name: 'Create an account' }).click();
    await expect(dialog.getByLabel('Confirm password')).toBeVisible();
    await expect(dialog.getByLabel('Recovery code')).toBeHidden();
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await dialog.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(dialog.getByLabel('Recovery code')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    signedIn = true;
    await page.goto(origin + '/settings#cloud-account');
    await expect(page.getByText('test_planner', { exact: true }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete account' })).toBeHidden();
    await page.getByText('Manage account', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete account', exact: true }).click();
    await expect(page.getByLabel('Confirm username')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Permanently delete account' })).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByLabel('Confirm username')).toBeHidden();
  });
});
