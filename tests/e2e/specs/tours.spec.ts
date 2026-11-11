/**
 * Tour tests (plan 10.2 and release gate 16): every tour runs start to finish with the keyboard alone, every
 * `data-tour` target exists on the screen its step names, focus lands on the step card, and progress is saved.
 */
import { expect, test } from '@playwright/test';
import { TOURS } from '../../../apps/web/src/tours/catalog';
import { seed } from './helpers';

test.describe.configure({ mode: 'parallel' });

test('the catalog lists all 25 tours', async ({ page }) => {
  expect(TOURS).toHaveLength(25);
  expect(TOURS.filter((t) => t.level === 'basic').map((t) => t.id)).toEqual([
    'T-B01',
    'T-B02',
    'T-B03',
    'T-B04',
    'T-B05',
    'T-B06',
    'T-B07',
    'T-B08',
  ]);
  expect(TOURS.filter((t) => t.level === 'advanced')).toHaveLength(17);
  await seed(page, 'basic');
  await page.goto('/help/tours');
  await expect(page.locator('[data-tour="tour-tile"]')).toHaveCount(25);
  await expect(page.getByText('0 of 25 tours completed')).toBeVisible();
});

for (const tour of TOURS) {
  test(`${tour.id} ${tour.title}: completes with the keyboard`, async ({ page }) => {
    await seed(page, 'basic');
    await page.goto('/help/tours');
    const tile = page.locator(`[data-tour-id="${tour.id}"]`);
    await tile.getByRole('button', { name: /^Start the tour/ }).focus();
    await page.keyboard.press('Enter');

    const card = page.getByTestId('tour-card');
    for (let i = 0; i < tour.steps.length; i++) {
      const step = tour.steps[i];
      await expect(page.getByTestId('tour-progress')).toContainText(`step ${i + 1} of ${tour.steps.length}`);
      await expect(card.getByRole('heading')).toHaveText(step.title);
      await expect(page).toHaveURL(new RegExp(`${step.route.replace(/\//g, '\\/')}$`));
      await expect(page.locator('[data-tour="sandbox-banner"]')).toBeVisible();
      const target = step.target;
      if (target) {
        // The target must exist and be visible on this screen size.
        await expect
          .poll(
            async () =>
              page.evaluate(
                (names) =>
                  names.some((n) =>
                    [...document.querySelectorAll(`[data-tour="${n}"]`)].some((el) => {
                      const r = el.getBoundingClientRect();
                      return r.width > 0 && r.height > 0;
                    }),
                  ),
                target.split('|'),
              ),
            { message: `${tour.id} step ${i + 1}: target "${target}" on ${step.route}` },
          )
          .toBe(true);
      }
      // No placeholder is left unfilled once results arrive.
      await expect(card.locator('#tour-body')).not.toContainText(/[{}]/);
      // Focus is on the step card, so the keyboard can drive the tour.
      await expect
        .poll(async () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="tour-card"]')))
        .toBe(true);
      await page.keyboard.press('ArrowRight');
    }

    await expect(card).toBeHidden();
    await expect(page).toHaveURL(/\/help\/tours$/);
    await expect(page.locator('[data-tour="sandbox-banner"]')).toBeHidden();
    await expect(tile.getByText('Completed')).toBeVisible();
  });
}

test("a tour never changes the user's plan, saves its place, and Esc leaves it", async ({ page }) => {
  await seed(page, 'early');
  const name = await page.locator('#plan-switch option:checked').textContent();
  await page.goto('/help/tours');
  await page
    .locator('[data-tour-id="T-B05"]')
    .getByRole('button', { name: /^Start the tour/ })
    .click();
  const card = page.getByTestId('tour-card');
  await card.getByTestId('tour-next').click();
  await card.getByTestId('tour-next').click();
  await card.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-progress')).toContainText('step 4 of');
  // The sandbox shows the sample, not the user's plan.
  await expect(page.locator('#plan-switch')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page).toHaveURL(/\/help\/tours$/);
  await expect(page.locator('#plan-switch option:checked')).toHaveText(name ?? '');
  // Progress is kept and the tour resumes where it stopped.
  const tile = page.locator('[data-tour-id="T-B05"]');
  await expect(tile.getByText('Step 4 of')).toBeVisible();
  await tile.getByRole('button', { name: /^Resume the tour/ }).click();
  await expect(page.getByTestId('tour-progress')).toContainText('step 4 of');
});

test('observe-only mode shows my own plan with changes switched off', async ({ page }) => {
  await seed(page, 'early');
  await page.goto('/help/tours');
  await page
    .locator('[data-tour-id="T-B05"]')
    .getByRole('button', { name: /^On my plan/ })
    .click();
  await expect(page.locator('[data-tour="sandbox-banner"]')).toContainText('changes are switched off');
  await expect(page.locator('#plan-switch option:checked')).toHaveText(/retiring at 50/);
});

test('the wizard offers the welcome tour', async ({ page }) => {
  await page.goto('/start');
  await page.getByLabel('Your first name').fill('Sam');
  for (let i = 0; i < 5; i++) await page.locator('[data-tour="wizard-next"]').click();
  await page.locator('[data-tour="wizard-take-tour"]').click();
  await expect(page.getByTestId('tour-progress')).toContainText('Welcome and getting around · step 1 of');
});
