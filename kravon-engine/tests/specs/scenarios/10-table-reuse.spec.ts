/**
 * SCENARIO 10 — Table Reuse
 * P0: After session close, the same table can be opened for a new session.
 *     No previous orders, guests, or bill-owner data leaks into the new session.
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  requestBill,
  getSessionStatus,
  getSessionOrders,
  ensureTableClosed,
} from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';

test.describe('Scenario 10 — Table Reuse', () => {
  let firstSessionId:  string;
  let secondSessionId: string;

  test.beforeEach(async ({ request, staffToken, firstTableId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    firstSessionId = secondSessionId = '';
  });

  test.afterEach(async ({ request, staffToken }) => {
    for (const sid of [firstSessionId, secondSessionId]) {
      if (sid) await closeSession(request, staffToken, sid).catch(() => {});
    }
    firstSessionId = secondSessionId = '';
  });

  test('new session on same table has no previous orders', async ({
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    // Session 1 — place order and close.
    const s1 = await openSession(request, staffToken, firstTableId, 2);
    firstSessionId = s1.session_id;

    await placeDineInOrder(
      request, firstSessionId, 'OldGuest', '9800000001',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );
    await closeSession(request, staffToken, firstSessionId);
    firstSessionId = '';

    // Session 2 — verify no orders visible.
    const s2 = await openSession(request, staffToken, firstTableId, 2);
    secondSessionId = s2.session_id;

    const { orders } = await getSessionOrders(request, secondSessionId);
    expect(orders.length).toBe(0);
  });

  test('new session has no previous bill owner', async ({
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    // Session 1 — establish bill owner.
    const s1 = await openSession(request, staffToken, firstTableId, 1);
    firstSessionId = s1.session_id;

    await placeDineInOrder(
      request, firstSessionId, 'OldOwner', '9800000002',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );
    await closeSession(request, staffToken, firstSessionId);
    firstSessionId = '';

    // Session 2 — bill owner should not be set.
    const s2 = await openSession(request, staffToken, firstTableId, 1);
    secondSessionId = s2.session_id;

    const status = await getSessionStatus(request, firstTableId);
    expect(status.open).toBe(true);
    expect(status.session_id).toBe(secondSessionId);
    expect((status as any).has_bill_owner).toBe(false);
  });

  test('new session has no previous bill request', async ({
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    const s1 = await openSession(request, staffToken, firstTableId, 1);
    firstSessionId = s1.session_id;

    await placeDineInOrder(
      request, firstSessionId, 'OldBillRequester', '9800000003',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );
    await requestBill(request, firstSessionId, 'OldBillRequester');
    await closeSession(request, staffToken, firstSessionId);
    firstSessionId = '';

    const s2 = await openSession(request, staffToken, firstTableId, 1);
    secondSessionId = s2.session_id;

    const status = await getSessionStatus(request, firstTableId);
    expect(status.bill_requested).toBe(false);
    // getSessionStatus returns bill_requested (boolean); raw timestamp is not in the response.
  });

  test('QR link resolves to new session — customer sees fresh menu', async ({
    browser,
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    // Session 1 — create and close.
    const s1 = await openSession(request, staffToken, firstTableId, 1);
    firstSessionId = s1.session_id;
    await closeSession(request, staffToken, firstSessionId);
    firstSessionId = '';

    // Session 2 — open.
    const s2 = await openSession(request, staffToken, firstTableId, 2);
    secondSessionId = s2.session_id;

    // New guest scans same QR.
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);

      // Guest popup should appear — not a session-closed page.
      await expect(
        page.locator('#guest-popup-overlay, .guest-popup, [data-popup="guest"], #guest-form').first(),
      ).toBeVisible({ timeout: 10_000 });

      await customer.submitGuestIdentity('FreshGuest', '9800000099');
      await customer.waitForOrderingScreen();

      // No old order history visible.
      const ordersPanel = page.locator('.orders-panel, .live-orders, [data-orders-panel]').first();
      // Panel either absent or showing zero orders.
      const isVisible = await ordersPanel.isVisible();
      if (isVisible) {
        const orderRows = page.locator('.order-row, [data-order]');
        expect(await orderRows.count()).toBe(0);
      }
    } finally {
      await ctx.close();
    }
  });

  test('two tables can be open simultaneously without cross-contamination', async ({
    request,
    staffToken,
    tables,
    menuItemId,
  }) => {
    if (tables.length < 2) {
      test.skip(true, 'Need at least 2 tables for this test.');
      return;
    }

    const [tableA, tableB] = tables;

    // Ensure both are closed before starting.
    const [statusA, statusB] = await Promise.all([
      getSessionStatus(request, tableA.id),
      getSessionStatus(request, tableB.id),
    ]);
    if (statusA.open || statusB.open) {
      test.skip(true, 'Both tables must be available — close any open sessions first.');
      return;
    }

    const [sA, sB] = await Promise.all([
      openSession(request, staffToken, tableA.id, 2),
      openSession(request, staffToken, tableB.id, 2),
    ]);
    firstSessionId  = sA.session_id;
    secondSessionId = sB.session_id;

    // Place distinct orders.
    const orderA = await placeDineInOrder(
      request, firstSessionId, 'TableAGuest', '9800000011',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );
    const orderB = await placeDineInOrder(
      request, secondSessionId, 'TableBGuest', '9800000012',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );

    // Verify A's feed doesn't contain B's order and vice versa.
    const [feedA, feedB] = await Promise.all([
      getSessionOrders(request, firstSessionId),
      getSessionOrders(request, secondSessionId),
    ]);

    expect(feedA.orders.map((o) => o.order_id)).not.toContain(orderB.order_id);
    expect(feedB.orders.map((o) => o.order_id)).not.toContain(orderA.order_id);
  });
});
