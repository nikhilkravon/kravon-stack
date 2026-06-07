/**
 * SCENARIO 4 — Lunch Rush Simulation
 * P0: Under load (10 tables × 4 guests = 40 active customers):
 *   - No duplicate orders
 *   - No missing orders
 *   - Session consistency maintained
 * P1: No stale UI states, polling remains stable
 */

import { test, expect } from '../../fixtures';
import {
  openSession,
  closeSession,
  placeDineInOrder,
  getSessionOrders,
  getSessionStatus,
  TableInfo,
} from '../../fixtures/api';

const GUESTS_PER_TABLE = 4;

interface TableSession {
  tableId:   string;
  tableName: string;
  sessionId: string;
}

test.describe('Scenario 4 — Lunch Rush Simulation', () => {
  let activeSessions: TableSession[] = [];

  test.afterEach(async ({ request, staffToken }) => {
    await Promise.allSettled(
      activeSessions.map(({ sessionId }) => closeSession(request, staffToken, sessionId)),
    );
    activeSessions = [];
  });

  async function setupSessions(
    request: Parameters<typeof openSession>[0],
    token:   string,
    tables:  TableInfo[],
  ): Promise<TableSession[]> {
    const tablesToUse = tables.slice(0, Math.min(tables.length, 10));
    const sessions = await Promise.all(
      tablesToUse.map(async (t) => {
        const status = await getSessionStatus(request, t.id);
        if (status.open) return null; // Skip already-open tables.
        const s = await openSession(request, token, t.id, GUESTS_PER_TABLE);
        return { tableId: t.id, tableName: t.name, sessionId: s.session_id } as TableSession;
      }),
    );
    return sessions.filter(Boolean) as TableSession[];
  }

  test('40 concurrent orders land without duplicates', async ({ request, staffToken, tables, menuItemId }) => {
    activeSessions = await setupSessions(request, staffToken, tables);
    if (!activeSessions.length) {
      test.skip(true, 'No available tables to open sessions on.');
      return;
    }

    const ordersToPlace: Array<{
      sessionId:  string;
      guestName:  string;
      guestPhone: string;
    }> = [];

    for (const { sessionId } of activeSessions) {
      for (let g = 0; g < GUESTS_PER_TABLE; g++) {
        ordersToPlace.push({
          sessionId,
          guestName:  `RushGuest_${sessionId.slice(0, 4)}_${g}`,
          guestPhone: `98${String(g).padStart(8, '0')}`,
        });
      }
    }

    // orderLimiter on the backend allows 20 req/min per IP.
    // Send in batches of 15 with a 2s gap to stay under the limit.
    const BATCH = 15;
    const results: PromiseSettledResult<{ ok: boolean; order_id: string; total: number }>[] = [];
    for (let i = 0; i < ordersToPlace.length; i += BATCH) {
      const batch = ordersToPlace.slice(i, i + BATCH);
      const batchResults = await Promise.allSettled(
        batch.map(({ sessionId, guestName, guestPhone }) =>
          placeDineInOrder(request, sessionId, guestName, guestPhone, [
            { menu_item_id: menuItemId, quantity: 1 },
          ]),
        ),
      );
      results.push(...batchResults);
      if (i + BATCH < ordersToPlace.length) {
        await new Promise(r => setTimeout(r, 2_000));
      }
    }

    const succeeded = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      ok: boolean;
      order_id: string;
      total: number;
    }>[];

    // All order_ids must be unique — no duplicate UUIDs.
    const ids = succeeded.map((r) => r.value.order_id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);

    // Failure rate must be < 5%.
    const failureRate = (results.length - succeeded.length) / results.length;
    expect(failureRate, `Failure rate too high: ${(failureRate * 100).toFixed(1)}%`).toBeLessThan(0.05);
  });

  test('all placed orders appear in session order feeds', async ({
    request,
    staffToken,
    tables,
    menuItemId,
  }) => {
    activeSessions = await setupSessions(request, staffToken, tables);
    if (!activeSessions.length) {
      test.skip(true, 'No available tables.');
      return;
    }

    // Place one order per session.
    const placed = await Promise.all(
      activeSessions.map(({ sessionId }, i) =>
        placeDineInOrder(request, sessionId, `CheckGuest${i}`, `9100000${i}00`, [
          { menu_item_id: menuItemId, quantity: 1 },
        ]),
      ),
    );

    const allOrderIds = new Set(placed.map((p) => p.order_id));

    // Retrieve all session feeds and verify orders are present.
    for (const { sessionId } of activeSessions) {
      const { orders } = await getSessionOrders(request, sessionId);
      for (const order of orders) {
        allOrderIds.delete(order.order_id);
      }
    }

    expect(
      allOrderIds.size,
      `These order IDs were not found in any session feed: ${[...allOrderIds].join(', ')}`,
    ).toBe(0);
  });

  test('rapid add-remove cart actions do not produce duplicate orders (UI smoke)', async ({
    browser,
    request,
    staffToken,
    firstTableId,
    menuItemId,
  }) => {
    const status = await getSessionStatus(request, firstTableId);
    let sessionId = status.session_id;
    let opened = false;

    if (!status.open) {
      const s = await openSession(request, staffToken, firstTableId);
      sessionId = s.session_id;
      opened = true;
      activeSessions.push({ tableId: firstTableId, tableName: 'T1', sessionId: s.session_id });
    }

    // Simulate a guest rapidly toggling cart items before placing one order.
    const ctx  = await browser.newContext();
    const page = await ctx.newPage();

    try {
      const { CustomerPage } = await import('../../fixtures/pages');
      const customer = new CustomerPage(page);
      await customer.gotoTable(firstTableId);
      await customer.submitGuestIdentity('RapidClicker', '9200000001');
      await customer.waitForOrderingScreen();

      // Rapidly click add 3× then remove 2× to simulate indecisive guest.
      const addBtn = page.locator('[data-action="add-item"]').first();
      for (let i = 0; i < 3; i++) await addBtn.click({ delay: 50 });
      const minusBtn = page.locator('[data-action="remove-item"], .qty-minus').first();
      for (let i = 0; i < 2; i++) {
        try { await minusBtn.click({ delay: 50, timeout: 1_000 }); } catch { break; }
      }

      await customer.goToCheckout();
      await customer.placeOrder();

      // Confirm only one order placed for this guest.
      const { orders } = await getSessionOrders(request, sessionId!);
      const myOrders = orders.filter((o) => o.guest_name === 'RapidClicker');
      expect(myOrders.length).toBe(1);
    } finally {
      await ctx.close();
    }
  });
});
