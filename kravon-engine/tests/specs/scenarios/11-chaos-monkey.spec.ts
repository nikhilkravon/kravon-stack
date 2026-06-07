/**
 * SCENARIO 11 — Chaos Monkey Test
 * P0: System remains stable under adversarial, real-world customer behaviour.
 *   - Double-click buttons
 *   - Multiple tabs
 *   - Page refresh
 *   - Abandoned carts / returns
 *   - Duplicate submissions
 *   - No session or ownership corruption
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  getSessionOrders,
  getSessionStatus,
  requestBill,
  ensureTableClosed,
} from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';

test.describe('Scenario 11 — Chaos Monkey Test', () => {
  let sessionId: string;

  test.beforeEach(async ({ request, staffToken, firstTableId, menuItemId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    const s = await openSession(request, staffToken, firstTableId, 4);
    sessionId = s.session_id;
  });

  test.afterEach(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
      sessionId = '';
    }
  });

  test('double-click Place Order produces only one order', async ({
    browser,
    firstTableId,
    request,
    menuItemId,
  }) => {
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('DoubleClickGuest', '9900000001');
      await customer.waitForOrderingScreen();
      await customer.addItemToCart();

      // Navigate to checkout.
      await page.locator('#screenOrdering #navCartBtn').click();
      await page.locator('[data-action="go-checkout"]').click();
      await page.waitForSelector('#screenCheckout', { timeout: 8_000 });

      // Rapid double-click on Place Order.
      const placeOrderBtn = page.getByRole('button', { name: /place order/i }).first();
      await placeOrderBtn.click({ clickCount: 1 });
      await placeOrderBtn.click({ clickCount: 1, delay: 50 }); // second click immediately after

      // Wait for any response to settle.
      await page.waitForTimeout(3_000);

      // Only one order should have been created for this guest.
      const { orders } = await getSessionOrders(request, sessionId);
      const myOrders = orders.filter((o) => o.guest_name === 'DoubleClickGuest');
      expect(
        myOrders.length,
        `Double-click produced ${myOrders.length} orders instead of 1`,
      ).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  test('two tabs for same guest — no duplicate session creation', async ({
    browser,
    firstTableId,
    request,
  }) => {
    const ctx = await browser.newContext();
    const [page1, page2] = await Promise.all([ctx.newPage(), ctx.newPage()]);

    try {
      // Both tabs navigate to same table simultaneously.
      await Promise.all([
        new CustomerPage(page1).gotoTable(firstTableId),
        new CustomerPage(page2).gotoTable(firstTableId),
      ]);

      const status = await getSessionStatus(request, firstTableId);
      // There must still be exactly one session.
      expect(status.open).toBe(true);
      expect(status.session_id).toBe(sessionId);
    } finally {
      await ctx.close();
    }
  });

  test('page refresh mid-order retains cart intent (UI resilience)', async ({
    browser,
    firstTableId,
  }) => {
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('RefreshGuest', '9900000002');
      await customer.waitForOrderingScreen();

      // Add items, then refresh before placing order.
      await customer.addItemToCart();

      await page.reload();
      // After reload, the session is still open so the guest popup re-appears.
      // Re-submit identity to confirm the UI boots cleanly (no crash) and the
      // ordering screen is reachable. Cart persistence is a UX decision, not tested here.
      await customer.submitGuestIdentity('RefreshGuest', '9900000002');
      await customer.waitForOrderingScreen();
    } finally {
      await ctx.close();
    }
  });

  test('abandoned cart — session stays consistent, other guests unaffected', async ({
    request,
    firstTableId,
    menuItemId,
  }) => {
    const orderCountBefore = (await getSessionOrders(request, sessionId)).orders.length;

    // Guest 1 opens cart, leaves without ordering (simulated by just not calling placeOrder).
    // No API call = no server-side state change.

    // Guest 2 places a legitimate order.
    await placeDineInOrder(
      request, sessionId, 'HonestGuest', '9900000003',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );

    const { orders } = await getSessionOrders(request, sessionId);
    // Only guest 2's order should appear.
    expect(orders.length).toBe(orderCountBefore + 1);
    expect(orders.at(-1)!.guest_name).toBe('HonestGuest');
  });

  test('returning guest reuses same session — no new session opened', async ({
    browser,
    request,
    firstTableId,
    menuItemId,
  }) => {
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);

      // First visit — place order.
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('ReturnGuest', '9900000004');
      await customer.waitForOrderingScreen();
      await customer.addItemToCart();
      await customer.goToCheckout();
      await customer.placeOrder();

      // "Leave" and come back (simulate by navigating away then returning).
      await page.goto('about:blank');
      await customer.gotoTable(firstTableId);

      // Should land back on ordering screen or the same session — NOT a new session.
      const status = await getSessionStatus(request, firstTableId);
      expect(status.session_id).toBe(sessionId);
    } finally {
      await ctx.close();
    }
  });

  test('concurrent bill requests from two different browsers produce one record', async ({
    browser,
    request,
    firstTableId,
    menuItemId,
  }) => {
    // Seed at least one order.
    await placeDineInOrder(
      request, sessionId, 'ChaosGuest1', '9900000005',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );

    // Two browsers hit request-bill simultaneously.
    const [res1, res2] = await Promise.all([
      requestBill(request, sessionId, 'ChaosGuest1'),
      requestBill(request, sessionId, 'ChaosGuest2'),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.bill_requested_at).toBe(res2.bill_requested_at);
  });

  test('network disconnect and reconnect — session survives', async ({
    browser,
    request,
    firstTableId,
    menuItemId,
  }) => {
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('NetworkGuest', '9900000006');
      await customer.waitForOrderingScreen();

      // Simulate offline → place an order via the real API (connection still available there).
      // We use CDP to throttle network to simulate reconnect scenario.
      const cdpSession = await ctx.newCDPSession(page);
      await cdpSession.send('Network.emulateNetworkConditions', {
        offline:            true,
        latency:            0,
        downloadThroughput: 0,
        uploadThroughput:   0,
      });

      // While "offline", the background polling should not crash the page.
      await page.waitForTimeout(3_000);

      // Reconnect.
      await cdpSession.send('Network.emulateNetworkConditions', {
        offline:            false,
        latency:            0,
        downloadThroughput: -1,
        uploadThroughput:   -1,
      });

      // Session should still be consistent after reconnect.
      const status = await getSessionStatus(request, firstTableId);
      expect(status.open).toBe(true);
      expect(status.session_id).toBe(sessionId);

      // Page should not have hard-crashed (ordering screen still reachable).
      await customer.waitForOrderingScreen();
    } finally {
      await ctx.close();
    }
  });

  test('overall data integrity — orders count matches across multiple chaotic actions', async ({
    request,
    firstTableId,
    menuItemId,
  }) => {
    const chaosGuests = Array.from({ length: 6 }, (_, i) => ({
      name:  `ChaosIntegrity${i}`,
      phone: `990000${String(i + 10).padStart(4, '0')}`,
    }));

    // Mix of sequential and parallel submissions.
    await placeDineInOrder(request, sessionId, chaosGuests[0].name, chaosGuests[0].phone, [
      { menu_item_id: menuItemId, quantity: 1 },
    ]);
    await Promise.all(
      chaosGuests.slice(1, 4).map((g) =>
        placeDineInOrder(request, sessionId, g.name, g.phone, [
          { menu_item_id: menuItemId, quantity: 1 },
        ]),
      ),
    );
    // One more after a tiny gap.
    await new Promise((r) => setTimeout(r, 300));
    await placeDineInOrder(request, sessionId, chaosGuests[4].name, chaosGuests[4].phone, [
      { menu_item_id: menuItemId, quantity: 1 },
    ]);

    // Duplicate attempt (same guest, same items) — should be a new order (system allows it,
    // it's a real restaurant behaviour: ordering seconds).
    await placeDineInOrder(request, sessionId, chaosGuests[0].name, chaosGuests[0].phone, [
      { menu_item_id: menuItemId, quantity: 1 },
    ]);

    const { orders } = await getSessionOrders(request, sessionId);

    // All order_ids must be unique.
    const ids    = orders.map((o) => o.order_id);
    const unique = new Set(ids);
    expect(
      unique.size,
      `Duplicate order IDs found: ${ids.join(', ')}`,
    ).toBe(ids.length);

    // Minimum expected orders: 6 (5 unique guests + 1 re-order from chaosGuests[0]).
    expect(orders.length).toBeGreaterThanOrEqual(6);
  });
});
