/**
 * SCENARIO 9 — Session Closure
 * P0: State machine transitions are correct and irreversible.
 *     Session data is fully retained after closure.
 *     No duplicate transitions.
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
import { API_URL, SLUG } from '../../fixtures/env';

test.describe('Scenario 9 — Session Closure', () => {
  let sessionId: string;

  test.beforeEach(async ({ request, staffToken, firstTableId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    sessionId = '';
  });

  test.afterEach(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
      sessionId = '';
    }
  });

  test('full lifecycle: open → bill_requested → closed, data retained', async ({
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    // 1. Open
    const s = await openSession(request, staffToken, firstTableId, 2);
    sessionId = s.session_id;

    let status = await getSessionStatus(request, firstTableId);
    expect(status.open).toBe(true);
    expect(status.session_status).toBe('open');

    // 2. Place order
    const order = await placeDineInOrder(
      request, sessionId, 'LifecycleGuest', '9700000001',
      [{ menu_item_id: menuItemId, quantity: 2 }],
    );

    // 3. Bill requested
    await requestBill(request, sessionId, 'LifecycleGuest');
    status = await getSessionStatus(request, firstTableId);
    expect(status.bill_requested).toBe(true);
    expect(status.session_status).toBe('bill_requested');

    // 4. Close
    await closeSession(request, staffToken, sessionId);

    status = await getSessionStatus(request, firstTableId);
    expect(status.open).toBe(false);

    // 5. Session orders still retrievable after closure
    const { orders } = await getSessionOrders(request, sessionId);
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders[0].order_id).toBe(order.order_id);
  });

  test('cannot place orders on closed session', async ({
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    const s = await openSession(request, staffToken, firstTableId, 1);
    sessionId = s.session_id;
    await closeSession(request, staffToken, sessionId);

    const res = await request.post(
      `${API_URL}/v1/restaurants/${SLUG}/dine-in/order`,
      {
        data: {
          session_id:  sessionId,
          guest_name:  'LateGuest',
          guest_phone: '9700000002',
          items:       [{ menu_item_id: menuItemId, quantity: 1 }],
        },
      },
    );
    expect(res.status()).toBeGreaterThanOrEqual(400);
    sessionId = ''; // Already closed, skip afterEach cleanup.
  });

  test('closing twice is idempotent — no 500 error on second close', async ({
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    const s = await openSession(request, staffToken, firstTableId, 1);
    sessionId = s.session_id;
    await placeDineInOrder(
      request, sessionId, 'DoubleCloseGuest', '9700000003',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );

    await closeSession(request, staffToken, sessionId);

    // Second close attempt.
    const res = await request.post(
      `${API_URL}/v1/restaurants/${SLUG}/dine-in/session/close`,
      {
        headers: { Authorization: `Bearer ${staffToken}` },
        data:    { session_id: sessionId },
      },
    );
    // Should be 4xx (graceful rejection), not 500.
    expect(res.status()).toBeLessThan(500);
    sessionId = '';
  });

  test('total_billed is correctly calculated from all confirmed orders', async ({
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    const s = await openSession(request, staffToken, firstTableId, 2);
    sessionId = s.session_id;

    const order1 = await placeDineInOrder(
      request, sessionId, 'BilledGuest1', '9700000004',
      [{ menu_item_id: menuItemId, quantity: 2 }],
    );
    const order2 = await placeDineInOrder(
      request, sessionId, 'BilledGuest2', '9700000005',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );

    const closeRes = await request.post(
      `${API_URL}/v1/restaurants/${SLUG}/dine-in/session/close`,
      {
        headers: { Authorization: `Bearer ${staffToken}` },
        data:    { session_id: sessionId },
      },
    );
    expect(closeRes.ok()).toBe(true);
    const closeBody = await closeRes.json();

    // total_billed must equal order1.total + order2.total.
    const expected = Number(order1.total) + Number(order2.total);
    expect(Number(closeBody.total_billed)).toBeCloseTo(expected, 2);
    sessionId = '';
  });

  test('dashboard shows table as available after close', async ({
    request,
    staffToken,
    firstTableId,
    tables,
    dashboardPage,
  }) => {
    const tableName = tables.find((t) => t.id === firstTableId)?.name ?? 'T1';
    const s = await openSession(request, staffToken, firstTableId, 1);
    sessionId = s.session_id;
    await closeSession(request, staffToken, sessionId);
    sessionId = '';

    await dashboardPage.refresh();
    await dashboardPage.assertTableAvailable(tableName);
  });
});
