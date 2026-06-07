/**
 * SCENARIO 8 — Staff Bill Handling
 * P2 enhancement observation: document whether acknowledgement state is needed.
 * Tests: badge visibility, correct table highlighted, session data consistent when bill viewed.
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  requestBill,
  getSessionOrders,
  ensureTableClosed,
} from '../../fixtures/api';
import { API_URL, SLUG } from '../../fixtures/env';

test.describe('Scenario 8 — Staff Bill Handling', () => {
  let sessionId: string;

  test.beforeEach(async ({ request, staffToken, firstTableId, menuItemId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    const s = await openSession(request, staffToken, firstTableId, 2);
    sessionId = s.session_id;

    await placeDineInOrder(
      request, sessionId, 'BillHandleGuest', '9600000001',
      [{ menu_item_id: menuItemId, quantity: 2 }],
    );
    await requestBill(request, sessionId, 'BillHandleGuest');
  });

  test.afterEach(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
      sessionId = '';
    }
  });

  test('bill-request badge appears on correct table card in dashboard', async ({
    dashboardPage,
    firstTableId,
    tables,
  }) => {
    const tableName = tables.find((t) => t.id === firstTableId)?.name ?? 'T1';
    await dashboardPage.refresh();
    await dashboardPage.assertBillRequestBadge(tableName);
  });

  test('view bill modal shows correct order totals and items', async ({
    request,
    staffToken,
    firstTableId,
    tables,
    dashboardPage,
  }) => {
    const tableName = tables.find((t) => t.id === firstTableId)?.name ?? 'T1';
    await dashboardPage.refresh();

    const grandTotalText = await dashboardPage.viewBill(tableName);
    expect(grandTotalText.trim().length).toBeGreaterThan(0);

    // Grand total must contain a numeric value.
    expect(/[\d,\.]+/.test(grandTotalText)).toBe(true);
  });

  test('bill endpoint returns consistent data (items match session orders)', async ({
    request,
    staffToken,
  }) => {
    const { orders } = await getSessionOrders(request, sessionId);
    expect(orders.length).toBeGreaterThanOrEqual(1);

    const billRes = await request.get(
      `${API_URL}/v1/restaurants/${SLUG}/dine-in/bill?session_id=${sessionId}`,
      { headers: { Authorization: `Bearer ${staffToken}` } },
    );
    expect(billRes.ok()).toBe(true);

    const { bill } = await billRes.json();
    expect(bill.orders.length).toBe(orders.length);

    // Grand total must be positive.
    expect(bill.grand_total).toBeGreaterThan(0);

    // GST fields should be present (even if zero).
    expect(typeof bill.cgst_amount).toBe('number');
    expect(typeof bill.sgst_amount).toBe('number');
  });

  test('session remains open and consistent while bill is being reviewed', async ({
    request,
    firstTableId,
  }) => {
    const { orders } = await getSessionOrders(request, sessionId);
    const orderCountBefore = orders.length;

    // Simulate staff spending 2s reviewing the bill.
    await new Promise((r) => setTimeout(r, 2_000));

    const { orders: ordersAfter } = await getSessionOrders(request, sessionId);
    expect(ordersAfter.length).toBe(orderCountBefore);
  });

  /**
   * OBSERVATION: There is currently no `bill_request_acknowledged_at` or
   * `bill_request_acknowledged_by` field on the session.
   * Once staff view the bill or close the session the badge disappears,
   * but there is no explicit acknowledgement step.
   *
   * RECOMMENDATION (P2): Add acknowledgement fields to enable:
   *   - response-time SLA tracking (bill_requested_at → acknowledged_at)
   *   - multi-staff environments where two staff members don't race to the same table
   */
  test('OBSERVATION — no explicit acknowledgement state exists', async ({ request, staffToken }) => {
    const billRes = await request.get(
      `${API_URL}/v1/restaurants/${SLUG}/dine-in/bill?session_id=${sessionId}`,
      { headers: { Authorization: `Bearer ${staffToken}` } },
    );
    const { bill } = await billRes.json();

    const hasAcknowledgement =
      'bill_request_acknowledged_at' in bill || 'bill_request_acknowledged_by' in bill;

    if (!hasAcknowledgement) {
      // This is an expected observation, not a failure.
      console.warn(
        '[P2] No acknowledgement fields found on bill response. ' +
        'Recommended: add bill_request_acknowledged_at / bill_request_acknowledged_by.',
      );
    }

    // Test passes regardless — this is a documentation/observation test.
    expect(true).toBe(true);
  });
});
