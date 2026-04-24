import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level smoke tests that complement the pure-logic vitest suite.
 * vitest validates the math; Playwright validates that the HTML actually
 * boots, the main tabs render, and the critical controls are clickable.
 *
 * Run locally with `npm run e2e`. CI skips this by default (it's heavier
 * than the vitest suite) — opt in with `CI_E2E=1`.
 */
export default defineConfig({
  testDir: './src/e2e',
  timeout: 15_000,
  retries: 0,
  reporter: [['list']],
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5500',
    viewport: { width: 1600, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The app uses Web Audio; allow it to auto-play for the test run.
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npx http-server public -p 5500 -c-1 --silent',
    url: 'http://127.0.0.1:5500/index.html',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
