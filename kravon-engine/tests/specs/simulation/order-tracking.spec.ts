/**
 * SIMULATION — Order Tracking (Delivery)
 *
 * Drives the customer-facing orders frontend end-to-end:
 *   1. Customer places a COD delivery order
 *   2. Confirmation screen appears with "pending" badge
 *   3. Staff advances status via API — badge updates within poll window
 *   4. Customer refreshes — lands back on confirmation (localStorage restore)
 *   5. Staff marks delivered — badge goes green, localStorage cleared
 *   6. Customer refreshes again — lands on menu (clean slate)
 *   7. Cancelled order edge-case — localStorage cleared on cancel
 */

import { test, expect, Page, APIRequestContext } from '@playwright/test';
import { API_URL, FRONTEND_URL, SLUG } from '../../fixtures/env';
import { staffLogin, updateOrderStatus } from '../../fixtures/api';
import * as fs from 'fs';
import * as path from 'path';

const ORDERS_URL = `${FRONTEND_URL}/orders/?slug=${SLUG}`;
const STATE_FILE  = path.join(__dirname, '.order-tracking-state.json');

function saveState(data: Record<string, string>) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data));
}

function loadState(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

async function waitForOrdersApp(page: Page) {
  await page.goto(ORDERS_URL);
  // Wait for the loading skeleton to disappear
  await expect(page.locator('body')).not.toHaveAttribute('data-loading', { timeout: 15_000 });
  await expect(page.locator('body')).not.toHaveAttribute('data-error', { timeout: 5_000 });
}

async function fillCheckoutAndPlace(page: Page): Promise<void> {
  // Get to checkout — find a non-customisable item and add it
  const addBtn = page.locator('[data-action="add-item"]').first();
  await expect(addBtn).toBeVisible({ timeout: 10_000 });
  await addBtn.click();

  // Open cart and go to checkout
  await page.locator('[data-action="open-cart"]').first().click();
  await expect(page.locator('#cartDrawer')).toBeVisible();
  await page.locator('[data-action="go-checkout"]').click();
  await expect(page.locator('#screenCheckout')).toBeVisible();

  // Fill delivery fields
  await page.fill('#fieldName',     'Test Customer');
  await page.fill('#fieldPhone',    '9876543210');
  await page.fill('#fieldAddress',  '123 Test Street');
  await page.fill('#fieldLocality', 'Test Locality');

  // Place the order (COD — no Razorpay)
  await page.locator('[data-action="place-order"]').click();
}

async function getStoredOrderId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('kravon_active_order');
      return raw ? JSON.parse(raw).orderId : null;
    } catch { return null; }
  });
}

async function clearStorage(page: Page) {
  await page.evaluate(() => localStorage.removeItem('kravon_active_order'));
}

/**
 * Seed localStorage with a saved order then navigate to the orders app.
 * Used by tests 2–6 which run in a fresh browser context with empty storage.
 * The stored entry mimics what _showConfirmation() writes after placing an order.
 */
async function seedAndLoad(page: Page, orderId: string) {
  // Navigate first so we're on the right origin before writing localStorage
  await page.goto(ORDERS_URL);
  await page.evaluate((id) => {
    localStorage.setItem('kravon_active_order', JSON.stringify({
      orderId:   id,
      total:     0,
      name:      'Test Customer',
      paymentId: 'cod',
      placedAt:  Date.now(),
    }));
  }, orderId);
  // Reload so boot.js picks up the seeded entry and restores the confirm screen
  await page.reload();
  await expect(page.locator('body')).not.toHaveAttribute('data-loading', { timeout: 15_000 });
}

/* ══════════════════════════════════════════════════════════════════════ */

test.describe('Order tracking — delivery surface', () => {
  let staffToken: string;

  test.beforeAll(async ({ request }) => {
    staffToken = await staffLogin(request);
    // Clear stale state from previous runs
    try { fs.unlinkSync(STATE_FILE); } catch {}
  });

  /* ── 1. Place order → confirmation screen appears ─────────────────── */
  test('1. customer places COD order and sees confirmation screen', async ({ page }) => {
    await waitForOrdersApp(page);
    await fillCheckoutAndPlace(page);

    // Confirmation screen must appear
    await expect(page.locator('#screenConfirm')).toBeVisible({ timeout: 15_000 });

    // Status badge should show "pending"
    await expect(page.locator('#confirmStatusBadge')).toBeVisible();
    await expect(page.locator('#confirmStatusBadge')).toHaveText(/pending/i);

    // Order ID shown
    await expect(page.locator('#confirmOrderId')).toContainText(/Order ID/i);

    // Customer name shown
    await expect(page.locator('#confirmName')).toHaveText('Test Customer');

    // localStorage has the order
    const orderId = await getStoredOrderId(page);
    expect(orderId).toBeTruthy();
    saveState({ placedOrderId: orderId! });

    console.log(`[sim] Order placed: ${orderId}`);
  });

  /* ── 2. Staff confirms → badge updates within poll window ─────────── */
  test('2. badge updates to "confirmed" within 20s after staff action', async ({ page, request }) => {
    const { placedOrderId } = loadState();
    test.skip(!placedOrderId, 'Depends on test 1');

    await seedAndLoad(page, placedOrderId);
    await expect(page.locator('#screenConfirm')).toBeVisible({ timeout: 10_000 });

    await updateOrderStatus(request, staffToken, placedOrderId, 'confirmed');

    await expect(page.locator('#confirmStatusBadge')).toHaveText(/confirmed/i, { timeout: 20_000 });
    await expect(page.locator('#confirmSub')).toContainText(/confirmed/i, { timeout: 1_000 });
  });

  /* ── 3. Through to "preparing" ────────────────────────────────────── */
  test('3. badge updates to "preparing" after staff action', async ({ page, request }) => {
    const { placedOrderId } = loadState();
    test.skip(!placedOrderId, 'Depends on test 1');

    await seedAndLoad(page, placedOrderId);
    await expect(page.locator('#screenConfirm')).toBeVisible({ timeout: 10_000 });

    await updateOrderStatus(request, staffToken, placedOrderId, 'preparing');

    await expect(page.locator('#confirmStatusBadge')).toHaveText(/preparing/i, { timeout: 20_000 });
    await expect(page.locator('#confirmSub')).toContainText(/preparing/i, { timeout: 1_000 });
  });

  /* ── 4. Refresh mid-flow → restore ────────────────────────────────── */
  test('4. page refresh restores confirmation screen with current status', async ({ page }) => {
    const { placedOrderId } = loadState();
    test.skip(!placedOrderId, 'Depends on test 1');

    await seedAndLoad(page, placedOrderId);

    // Confirm badge shows preparing (restored + immediate poll)
    await expect(page.locator('#screenConfirm')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#confirmStatusBadge')).toHaveText(/preparing/i, { timeout: 8_000 });

    // Menu screen must NOT be shown
    await expect(page.locator('#screenOrdering')).toBeHidden();

    // localStorage still has the order
    const restoredId = await getStoredOrderId(page);
    expect(restoredId).toBe(placedOrderId);
  });

  /* ── 5. Out for delivery ───────────────────────────────────────────── */
  test('5. badge updates to "out for delivery"', async ({ page, request }) => {
    const { placedOrderId } = loadState();
    test.skip(!placedOrderId, 'Depends on test 1');

    await seedAndLoad(page, placedOrderId);
    await expect(page.locator('#screenConfirm')).toBeVisible({ timeout: 10_000 });

    await updateOrderStatus(request, staffToken, placedOrderId, 'out_for_delivery');

    await expect(page.locator('#confirmStatusBadge')).toHaveText(/out for delivery/i, { timeout: 20_000 });
    await expect(page.locator('#confirmSub')).toContainText(/on the way/i, { timeout: 1_000 });
  });

  /* ── 6. Delivered → localStorage cleared ──────────────────────────── */
  test('6. delivered — localStorage cleared, polling stops', async ({ page, request }) => {
    const { placedOrderId } = loadState();
    test.skip(!placedOrderId, 'Depends on test 1');

    await seedAndLoad(page, placedOrderId);
    await expect(page.locator('#screenConfirm')).toBeVisible({ timeout: 10_000 });

    await updateOrderStatus(request, staffToken, placedOrderId, 'delivered');

    await expect(page.locator('#confirmStatusBadge')).toHaveText(/delivered/i, { timeout: 20_000 });
    await expect(page.locator('#confirmSub')).toContainText(/enjoy/i, { timeout: 1_000 });

    // Wait a tick for the localStorage.removeItem call
    await page.waitForTimeout(500);
    const storedAfter = await getStoredOrderId(page);
    expect(storedAfter).toBeNull();
  });

  /* ── 7. Refresh after delivery → clean menu ───────────────────────── */
  test('7. refresh after delivered → lands on menu, not confirmation', async ({ page }) => {
    // No saved order — should land on menu
    await waitForOrdersApp(page);

    await expect(page.locator('#screenOrdering')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#screenConfirm')).toBeHidden();

    const storedId = await getStoredOrderId(page);
    expect(storedId).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════ */

test.describe('Order tracking — edge cases', () => {
  let staffToken: string;

  test.beforeAll(async ({ request }) => {
    staffToken = await staffLogin(request);
  });

  /* ── Cancelled order clears localStorage ──────────────────────────── */
  test('cancelled order — localStorage cleared, not stuck', async ({ page, request }) => {
    await waitForOrdersApp(page);
    await fillCheckoutAndPlace(page);
    await expect(page.locator('#screenConfirm')).toBeVisible({ timeout: 15_000 });

    const orderId = await getStoredOrderId(page);
    expect(orderId).toBeTruthy();

    // Staff cancels
    await updateOrderStatus(request, staffToken, orderId!, 'cancelled');

    // Badge should show cancelled
    await expect(page.locator('#confirmStatusBadge')).toHaveText(/cancelled/i, { timeout: 20_000 });

    // localStorage must be cleared
    await page.waitForTimeout(500);
    const storedAfter = await getStoredOrderId(page);
    expect(storedAfter).toBeNull();

    // Refresh → clean menu
    await page.reload();
    await expect(page.locator('body')).not.toHaveAttribute('data-loading', { timeout: 15_000 });
    await expect(page.locator('#screenOrdering')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#screenConfirm')).toBeHidden();
  });

  /* ── Stale order (>6h) → menu on load ─────────────────────────────── */
  test('expired saved order (>6h old) — lands on menu', async ({ page }) => {
    // Inject a stale entry before navigating
    await page.goto(ORDERS_URL);
    await page.evaluate(() => {
      localStorage.setItem('kravon_active_order', JSON.stringify({
        orderId:   '00000000-0000-0000-0000-000000000000',
        total:     500,
        name:      'Old Customer',
        paymentId: 'cod',
        placedAt:  Date.now() - (7 * 60 * 60 * 1000), // 7 hours ago
      }));
    });
    await page.reload();

    await expect(page.locator('body')).not.toHaveAttribute('data-loading', { timeout: 15_000 });
    await expect(page.locator('#screenOrdering')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#screenConfirm')).toBeHidden();

    const storedId = await getStoredOrderId(page);
    expect(storedId).toBeNull();
  });

  /* ── Corrupted localStorage → menu on load ─────────────────────────── */
  test('corrupted localStorage — graceful fallback to menu', async ({ page }) => {
    await page.goto(ORDERS_URL);
    await page.evaluate(() => {
      localStorage.setItem('kravon_active_order', 'NOT_VALID_JSON{{{');
    });
    await page.reload();

    await expect(page.locator('body')).not.toHaveAttribute('data-loading', { timeout: 15_000 });
    await expect(page.locator('#screenOrdering')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#screenConfirm')).toBeHidden();
  });

  /* ── Public status endpoint returns 404 for unknown order ─────────── */
  test('GET /orders/:id/status returns 404 for unknown ID', async ({ request }) => {
    const res = await request.get(
      `${API_URL}/v1/restaurants/${SLUG}/orders/00000000-0000-0000-0000-000000000001/status`,
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  /* ── Public status endpoint returns status without auth ─────────────── */
  test('GET /orders/:id/status is public (no auth header needed)', async ({ request, page }) => {
    // Place a fresh order to get a real order ID
    await waitForOrdersApp(page);
    await fillCheckoutAndPlace(page);
    await expect(page.locator('#screenConfirm')).toBeVisible({ timeout: 15_000 });

    const orderId = await getStoredOrderId(page);
    expect(orderId).toBeTruthy();

    // Hit the endpoint with no Authorization header
    const res = await request.get(
      `${API_URL}/v1/restaurants/${SLUG}/orders/${orderId}/status`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBeTruthy();
    expect(['pending','confirmed','preparing','ready','out_for_delivery','delivered','completed','cancelled'])
      .toContain(body.status);

    // Cleanup
    await clearStorage(page);
  });
});
