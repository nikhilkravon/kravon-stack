/**
 * SCENARIO 5 — Live Session Feed
 * P1: Orders placed by multiple guests appear in both the customer live-orders
 *     panel and the dashboard with correct attribution and timestamps.
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  getSessionOrders,
  ensureTableClosed,
} from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';

const FEEDERS = [
  { name: 'FeedAlice', phone: '9300000001' },
  { name: 'FeedBob',   phone: '9300000002' },
  { name: 'FeedCarla', phone: '9300000003' },
];

test.describe('Scenario 5 — Live Session Feed', () => {
  let sessionId: string;

  test.beforeEach(async ({ request, staffToken, firstTableId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    const s = await openSession(request, staffToken, firstTableId, FEEDERS.length);
    sessionId = s.session_id;
  });

  test.afterEach(async ({ request, staffToken }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
      sessionId = '';
    }
  });

  test('API feed returns all placed orders with guest name and status', async ({
    request,
    menuItemId,
  }) => {
    // Place orders sequentially to create an ordered timeline.
    for (const guest of FEEDERS) {
      await placeDineInOrder(request, sessionId, guest.name, guest.phone, [
        { menu_item_id: menuItemId, quantity: 1 },
      ]);
    }

    const { orders } = await getSessionOrders(request, sessionId);
    expect(orders.length).toBeGreaterThanOrEqual(FEEDERS.length);

    for (const order of orders) {
      expect(order.guest_name, 'Every order must carry a guest name').toBeTruthy();
      expect(order.status,     'Every order must carry a status').toBeTruthy();
      expect(Array.isArray(order.items), 'Every order must have an items array').toBe(true);
    }
  });

  test('orders are returned in chronological order (oldest first)', async ({
    request,
    menuItemId,
  }) => {
    for (const guest of FEEDERS) {
      await placeDineInOrder(request, sessionId, guest.name, guest.phone, [
        { menu_item_id: menuItemId, quantity: 1 },
      ]);
      // Small gap so created_at timestamps differ.
      await new Promise((r) => setTimeout(r, 200));
    }

    const { orders } = await getSessionOrders(request, sessionId);
    for (let i = 1; i < orders.length; i++) {
      const prev = new Date((orders[i - 1] as any).created_at).getTime();
      const curr = new Date((orders[i] as any).created_at).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  test('customer sees live orders panel after placing order', async ({
    browser,
    firstTableId,
    menuItemId,
    request,
  }) => {
    // Guest 1 places an order via the browser UI.
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity(FEEDERS[0].name, FEEDERS[0].phone);
      await customer.waitForOrderingScreen();
      await customer.addItemToCart();
      await customer.goToCheckout();
      await customer.placeOrder();

      // Navigate back to ordering screen (click "Order Again" or go back).
      const orderAgain = page.getByRole('button', { name: /order again|back to menu/i }).first();
      if (await orderAgain.isVisible()) await orderAgain.click();

      // The live orders panel should appear (either immediately after order
      // or within 30s when the polling fires).
      await customer.assertOrdersVisible();

      // Panel should show guest name.
      await expect(
        page.getByText(FEEDERS[0].name, { exact: false }).first(),
      ).toBeVisible({ timeout: 35_000 });
    } finally {
      await ctx.close();
    }
  });

  test('dashboard feed shows same orders as API response', async ({
    request,
    staffToken,
    firstTableId,
    tables,
    menuItemId,
    dashboardPage,
  }) => {
    const tableName = tables.find((t) => t.id === firstTableId)?.name ?? 'T1';

    // Place two orders via API.
    await placeDineInOrder(request, sessionId, FEEDERS[0].name, FEEDERS[0].phone, [
      { menu_item_id: menuItemId, quantity: 2 },
    ]);
    await placeDineInOrder(request, sessionId, FEEDERS[1].name, FEEDERS[1].phone, [
      { menu_item_id: menuItemId, quantity: 1 },
    ]);

    const { orders: apiOrders } = await getSessionOrders(request, sessionId);

    // Reload dashboard to pick up latest feed.
    await dashboardPage.refresh();

    const tableCard = dashboardPage.page
      .locator('.table-card, [data-table-name]', { hasText: tableName })
      .first();

    // Verify each guest name appears in the table card's orders section.
    // Orders are loaded asynchronously after the table grid renders.
    for (const guest of [FEEDERS[0], FEEDERS[1]]) {
      await expect(
        tableCard.getByText(guest.name, { exact: false }).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    // Order count in dashboard should match API.
    const dashboardOrderRows = tableCard.locator('.session-order-row, .order-row, [data-order]');
    const rowCount = await dashboardOrderRows.count();
    expect(rowCount).toBeGreaterThanOrEqual(apiOrders.length);
  });
});
