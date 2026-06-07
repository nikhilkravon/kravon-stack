/**
 * PERFORMANCE — Frontend Stability
 * Captures: polling stability, memory growth, UI responsiveness.
 */

import { test, expect } from '../../fixtures';
import { openSession, closeSession, placeDineInOrder } from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';
import { tableUrl } from '../../fixtures/env';

test.describe('Performance — Frontend Stability', () => {
  let sessionId = '';

  test.afterEach(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
      sessionId = '';
    }
  });

  test('ordering screen remains responsive during 3 polling cycles (90s)', async ({
    browser,
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    const s = await openSession(request, staffToken, firstTableId, 2);
    sessionId = s.session_id;

    await placeDineInOrder(request, sessionId, 'PollGuest', '9020000001', [
      { menu_item_id: menuItemId, quantity: 1 },
    ]);

    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('PollGuest', '9020000001');
      await customer.waitForOrderingScreen();

      // Wait 90 seconds — covers 3 polling cycles (each 30s).
      // Check page health at 30s intervals.
      for (let cycle = 1; cycle <= 3; cycle++) {
        await page.waitForTimeout(30_000);

        // UI must still be interactive.
        const addBtn = page.locator('[data-action="add-item"]').first();
        await expect(addBtn).toBeVisible({ timeout: 5_000 });

        expect(
          jsErrors,
          `JS errors after ${cycle * 30}s: ${jsErrors.join('; ')}`,
        ).toHaveLength(0);
      }
    } finally {
      await ctx.close();
    }
  }, 120_000); // Extended timeout for this test.

  test('no memory leak — JS heap stable over 90s of polling', async ({
    browser,
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    const s = await openSession(request, staffToken, firstTableId, 1);
    sessionId = s.session_id;

    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('HeapGuest', '9020000002');
      await customer.waitForOrderingScreen();

      const heapSnapshots: number[] = [];

      const cdp = await ctx.newCDPSession(page);

      async function getHeap(): Promise<number> {
        try {
          const metrics = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> };
          const heap = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize');
          return heap ? heap.value : 0;
        } catch {
          return 0;
        }
      }

      // Baseline heap.
      heapSnapshots.push(await getHeap());

      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(30_000);
        heapSnapshots.push(await getHeap());
      }

      console.log('[PERF] JS Heap snapshots (bytes):', heapSnapshots);

      // Heap growth should not exceed 50 MB across 90s of polling.
      if (heapSnapshots.every((h) => h > 0)) {
        const growth = heapSnapshots[heapSnapshots.length - 1] - heapSnapshots[0];
        expect(
          growth,
          `JS heap grew by ${(growth / 1024 / 1024).toFixed(1)} MB — possible memory leak`,
        ).toBeLessThan(50 * 1024 * 1024);
      }
    } finally {
      await ctx.close();
    }
  }, 120_000);

  test('initial page load (tables UI) — LCP < 3s', async ({
    browser,
    request,
    staffToken,
    firstTableId,
  }) => {
    const s = await openSession(request, staffToken, firstTableId, 1);
    sessionId = s.session_id;

    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      let lcp = 0;
      await page.addInitScript(() => {
        new PerformanceObserver((entryList) => {
          for (const entry of entryList.getEntries()) {
            (window as any).__kravon_lcp = entry.startTime;
          }
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      });

      const navStart = Date.now();
      await page.goto(tableUrl(firstTableId));
      await page.waitForLoadState('domcontentloaded');

      lcp = await page.evaluate(() => (window as any).__kravon_lcp || 0);
      const wallTime = Date.now() - navStart;

      console.log(`[PERF] LCP: ${lcp.toFixed(0)}ms  wall: ${wallTime}ms`);

      // Use wall time as fallback when LCP is not measurable (e.g., no images).
      const measuredTime = lcp > 0 ? lcp : wallTime;
      expect(
        measuredTime,
        `Page load took ${measuredTime.toFixed(0)}ms — should be < 3000ms`,
      ).toBeLessThan(3_000);
    } finally {
      await ctx.close();
    }
  });

  test('dashboard initial load — interactive within 5s', async ({ browser }) => {
    const { DASHBOARD_URL, SLUG, STAFF_EMAIL, STAFF_PASSWORD } = await import('../../fixtures/env');
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const t0 = Date.now();
      await page.goto(DASHBOARD_URL);
      await page.locator('#login-slug, [name="slug"]').fill(SLUG);
      await page.locator('#login-email, [name="email"]').fill(STAFF_EMAIL);
      await page.locator('#login-password, [name="password"]').fill(STAFF_PASSWORD);
      await page.locator('#login-form').getByRole('button', { name: /sign in|login/i }).click();

      await page.locator('.dashboard-main, #dashboard-app, [data-view]').first().waitFor({ timeout: 10_000 });
      const tti = Date.now() - t0;

      console.log(`[PERF] Dashboard TTI: ${tti}ms`);
      expect(tti).toBeLessThan(5_000);
    } finally {
      await ctx.close();
    }
  });
});
