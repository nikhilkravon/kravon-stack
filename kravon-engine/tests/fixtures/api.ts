/**
 * Thin HTTP client for direct backend calls from test code.
 * Used to set up and tear down state without going through the browser.
 */

import { APIRequestContext } from '@playwright/test';
import { API_URL, SLUG, STAFF_EMAIL, STAFF_PASSWORD } from './env';

export interface SessionInfo {
  session_id: string;
  table_id:   string;
  opened_at:  string;
}

export interface OrderItem {
  menu_item_id: string;
  quantity:     number;
  customizations?: string;
}

export interface TableInfo {
  id:       string;
  name:     string;
  capacity: number;
  qr_code:  string;
  session?: {
    id:              string;
    session_status:  string;
    bill_requested:  boolean;
    bill_owner:      string | null;
  };
}

/* ── Auth ─────────────────────────────────────────────────────────────── */

// Cached token — re-used across tests in the same worker to avoid rate-limiting.
let _cachedToken: string | null = null;
let _tokenFetchedAt = 0;
const TOKEN_TTL_MS = 12 * 60 * 1000; // 12 min (access token is 15 min)

export async function staffLogin(request: APIRequestContext): Promise<string> {
  if (_cachedToken && Date.now() - _tokenFetchedAt < TOKEN_TTL_MS) {
    return _cachedToken;
  }
  // Retry once on 429
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await request.post(`${API_URL}/v1/auth/login`, {
      data: { slug: SLUG, email: STAFF_EMAIL, password: STAFF_PASSWORD },
    });
    if (res.status() === 429 && attempt === 0) {
      await new Promise(r => setTimeout(r, 65_000)); // wait out the rate-limit window
      continue;
    }
    if (!res.ok()) {
      throw new Error(`Staff login failed: ${res.status()} ${await res.text()}`);
    }
    const body = await res.json();
    _cachedToken = body.accessToken as string;
    _tokenFetchedAt = Date.now();
    return _cachedToken!;
  }
  throw new Error('Staff login failed after retry');
}

/* ── Tables ───────────────────────────────────────────────────────────── */

export async function getTables(request: APIRequestContext, token: string): Promise<TableInfo[]> {
  const res = await request.get(`${API_URL}/v1/restaurants/${SLUG}/tables`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  return body.tables as TableInfo[];
}

/* ── Session lifecycle ────────────────────────────────────────────────── */

export async function openSession(
  request: APIRequestContext,
  token:   string,
  tableId: string,
  covers = 2,
): Promise<SessionInfo> {
  const res = await request.post(`${API_URL}/v1/restaurants/${SLUG}/dine-in/session/open`, {
    headers: { Authorization: `Bearer ${token}` },
    data:    { table_id: tableId, covers },
  });
  if (!res.ok()) {
    throw new Error(`openSession failed: ${res.status()} ${await res.text()}`);
  }
  return res.json() as Promise<SessionInfo>;
}

export async function closeSession(
  request: APIRequestContext,
  token:   string,
  sessionId: string,
): Promise<void> {
  const res = await request.post(`${API_URL}/v1/restaurants/${SLUG}/dine-in/session/close`, {
    headers: { Authorization: `Bearer ${token}` },
    data:    { session_id: sessionId },
  });
  if (!res.ok()) {
    const text = await res.text();
    // Treat "already closed" as a no-op during teardown.
    if (!text.includes('already')) {
      throw new Error(`closeSession failed: ${res.status()} ${text}`);
    }
  }
}

export async function getSessionStatus(
  request:   APIRequestContext,
  tableId:   string,
): Promise<{ open: boolean; session_id?: string; session_status?: string; bill_requested?: boolean }> {
  const res = await request.get(
    `${API_URL}/v1/restaurants/${SLUG}/dine-in/session/status?table_id=${tableId}`,
  );
  return res.json();
}

/** Close any open session on a table — no-op if already closed. */
export async function ensureTableClosed(
  request: APIRequestContext,
  token:   string,
  tableId: string,
): Promise<void> {
  const status = await getSessionStatus(request, tableId);
  if (status.open && status.session_id) {
    await closeSession(request, token, status.session_id).catch(() => {});
  }
}

export async function getSessionOrders(
  request:   APIRequestContext,
  sessionId: string,
): Promise<{ orders: Array<{ order_id: string; guest_name: string; status: string; items: unknown[] }> }> {
  const res = await request.get(
    `${API_URL}/v1/restaurants/${SLUG}/dine-in/session/orders?session_id=${sessionId}`,
  );
  return res.json();
}

export async function requestBill(
  request:     APIRequestContext,
  sessionId:   string,
  requestedBy: string,
): Promise<{ ok: boolean; bill_requested_at: string }> {
  const res = await request.post(
    `${API_URL}/v1/restaurants/${SLUG}/dine-in/session/request-bill`,
    { data: { session_id: sessionId, requested_by: requestedBy } },
  );
  return res.json();
}

/* ── Orders ───────────────────────────────────────────────────────────── */

export async function placeDineInOrder(
  request:    APIRequestContext,
  sessionId:  string,
  guestName:  string,
  guestPhone: string,
  items:      OrderItem[],
  notes = '',
): Promise<{ ok: boolean; order_id: string; total: number }> {
  const res = await request.post(
    `${API_URL}/v1/restaurants/${SLUG}/dine-in/order`,
    { data: { session_id: sessionId, guest_name: guestName, guest_phone: guestPhone, items, special_notes: notes } },
  );
  if (!res.ok()) {
    throw new Error(`placeDineInOrder failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

export async function updateOrderStatus(
  request:   APIRequestContext,
  token:     string,
  orderId:   string,
  status:    string,
): Promise<void> {
  const res = await request.patch(
    `${API_URL}/v1/restaurants/${SLUG}/orders/${orderId}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data:    { status },
    },
  );
  if (!res.ok()) {
    throw new Error(`updateOrderStatus failed: ${res.status()} ${await res.text()}`);
  }
}

/* ── Menu ─────────────────────────────────────────────────────────────── */

export async function getFirstAvailableItem(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API_URL}/v1/restaurants/${SLUG}/config`);
  const body = await res.json();
  const categories: Array<{ items: Array<{ id: string }> }> = body.config?.categories || [];
  for (const cat of categories) {
    if (cat.items?.length) return cat.items[0].id;
  }
  throw new Error('No menu items found in config — is the restaurant seeded?');
}
