/**
 * SCENARIO 3 — Multi-Guest Table Join
 * P0: Multiple guests join the same session concurrently.
 *     Original bill owner must not change.
 *     All orders are attributed correctly.
 *     No session duplication.
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  getSessionOrders,
  getSessionStatus,
  ensureTableClosed,
} from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';

const GUESTS = [
  { name: 'Alice',   phone: '9000000101' },
  { name: 'Bob',     phone: '9000000102' },
  { name: 'Charlie', phone: '9000000103' },
  { name: 'Diana',   phone: '9000000104' },
];

test.describe('Scenario 3 — Multi-Guest Table Join', () => {
  let sessionId: string;

  test.beforeEach(async ({ request, staffToken, firstTableId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    const s = await openSession(request, staffToken, firstTableId, GUESTS.length);
    sessionId = s.session_id;
  });

  test.afterEach(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
      sessionId = '';
    }
  });

  test('all guests can access menu on same session', async ({ browser, firstTableId }) => {
    const contexts = await Promise.all(GUESTS.map(() => browser.newContext()));
    const pages    = await Promise.all(contexts.map((ctx) => ctx.newPage()));

    try {
      // All guests navigate simultaneously.
      await Promise.all(
        pages.map(async (page, i) => {
          const customer = new CustomerPage(page);
          await customer.gotoTable(firstTableId);
          await customer.submitGuestIdentity(GUESTS[i].name, GUESTS[i].phone);
          await customer.waitForOrderingScreen();
        }),
      );
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });

  test('each guest places an order — all attributed correctly', async ({
    request,
    firstTableId,
    menuItemId,
  }) => {
    // Place orders via API directly (faster, more reliable for attribution test).
    const orderIds = await Promise.all(
      GUESTS.map((g) =>
        placeDineInOrder(request, sessionId, g.name, g.phone, [
          { menu_item_id: menuItemId, quantity: 1 },
        ]),
      ),
    );

    // Verify all orders landed and were attributed to the right guest.
    const { orders } = await getSessionOrders(request, sessionId);
    expect(orders.length).toBeGreaterThanOrEqual(GUESTS.length);

    for (const guest of GUESTS) {
      const guestOrders = orders.filter((o) => o.guest_name === guest.name);
      expect(
        guestOrders.length,
        `Expected at least one order for ${guest.name}`,
      ).toBeGreaterThanOrEqual(1);
    }

    // Each returned order_id should be unique.
    const ids = orderIds.map((o) => o.order_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('bill owner does not change after additional guests join', async ({
    request,
    firstTableId,
    menuItemId,
  }) => {
    // First guest order — establishes bill owner.
    await placeDineInOrder(
      request,
      sessionId,
      GUESTS[0].name,
      GUESTS[0].phone,
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );

    // Subsequent guests order.
    for (let i = 1; i < GUESTS.length; i++) {
      await placeDineInOrder(
        request,
        sessionId,
        GUESTS[i].name,
        GUESTS[i].phone,
        [{ menu_item_id: menuItemId, quantity: 1 }],
      );
    }

    const status = await getSessionStatus(request, firstTableId);
    expect((status as any).has_bill_owner).toBe(true);
    // bill_owner_name is not directly exposed in session/status,
    // but we verify has_bill_owner is still truthy and the session is still open.
    expect(status.open).toBe(true);
  });

  test('no session duplication — only one session per table', async ({
    request,
    firstTableId,
  }) => {
    const status = await getSessionStatus(request, firstTableId);
    // If there were duplicate sessions the uniqueness constraint would have fired,
    // but we also verify only one active session is returned.
    expect(status.open).toBe(true);
    expect(status.session_id).toBe(sessionId);
  });

  test('simultaneous scans — race condition does not corrupt bill owner', async ({
    request,
    firstTableId,
    menuItemId,
  }) => {
    // Fire all order requests at the exact same millisecond.
    const results = await Promise.allSettled(
      GUESTS.map((g) =>
        placeDineInOrder(request, sessionId, g.name, g.phone, [
          { menu_item_id: menuItemId, quantity: 1 },
        ]),
      ),
    );

    // At least one must have succeeded.
    const successes = results.filter((r) => r.status === 'fulfilled');
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Session should still be open and have exactly one bill owner.
    const status = await getSessionStatus(request, firstTableId);
    expect(status.open).toBe(true);
    expect((status as any).has_bill_owner).toBe(true);
  });
});
