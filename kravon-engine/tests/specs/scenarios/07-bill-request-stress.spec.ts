/**
 * SCENARIO 7 — Bill Request Stress Test
 * P0: Idempotency under repeated and concurrent bill requests.
 *   - Single bill_requested_at timestamp recorded
 *   - Single dashboard badge shown
 *   - No duplicate events generated
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  requestBill,
  getSessionStatus,
  ensureTableClosed,
} from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';
import { API_URL, SLUG } from '../../fixtures/env';

test.describe('Scenario 7 — Bill Request Stress Test', () => {
  let sessionId: string;

  test.beforeEach(async ({ request, staffToken, firstTableId, menuItemId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    const s = await openSession(request, staffToken, firstTableId, 2);
    sessionId = s.session_id;

    // Place an order so the session has some content.
    await placeDineInOrder(
      request, sessionId, 'BillStressGuest', '9500000001',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );
  });

  test.afterEach(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
      sessionId = '';
    }
  });

  test('10 sequential bill requests produce exactly one bill_requested_at', async ({ request }) => {
    let firstTimestamp: string | null = null;

    for (let i = 0; i < 10; i++) {
      const res = await requestBill(request, sessionId, 'BillStressGuest');
      expect(res.ok).toBe(true);
      expect(res.bill_requested_at).toBeTruthy();

      if (i === 0) {
        firstTimestamp = res.bill_requested_at;
      } else {
        expect(
          res.bill_requested_at,
          `bill_requested_at changed on request ${i + 1}`,
        ).toBe(firstTimestamp);
      }
    }
  });

  test('20 concurrent bill requests produce exactly one bill_requested_at', async ({ request }) => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => requestBill(request, sessionId, 'ConcurrentGuest')),
    );

    // All responses must be ok.
    for (const r of results) expect(r.ok).toBe(true);

    // All returned timestamps must be identical.
    const timestamps = new Set(results.map((r) => r.bill_requested_at));
    expect(
      timestamps.size,
      `Expected 1 unique bill_requested_at, got ${timestamps.size}: ${[...timestamps].join(', ')}`,
    ).toBe(1);
  });

  test('session status shows bill_requested after first request', async ({ request, firstTableId }) => {
    await requestBill(request, sessionId, 'BillStressGuest');
    const status = await getSessionStatus(request, firstTableId);
    expect(status.bill_requested).toBe(true);
    // getSessionStatus returns bill_requested (boolean); raw timestamp is not in the response.
  });

  test('dashboard shows exactly one bill-request badge per table', async ({
    request,
    staffToken,
    firstTableId,
    tables,
    dashboardPage,
  }) => {
    const tableName = tables.find((t) => t.id === firstTableId)?.name ?? 'T1';

    // Spam 5 requests.
    await Promise.all(
      Array.from({ length: 5 }, () => requestBill(request, sessionId, 'SpamGuest')),
    );

    await dashboardPage.refresh();
    await dashboardPage.assertBillRequestBadge(tableName);

    // Only one badge for this table (count all badges, table should contribute 1).
    const tableCard = dashboardPage.page
      .locator('.table-card, [data-table-name]', { hasText: tableName })
      .first();
    const badgesInCard = tableCard.locator('.bill-requested-alert');
    expect(await badgesInCard.count()).toBe(1);
  });

  test('customer request-bill button is disabled after first submission (UI)', async ({
    browser,
    firstTableId,
    request,
  }) => {
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('UIBillGuest', '9500000002');
      await customer.waitForOrderingScreen();
      await customer.addItemToCart();
      await customer.goToCheckout();
      await customer.placeOrder();

      // Request bill from confirmation screen.
      await customer.requestBill();

      // Button should now be disabled or gone.
      const isDisabled = await customer.isBillRequestDisabled();
      expect(isDisabled, 'Request Bill button should be disabled after submission').toBe(true);

      // Attempting again via API should still be idempotent.
      const r2 = await requestBill(request, sessionId, 'UIBillGuest');
      expect(r2.ok).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
