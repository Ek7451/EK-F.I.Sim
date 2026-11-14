import { expect, test } from '@playwright/test';
import { dismissPrompt, go, seed, watchErrors } from './helpers';

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  await go(page, '/explore/projection');
  await dismissPrompt(page);
});

test('retirement draft: discard, scenario, one-step undo, reload', async ({ page }) => {
  const errors = watchErrors(page);
  const stats = page.locator('[data-tour="projection-stats"]');
  await expect(stats).toContainText('$');
  const before = (await stats.textContent())!;
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  const age = page.getByLabel('Exact age');
  await expect(age).toHaveValue('50');
  await age.fill('51');
  const draft = page.getByRole('region', { name: 'Draft changes' });
  await expect(draft).toContainText('age 50 → age 51');
  await expect(draft).toContainText('Ending wealth +');
  await expect(stats).not.toHaveText(before);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(age).toHaveValue('50');
  await expect(stats).toHaveText(before);
  await age.fill('51');
  await page.getByLabel('Scenario name').fill('Retire at 51');
  await page.getByRole('button', { name: 'Save as scenario', exact: true }).click();
  await expect(age).toHaveValue('50');
  await expect(stats).toHaveText(before);
  await age.fill('51');
  await page.getByRole('button', { name: 'Apply to plan', exact: true }).click();
  await expect(draft).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(age).toHaveValue('50');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(age).toHaveValue('51');
  await expect(page.locator('.save-status')).toHaveText('Saved on device');
  await page.reload();
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await expect(page.getByLabel('Exact age')).toHaveValue('51');
  await go(page, '/compare');
  await expect(page.getByLabel('Second')).toContainText('Retire at 51');
  expect(errors).toEqual([]);
});

test('year stays pinned across analyses and invalid draft input stays local', async ({ page }) => {
  const year = page.getByRole('slider', { name: 'Year', exact: true });
  await year.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const selected = await year.inputValue();
  await page
    .getByRole('img', { name: 'Net worth by account type over time' })
    .hover({ position: { x: 200, y: 150 } });
  await expect(year).toHaveValue(selected);
  for (const route of ['/explore/cashflow', '/explore/taxes', '/explore/estate']) {
    await go(page, route);
    await expect(page.getByRole('slider', { name: 'Year', exact: true })).toHaveValue(selected);
  }
  await go(page, '/explore/projection');
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  const age = page.getByLabel('Exact age');
  await age.fill('');
  await expect(age).toHaveValue('');
  await expect(age).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('region', { name: 'Draft changes' })).toHaveCount(0);
  await age.fill('51');
  await expect(age).toHaveAttribute('aria-invalid', 'false');
});

test('drag cancellation restores the pre-gesture draft; keyboard move can be undone', async ({ page }) => {
  const event = page.locator('.event-marker').filter({ hasText: 'Retire' }).first();
  await event.scrollIntoViewIfNeeded();
  // Plain text, as toHaveText compares it (rendered text would add line breaks from the pin's layout).
  const before = (await event.textContent())!;
  const box = (await event.boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 8, { steps: 5 });
  await expect(page.getByRole('region', { name: 'Draft changes' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(event).toHaveText(before);
  await expect(page.getByRole('region', { name: 'Draft changes' })).toHaveCount(0);
  await event.focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Apply to plan', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(event).toHaveText(before);
});

test('phone editor preserves unsaved work and returns focus when closed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const edit = page.getByRole('button', { name: 'Edit plan', exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: 'Plan details' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Exact age').fill('51');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(edit).toBeFocused();
  await expect(page.getByRole('region', { name: 'Draft changes' })).toContainText('Unsaved draft');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await edit.click();
  await expect(dialog.getByLabel('Exact age')).toHaveValue('50');
});
