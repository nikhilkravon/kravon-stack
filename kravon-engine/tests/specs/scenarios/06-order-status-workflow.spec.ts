/**
 * SCENARIO 6 — Order Status Workflow
 * P1: Staff can move orders through the full lifecycle.
 *     Status updates persist, customer sees updates, no regression.
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  getSessionOrders,
  updateOrderStatus,
  ensureTableClosed,
} from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';

const WORKFLOW_STATUSES = ['confirmed', 'preparing', 'ready', 'delivered'] as const;
type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

test.describe('Scenario 6 — Order Status Workflow', () => {
  let sessionId: string;
  let orderId:   string;

  test.beforeEach(async ({ request, staffToken, firstTableId, menuItemId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    const s = await openSession(request, staffToken, firstTableId, 2);
    sessionId = s.session_id;

    const order = await placeDineInOrder(
      request, sessionId, 'WorkflowGuest', '9400000001',
      [{ menu_item_id: menuItemId, quantity: 1 }],
    );
    orderId = order.order_id;
  });

  test.afterEach(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
      sessionId = '';
    }
  });

  test('order progresses through full lifecycle — API persists each step', async ({
    request,
    staffToken,
  }) => {
    for (const status of WORKFLOW_STATUSES) {
      await updateOrderStatus(request, staffToken, orderId, status);

      const { orders } = await getSessionOrders(request, sessionId);
      const target = orders.find((o) => o.order_id === orderId);
      expect(target, `Order not found in feed after status → ${status}`).toBeTruthy();
      expect(
        target!.status,
        `Expected status ${status}, got ${target!.status}`,
      ).toBe(status);
    }
  });

  test('no status regression allowed — cannot set lower status after higher', async ({
    request,
    staffToken,
  }) => {
    // Advance to "ready".
    await updateOrderStatus(request, staffToken, orderId, 'preparing');
    await updateOrderStatus(request, staffToken, orderId, 'ready');

    // Attempting to revert to "confirmed" should fail at the API level.
    const res = await request.patch(
      `${process.env.KRAVON_API_URL || 'http://localhost:3000'}/v1/restaurants/${process.env.KRAVON_SLUG || 'demo'}/orders/${orderId}`,
      {
        headers: { Authorization: `Bearer ${staffToken}` },
        data: { status: 'confirmed' },
      },
    );
    // The backend should either reject with 4xx or silently keep the current status.
    if (res.ok()) {
      const { orders } = await getSessionOrders(request, sessionId);
      const target = orders.find((o) => o.order_id === orderId);
      // If the API accepted the call, the status must not have regressed.
      expect(target!.status).not.toBe('confirmed');
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
  });

  test('customer sees updated status within polling window', async ({
    browser,
    request,
    staffToken,
    firstTableId,
  }) => {
    // Guest is on the ordering screen with the live-orders panel visible.
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('WatchingGuest', '9400000099');
      await customer.waitForOrderingScreen();

      // Wait for the first poll to fire and orders panel to appear.
      await customer.assertOrdersVisible();

      // Staff advances the order status.
      await updateOrderStatus(request, staffToken, orderId, 'preparing');

      // Within the next polling cycle (≤30s) the customer UI should reflect "preparing".
      await expect(
        page.getByText(/preparing/i).first(),
      ).toBeVisible({ timeout: 35_000 });
    } finally {
      await ctx.close();
    }
  });

  test('dashboard reflects status updates without requiring a page reload', async ({
    request,
    staffToken,
    firstTableId,
    tables,
    dashboardPage,
  }) => {
    const tableName = tables.find((t) => t.id === firstTableId)?.name ?? 'T1';

    await updateOrderStatus(request, staffToken, orderId, 'preparing');

    // Trigger an immediate re-render rather than waiting for the 15s poll timer.
    await dashboardPage.refresh();

    const tableCard = dashboardPage.page
      .locator('.table-card, [data-table-name]', { hasText: tableName })
      .first();

    await expect(
      tableCard.getByText(/preparing/i).first(),
    ).toBeVisible({ timeout: 12_000 });
  });
});
