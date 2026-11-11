import { defineConfig, devices } from '@playwright/test';

/** End-to-end, tour and accessibility tests run against the production build (`pnpm build` first). */
export default defineConfig({
  testDir: './specs',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'pnpm --filter @fisim/web preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    {
      name: 'tablet',
      use: { browserName: 'chromium', viewport: { width: 820, height: 1180 }, hasTouch: true },
      testIgnore: /tours\.spec/,
    },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 820 } } },
  ],
});
