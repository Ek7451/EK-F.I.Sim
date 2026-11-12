import { expect, test } from '@playwright/test';
import { go, seed } from './helpers';

test('reports cannot export a stopped simulation and can run it again', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await seed(page);
  await go(page, '/reports');
  await page
    .getByRole('switch', { name: 'Include the chance of success (runs the simulation first)' })
    .check();
  await page.getByRole('button', { name: 'Stop simulation', exact: true }).click();
  await expect(page.getByText('Simulation stopped with', { exact: false })).toBeVisible();
  await expect(page.locator('[data-tour="download-pdf"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect(page.locator('[data-tour="download-pdf"]')).toBeEnabled({ timeout: 60000 });
});

test('worker failure keeps the last result labeled and Retry starts a fresh worker', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.addInitScript(() => {
    const Native = window.Worker;
    const state = window as typeof window & { failNextProjection?: boolean };
    window.Worker = class extends Native {
      override postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const request = message as { type?: string; path?: string[] };
        if (state.failNextProjection && request.type === 'APPLY' && request.path?.[0] === 'project') {
          state.failNextProjection = false;
          queueMicrotask(() =>
            this.dispatchEvent(new ErrorEvent('error', { message: 'Injected worker failure' })),
          );
          return;
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page);
  await go(page, '/explore/projection');
  const stats = page.locator('[data-tour="projection-stats"]');
  await expect(stats).toContainText('$');
  const before = await stats.textContent();
  await page.getByRole('button', { name: 'Edit plan', exact: true }).click();
  await page.evaluate(() => {
    (window as typeof window & { failNextProjection?: boolean }).failNextProjection = true;
  });
  await page.getByLabel('Exact age').fill('51');
  await expect(page.getByText('The calculation worker stopped.', { exact: false }).first()).toBeVisible();
  await expect(stats).toHaveText(before!);
  await expect(page.getByRole('button', { name: 'Apply to plan' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry calculation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply to plan' })).toBeEnabled();
  await expect(stats).not.toHaveText(before!);
});

test('timeline creation previews, discards and applies as one change', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await seed(page);
  await go(page, '/plan/timeline');
  const rows = page.locator('[data-tour="milestone-row"]');
  const count = await rows.count();
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await page.getByLabel('Name', { exact: true }).fill('New decision');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(rows).toHaveCount(count + 1);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(rows).toHaveCount(count);
  await page.getByRole('button', { name: 'Add milestone' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to plan' }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rows).toHaveCount(count);
});
