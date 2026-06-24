/**
 * Page-object helpers — thin wrappers around Playwright locators.
 * Each class represents one distinct screen or interface.
 *
 * All selectors are derived from the actual rendered HTML of the app.
 */

import { Page, expect } from '@playwright/test';
import { DASHBOARD_URL, tableUrl } from './env';

/* ─────────────────────────── Customer: Tables UI ─────────────────────── */

export class CustomerPage {
  constructor(public readonly page: Page) {}

  async gotoTable(tableId: string) {
    await this.page.goto(tableUrl(tableId), { waitUntil: 'domcontentloaded', timeout: 20_000 });
  }

  async submitGuestIdentity(name: string, phone: string) {
    // Real IDs: #guestName, #guestPhone, #guestPopupBtn inside #guest-popup-overlay
    await expect(this.page.locator('#guestName')).toBeVisible({ timeout: 25_000 });
    await this.page.locator('#guestName').fill(name);
    await this.page.locator('#guestPhone').fill(phone);
    await this.page.locator('#guestPopupBtn').click();
  }

  async waitForOrderingScreen() {
    // Real screen ID: #screenOrdering
    await expect(this.page.locator('#screenOrdering')).toBeVisible({ timeout: 15_000 });
  }

  async addItemToCart() {
    // Non-customisable items render: <button class="add-btn" data-action="add-item" …>
    await this.page.locator('[data-action="add-item"]').first().click();
  }

  async goToCheckout() {
    // Mobile cart bar button: data-action="go-checkout"  (inside cart drawer)
    // First open the cart drawer via navCartBtn, then click go-checkout.
    // #navCartBtn appears in all three screens; scope to #screenOrdering to avoid strict-mode violation.
    await this.page.locator('#screenOrdering #navCartBtn').click();
    await expect(this.page.locator('[data-action="go-checkout"]')).toBeVisible({ timeout: 5_000 });
    await this.page.locator('[data-action="go-checkout"]').click();
    await expect(this.page.locator('#screenCheckout')).toBeVisible({ timeout: 8_000 });
  }

  async placeOrder() {
    await this.page.locator('[data-action="place-order"]').click();
    await expect(this.page.locator('#screenConfirm')).toBeVisible({ timeout: 15_000 });
  }

  async requestBill() {
    // Two possible sources: #requestBillBarBtn (ordering screen) or #billRequestBtn (confirm screen)
    const barBtn     = this.page.locator('#requestBillBarBtn');
    const confirmBtn = this.page.locator('#billRequestBtn');
    try {
      await expect(barBtn).toBeVisible({ timeout: 3_000 });
      await barBtn.click();
      return;
    } catch { /* not on ordering screen */ }
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();
  }

  async assertMenuBlocked() {
    await expect(this.page.locator('#guest-popup-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(this.page.locator('#screenOrdering')).not.toBeVisible();
  }

  async assertOrdersVisible() {
    // #tableOrdersPanel becomes visible once orders are fetched (initial load or 30s poll)
    await expect(this.page.locator('#tableOrdersPanel')).toBeVisible({ timeout: 35_000 });
  }

  async assertSessionClosedBanner() {
    await expect(this.page.locator('#sessionClosedBanner')).toBeVisible({ timeout: 35_000 });
  }

  async isBillRequestDisabled(): Promise<boolean> {
    const barBtn     = this.page.locator('#requestBillBarBtn');
    const confirmBtn = this.page.locator('#billRequestBtn');
    for (const btn of [barBtn, confirmBtn]) {
      try {
        await expect(btn).toBeVisible({ timeout: 2_000 });
        return (await btn.isDisabled()) || (await btn.getAttribute('disabled')) !== null;
      } catch { /* not visible */ }
    }
    return true; // neither button visible → request already handled
  }

  async getConfirmedOrderId(): Promise<string | null> {
    try {
      await expect(this.page.locator('#confirmOrderId')).toBeVisible({ timeout: 10_000 });
      return this.page.locator('#confirmOrderId').textContent();
    } catch {
      return null;
    }
  }
}

/* ─────────────────────────── Staff: Dashboard ────────────────────────── */

export class DashboardPage {
  constructor(public readonly page: Page) {}

  async login(slug: string, email: string, password: string) {
    // Strategy:
    // 1. Call the login API via page.request so the HttpOnly RT cookie is set
    //    in the browser context's cookie jar for 127.0.0.1:3000.
    // 2. Inject localStorage keys via addInitScript so they are present on the
    //    very first DOMContentLoaded of the dashboard page — before app.js runs.
    // 3. Navigate once. App.start() → Auth.isLoggedIn() = true → _showDashboard().
    //
    // We must NOT do a two-navigation sequence (goto → goto) because if both
    // URLs share the same path+query and differ only in hash, the second goto
    // is treated as a same-document navigation (no page reload, no DOMContentLoaded).
    const apiBase = process.env.KRAVON_API_URL || 'http://127.0.0.1:3000';

    // Step 1: get login token + set RT cookie without loading any page.
    const res = await this.page.request.post(`${apiBase}/v1/auth/login`, {
      data: { slug, email, password },
    });
    if (!res.ok()) {
      throw new Error(`Login API call failed: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();

    // Step 2: inject localStorage before the page runs any JS.
    await this.page.addInitScript(
      ({ slug, staff }: { slug: string; staff: object }) => {
        localStorage.setItem('krv_slug',  slug);
        localStorage.setItem('krv_staff', JSON.stringify(staff));
      },
      { slug, staff: body.staff },
    );

    // Step 3: one navigation — app boots with Auth.isLoggedIn() = true.
    await this.page.goto(DASHBOARD_URL);
    await expect(this.page.locator('#dashboard')).toBeVisible({ timeout: 15_000 });
  }

  async goToTablesView() {
    // Wait for OverviewView's async init to fully settle before navigating to tables.
    // OverviewView.init() makes 3 parallel API calls; it re-sets el.innerHTML when
    // the Promise.all resolves. If we change the hash while still in-flight, the
    // resolve overwrites the tables grid. "Tonight" only renders post-API-call.
    await this.page.waitForFunction(
      () => document.querySelector('#dash-content')?.textContent?.includes('Revenue'),
      { timeout: 12_000 },
    );

    // Trigger a same-document hash navigation so hashchange fires and App routes
    // to TablesView — no full page reload, access token stays in memory.
    await this.page.evaluate(() => { location.hash = '#tables'; });
    // #tables-grid is injected synchronously by TablesView.init(); cards are async.
    await expect(this.page.locator('#tables-grid')).toBeVisible({ timeout: 10_000 });
    await expect(this.page.locator('.table-card').first()).toBeVisible({ timeout: 15_000 });
  }

  async assertTableOccupied(tableName: string) {
    const card = this.page.locator('.table-card', { hasText: tableName }).first();
    // Occupied cards have class table-card--occupied and a "Close session" button
    await expect(card).toHaveClass(/table-card--occupied/, { timeout: 10_000 });
  }

  async assertTableAvailable(tableName: string) {
    const card = this.page.locator('.table-card', { hasText: tableName }).first();
    await expect(card).toHaveClass(/table-card--available/, { timeout: 10_000 });
  }

  async closeSessionForTable(tableName: string) {
    const card = this.page.locator('.table-card', { hasText: tableName }).first();
    await card.locator('[data-action="close-session"]').click();

    const dialog = this.page.locator('[role="dialog"], .modal').last();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: /confirm|yes|close/i }).last().click();

    await expect(card).toHaveClass(/table-card--available/, { timeout: 8_000 });
  }

  async assertBillRequestBadge(tableName: string) {
    const card = this.page.locator('.table-card', { hasText: tableName }).first();
    await expect(card.locator('.bill-requested-alert')).toBeVisible({ timeout: 8_000 });
  }

  async billRequestBadgeCount(): Promise<number> {
    return this.page.locator('.bill-requested-alert').count();
  }

  async viewBill(tableName: string): Promise<string> {
    const card = this.page.locator('.table-card', { hasText: tableName }).first();
    await card.locator('[data-action="view-bill"]').click();

    const modal = this.page.locator('[role="dialog"], .modal').last();
    await expect(modal).toBeVisible({ timeout: 8_000 });

    const total = modal.locator('.cart-total-val, .grand-total, [data-grand-total], .total-row').last();
    return (await total.textContent()) || '';
  }

  async refresh() {
    // Force TablesView to reload: navigate away to #overview first (so the hash
    // actually changes), then back to #tables — this fires two hashchange events
    // and ensures _load() runs with fresh data. No page reload, token stays in memory.
    await this.page.evaluate(() => { location.hash = '#overview'; });
    // Wait for OverviewView to fully settle before navigating away (prevents race condition
    // where Overview's async Promise.all resolves after we switch to #tables).
    await this.page.waitForFunction(
      () => document.querySelector('#dash-content')?.textContent?.includes('Revenue'),
      { timeout: 12_000 },
    ).catch(() => { /* overview may not have revenue if no orders; proceed anyway */ });
    await this.page.evaluate(() => { location.hash = '#tables'; });
    await expect(this.page.locator('#tables-grid')).toBeVisible({ timeout: 10_000 });
    await expect(this.page.locator('.table-card').first()).toBeVisible({ timeout: 15_000 });
  }

  async updateOrderStatus(tableName: string, guestName: string, newStatus: string) {
    const card     = this.page.locator('.table-card', { hasText: tableName }).first();
    const orderRow = card.locator('.session-order-row, .order-row, [data-order]', { hasText: guestName }).first();
    await orderRow.getByRole('button', { name: new RegExp(newStatus, 'i') }).click();
  }
}
