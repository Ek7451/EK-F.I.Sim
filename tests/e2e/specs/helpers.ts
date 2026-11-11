import { expect, type Page } from '@playwright/test';

export const SAMPLES = {
  basic: 'Single, mid-career',
  early: 'Couple retiring at 50',
  couple: 'Couple near retirement',
} as const;

export const ROUTES = [
  '/',
  '/plan/household',
  '/plan/snapshot',
  '/plan/income',
  '/plan/spending',
  '/plan/timeline',
  '/plan/strategy',
  '/plan/healthcare',
  '/plan/assumptions',
  '/explore/projection',
  '/explore/cashflow',
  '/explore/taxes',
  '/explore/success',
  '/explore/history',
  '/explore/estate',
  '/compare',
  '/track',
  '/reports',
  '/help/tours',
  '/help/methods',
  '/settings',
];

/** Fresh browser profile -> a plan copied from a bundled sample, landing on Home. */
export async function seed(page: Page, sample: keyof typeof SAMPLES = 'early'): Promise<void> {
  await page.goto('/start');
  await page.getByRole('button', { name: SAMPLES[sample] }).click();
  await expect(page.locator('[data-tour="home-stats"]')).toBeVisible();
  await dismissPrompt(page);
}

/** Client-side navigation keeps the in-memory state and is how a user moves around. */
export async function go(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page.locator('main h1')).toBeVisible();
}

export async function dismissPrompt(page: Page): Promise<void> {
  const prompt = page.getByTestId('tour-prompt');
  if (await prompt.isVisible().catch(() => false))
    await prompt.getByRole('button', { name: 'Not now' }).click();
}

/** Collect console errors and uncaught exceptions for the life of the page. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
