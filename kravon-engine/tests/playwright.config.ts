import { defineConfig, devices } from '@playwright/test';

/**
 * Base URLs are read from environment variables so the suite runs against
 * any environment (local dev, staging, production) without code changes.
 *
 *   KRAVON_FRONTEND_URL  — where the static frontend is served  (default: http://localhost:8000)
 *   KRAVON_API_URL       — where the Express backend is served   (default: http://localhost:3000)
 *   KRAVON_SLUG          — restaurant slug under test            (default: demo)
 *   KRAVON_STAFF_EMAIL   — dashboard login email
 *   KRAVON_STAFF_PASSWORD— dashboard login password
 */
export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  retries: 1,

  // Run sequentially to avoid rate-limiting on the auth endpoint.
  fullyParallel: false,
  workers: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    // Custom reporter that produces the final deliverable report.
    ['./reporter/kravon-reporter.ts'],
  ],

  use: {
    baseURL:           process.env.KRAVON_FRONTEND_URL || 'http://localhost:8000',
    headless:          true,
    viewport:          { width: 390, height: 844 },   // iPhone 14 Pro — matches QR-scan reality
    ignoreHTTPSErrors: true,
    screenshot:        'only-on-failure',
    video:             'retain-on-failure',
    trace:             'retain-on-failure',
  },

  projects: [
    {
      name: 'customer-mobile',
      use: {
        // Use Chromium with a mobile viewport — avoids needing WebKit installed.
        browserName: 'chromium',
        viewport:    { width: 390, height: 844 },
        userAgent:   devices['iPhone 14'].userAgent,
        isMobile:    true,
        hasTouch:    true,
      },
      testMatch: ['**/scenarios/**/*.spec.ts', '**/performance/**/*.spec.ts'],
    },
    {
      name: 'staff-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
      testMatch: ['**/scenarios/**/*.spec.ts'],
    },
  ],
});
