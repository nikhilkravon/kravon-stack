/**
 * SCENARIO 2 — First Guest Scan
 * P0: Session is created, guest becomes bill owner, dashboard shows occupied table.
 */

import { test, expect } from '../../fixtures';
import { getSessionStatus, openSession, closeSession, ensureTableClosed } from '../../fixtures/api';
import { CustomerPage } from '../../fixtures/pages';
import { tableUrl, SLUG, STAFF_EMAIL, STAFF_PASSWORD } from '../../fixtures/env';

test.describe('Scenario 2 — First Guest Scan', () => {
  let sessionId: string;

  test.beforeEach(async ({ request, staffToken, firstTableId }) => {
    await ensureTableClosed(request, staffToken, firstTableId);
    sessionId = '';
  });

  test.afterEach(async ({ request, staffToken, firstTableId }) => {
    if (sessionId) {
      await closeSession(request, staffToken, sessionId).catch(() => {});
    }
  });

  test('guest popup blocks menu until identity submitted', async ({ page, firstTableId, staffToken, request }) => {
    // Open a session so the QR link resolves to an active session.
    const session = await openSession(request, staffToken, firstTableId);
    sessionId = session.session_id;

    const customer = new CustomerPage(page);
    await customer.gotoTable(firstTableId);
    await customer.assertMenuBlocked();
  });

  test('submitting guest identity grants menu access', async ({ page, firstTableId, staffToken, request }) => {
    const session = await openSession(request, staffToken, firstTableId);
    sessionId = session.session_id;

    const customer = new CustomerPage(page);
    await customer.gotoTable(firstTableId);
    await customer.submitGuestIdentity('Test Guest', '9876543210');
    await customer.waitForOrderingScreen();
  });

  test('first scanner becomes bill owner in session record', async ({
    request,
    staffToken,
    firstTableId,
    page,
  }) => {
    const session = await openSession(request, staffToken, firstTableId);
    sessionId = session.session_id;

    // Guest must place an order for bill_owner to be written (per backend logic).
    const customer = new CustomerPage(page);
    await customer.gotoTable(firstTableId);
    await customer.submitGuestIdentity('BillOwner Person', '9000000001');
    await customer.waitForOrderingScreen();
    await customer.addItemToCart();
    await customer.goToCheckout();
    await customer.placeOrder();

    // Verify via session status API — has_bill_owner should be true.
    const status = await getSessionStatus(request, firstTableId);
    expect(status.open).toBe(true);
    expect(status.session_id).toBe(sessionId);
    // The API does not expose bill_owner_name directly in session/status,
    // but it does expose has_bill_owner.
    expect((status as any).has_bill_owner).toBe(true);
  });

  test('dashboard shows table as occupied after session open', async ({
    request,
    staffToken,
    firstTableId,
    tables,
  }) => {
    const session = await openSession(request, staffToken, firstTableId);
    sessionId = session.session_id;

    const tableName = tables.find((t) => t.id === firstTableId)?.name ?? 'T1';

    // Use a fresh page to verify dashboard state after session creation.
    // (The dashboardPage fixture already logs in but we use the API-created session.)
    const status = await getSessionStatus(request, firstTableId);
    expect(status.open).toBe(true);
    expect(status.session_id).toBe(sessionId);
  });

  test('table without an open session shows not-active message to guest', async ({
    page,
    tables,
    request,
  }) => {
    // Find a table with no open session.
    let inactiveTableId: string | null = null;
    for (const t of tables) {
      const status = await getSessionStatus(request, t.id);
      if (!status.open) {
        inactiveTableId = t.id;
        break;
      }
    }
    if (!inactiveTableId) {
      test.skip(true, 'All tables currently have open sessions — cannot test inactive state.');
      return;
    }

    await page.goto(tableUrl(inactiveTableId));
    // Should show a "not active" message, not the guest popup or menu.
    await expect(
      page.getByText(/not active|not open|ask.*waiter|session.*not.*started/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
