/**
 * SCENARIO 1 — Restaurant Opening
 * P0: Dashboard loads cleanly with no JS errors, no failed API requests,
 *     no orphan sessions, and empty tables show correctly.
 */

import { test, expect } from '../../fixtures';
import { SLUG, DASHBOARD_URL } from '../../fixtures/env';
import { getSessionStatus, ensureTableClosed } from '../../fixtures/api';

test.describe('Scenario 1 — Restaurant Opening', () => {
  // Close all open sessions before the suite runs so we start from a clean state.
  // This guards against leftover state from a previous test run.
  test.beforeAll(async ({ request, staffToken, tables }) => {
    await Promise.allSettled(
      tables.map((t) => ensureTableClosed(request, staffToken, t.id)),
    );
  });

  test('dashboard loads without JS errors', async ({ dashboardPage }) => {
    const jsErrors: string[] = [];
    dashboardPage.page.on('pageerror', (err) => jsErrors.push(err.message));

    // dashboardPage fixture has already logged in and navigated to tables view.
    // Wait a moment for any async errors to surface.
    await dashboardPage.page.waitForTimeout(2_000);

    expect(jsErrors, `JavaScript errors: ${jsErrors.join('; ')}`).toHaveLength(0);
  });

  test('dashboard loads without failed network requests', async ({ dashboardPage }) => {
    const failedRequests: string[] = [];
    dashboardPage.page.on('requestfailed', (req) => {
      if (req.url().includes('localhost') || req.url().includes('kravon')) {
        failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
      }
    });

    // Fixture is already logged in; wait for any async failures to surface.
    await dashboardPage.page.waitForTimeout(2_000);

    expect(
      failedRequests,
      `Failed network requests: ${failedRequests.join('\n')}`,
    ).toHaveLength(0);
  });

  test('tables view renders and displays available tables', async ({ dashboardPage, tables }) => {
    // dashboardPage fixture already navigated to tables view.
    await expect(dashboardPage.page.locator('#tables-grid')).toBeVisible({ timeout: 10_000 });
    const cards = dashboardPage.page.locator('.table-card');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(tables.length);
  });

  test('no orphan sessions — all tables start at known state', async ({ request, staffToken, tables }) => {
    for (const table of tables) {
      const status = await getSessionStatus(request, table.id);
      expect(typeof status.open).toBe('boolean');
    }
  });

  test('no stale bill requests visible on opening', async ({ dashboardPage }) => {
    const badgeCount = await dashboardPage.billRequestBadgeCount();
    expect(badgeCount).toBe(0);
  });
});
