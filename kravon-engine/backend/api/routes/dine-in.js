/**
 * ROUTE — dine-in.js
 * POST /v1/restaurants/:slug/dine-in/session/open    (staff JWT)
 * POST /v1/restaurants/:slug/dine-in/session/close   (staff JWT)
 * GET  /v1/restaurants/:slug/dine-in/session/status  (public — customer QR scan)
 * POST /v1/restaurants/:slug/dine-in/order           (public — customer QR order)
 * GET  /v1/restaurants/:slug/dine-in/kitchen         (staff JWT)
 * GET  /v1/restaurants/:slug/dine-in/bill            (staff JWT)
 *
 * Flow:
 *   Staff opens session → customer scans QR → checks /session/status → places /order
 *   Staff monitors /kitchen → closes session via /session/close → /bill for printout
 *
 * Race conditions:
 *   The partial unique index uidx_sessions_table_open(table_id) WHERE closed_at IS NULL
 *   prevents two concurrent open sessions on the same table at the DB level.
 *   Application-level pre-checks exist only for friendly error messages.
 *
 * Monetary units:
 *   orders.total_amount   — paise (INT), consistent with the rest of the orders table
 *   dining.sessions.total_billed — decimal rupees (NUMERIC), set on session close
 */

'use strict';

const express             = require('express');
const { z }               = require('zod');
const { query, getClient } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

/* ── POST /session/open ─────────────────────────────────────────────────── */
const OpenSessionSchema = z.object({
  table_id: z.string().uuid(),
  covers:   z.number().int().min(1).max(50).optional(),
});

router.post('/session/open', requireRestaurantAuth, async (req, res, next) => {
  const parsed = OpenSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { table_id, covers } = parsed.data;
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Verify table belongs to this tenant
    const tableRes = await client.query(
      `SELECT id FROM dining.tables
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [table_id, tenant_id]
    );
    if (!tableRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Table not found.' });
    }

    // Pre-check for a friendly 409 — the partial unique index is the real guard
    const openCheck = await client.query(
      `SELECT id FROM dining.sessions
       WHERE table_id = $1 AND closed_at IS NULL AND deleted_at IS NULL`,
      [table_id]
    );
    if (openCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Table already has an open session.' });
    }

    const sessionRes = await client.query(
      `INSERT INTO dining.sessions (tenant_id, table_id, covers, opened_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, opened_at`,
      [tenant_id, table_id, covers ?? null]
    );

    await client.query(
      `UPDATE dining.tables SET status = 'occupied', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [table_id, tenant_id]
    );

    await client.query('COMMIT');
    const { id: session_id, opened_at } = sessionRes.rows[0];
    res.status(201).json({ ok: true, session_id, table_id, opened_at });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/* ── POST /session/close ────────────────────────────────────────────────── */
const CloseSessionSchema = z.object({
  session_id: z.string().uuid(),
});

router.post('/session/close', requireRestaurantAuth, async (req, res, next) => {
  const parsed = CloseSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { session_id } = parsed.data;
  const rest_id = req.tenant.rest_id;
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Compute total from all non-cancelled orders on this session
    const totalRes = await client.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM orders
       WHERE session_id = $1 AND rest_id = $2
         AND status NOT IN ('cancelled', 'refunded')`,
      [session_id, rest_id]
    );
    const totalPaise  = parseInt(totalRes.rows[0].total, 10);
    const totalRupees = totalPaise / 100;

    // Close session — guards: tenant ownership + not already closed
    const closeRes = await client.query(
      `UPDATE dining.sessions
       SET closed_at = NOW(), total_billed = $1
       WHERE id = $2 AND tenant_id = $3 AND closed_at IS NULL
       RETURNING closed_at, table_id`,
      [totalRupees, session_id, tenant_id]
    );
    if (!closeRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Session already closed or not found.' });
    }

    const { closed_at, table_id } = closeRes.rows[0];

    await client.query(
      `UPDATE dining.tables SET status = 'available', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [table_id, tenant_id]
    );

    await client.query('COMMIT');
    res.json({ ok: true, session_id, closed_at, total_billed: totalRupees });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/* ── GET /session/status?table_id=xxx ──────────────────────────────────── */
// Public — called by customer QR scan to check if their table has an active session.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/session/status', async (req, res, next) => {
  const { table_id } = req.query;
  if (!table_id || !UUID_RE.test(table_id)) {
    return res.status(400).json({ error: 'table_id query param (UUID) is required.' });
  }
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  try {
    // Tenant check: table must belong to this restaurant
    const tableCheck = await query(
      `SELECT id FROM dining.tables WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [table_id, tenant_id]
    );
    if (!tableCheck.rows.length) {
      return res.status(404).json({ error: 'Table not found.' });
    }

    const result = await query(
      `SELECT s.id, s.opened_at, s.covers, t.name AS table_name
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       WHERE s.table_id = $1
         AND s.tenant_id  = $2
         AND s.closed_at   IS NULL
         AND s.deleted_at  IS NULL
       LIMIT 1`,
      [table_id, tenant_id]
    );

    if (!result.rows.length) {
      return res.json({ open: false });
    }

    const { id: session_id, opened_at, covers, table_name } = result.rows[0];
    res.json({ open: true, session_id, table_name, opened_at, covers });
  } catch (err) {
    next(err);
  }
});

/* ── POST /order ────────────────────────────────────────────────────────── */
// Public — customer places order against an active session.
const DineInOrderSchema = z.object({
  session_id:    z.string().uuid(),
  items: z.array(z.object({
    menu_item_id:   z.number().int().positive(),
    quantity:       z.number().int().min(1).max(20),
    customizations: z.string().max(500).optional(),
  })).min(1).max(30),
  special_notes: z.string().max(500).optional(),
});

router.post('/order', async (req, res, next) => {
  const parsed = DineInOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { session_id, items, special_notes } = parsed.data;
  const rest_id = req.tenant.rest_id;
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  try {
    // Verify session is open and belongs to this tenant
    const sessionRes = await query(
      `SELECT id FROM dining.sessions
       WHERE id = $1 AND tenant_id = $2 AND closed_at IS NULL AND deleted_at IS NULL`,
      [session_id, tenant_id]
    );
    if (!sessionRes.rows.length) {
      return res.status(409).json({ error: 'Session is closed or not found.' });
    }

    // Server-side price verification — never trust client prices
    const itemIds = items.map(i => i.menu_item_id);
    const dbItems = await query(
      `SELECT id, name, price_paise FROM menu_items
       WHERE rest_id = $1 AND id = ANY($2) AND active = TRUE`,
      [rest_id, itemIds]
    );
    const priceMap = new Map(dbItems.rows.map(r => [r.id, r]));

    for (const item of items) {
      if (!priceMap.has(item.menu_item_id)) {
        return res.status(400).json({ error: `Item ${item.menu_item_id} not found or unavailable.` });
      }
    }

    // Build items_json (price stored in rupees to match existing orders shape)
    let subtotalPaise = 0;
    const itemsJson = items.map(item => {
      const db = priceMap.get(item.menu_item_id);
      subtotalPaise += db.price_paise * item.quantity;
      return {
        id:     db.id,
        name:   db.name,
        price:  db.price_paise / 100,
        qty:    item.quantity,
        note:   item.customizations ?? null,
        addons: [],
      };
    });

    const orderRes = await query(
      `INSERT INTO orders (
         rest_id, order_surface, session_id,
         items_json, special_notes,
         subtotal, delivery_fee, total_amount,
         payment_method, payment_status, status
       ) VALUES ($1, 'dine_in', $2, $3, $4, $5, 0, $5, 'offline', 'pending', 'confirmed')
       RETURNING id`,
      [rest_id, session_id, JSON.stringify(itemsJson), special_notes ?? null, subtotalPaise]
    );

    res.status(201).json({ ok: true, order_id: orderRes.rows[0].id, total_paise: subtotalPaise });
  } catch (err) {
    next(err);
  }
});

/* ── GET /kitchen ───────────────────────────────────────────────────────── */
// All open sessions with their active (non-cancelled) orders for the kitchen display.
router.get('/kitchen', requireRestaurantAuth, async (req, res, next) => {
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  try {
    const result = await query(
      `SELECT
         t.name        AS table_name,
         s.id          AS session_id,
         s.opened_at,
         s.covers,
         json_agg(
           json_build_object(
             'order_id',   o.id,
             'status',     o.status,
             'created_at', o.created_at,
             'items',      o.items_json
           ) ORDER BY o.created_at
         ) FILTER (WHERE o.id IS NOT NULL) AS orders
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       LEFT JOIN orders o
         ON  o.session_id = s.id
         AND o.status IN ('pending', 'confirmed', 'preparing')
         AND o.deleted_at IS NULL
       WHERE s.tenant_id    = $1
         AND s.closed_at  IS NULL
         AND s.deleted_at IS NULL
       GROUP BY t.name, s.id, s.opened_at, s.covers
       ORDER BY s.opened_at ASC`,
      [tenant_id]
    );
    res.json({ ok: true, tables: result.rows });
  } catch (err) {
    next(err);
  }
});

/* ── GET /bill?session_id=xxx ───────────────────────────────────────────── */
// Full itemised bill for a session — used before closing or for receipt printout.
router.get('/bill', requireRestaurantAuth, async (req, res, next) => {
  const { session_id } = req.query;
  if (!session_id || !UUID_RE.test(session_id)) {
    return res.status(400).json({ error: 'session_id query param (UUID) is required.' });
  }
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  try {
    const result = await query(
      `SELECT
         s.id          AS session_id,
         t.name        AS table_name,
         s.covers,
         s.opened_at,
         s.closed_at,
         json_agg(
           json_build_object(
             'order_id', o.id,
             'total',    o.total_amount,
             'items',    o.items_json
           )
         ) AS orders,
         SUM(o.total_amount) AS grand_total_paise
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       JOIN orders o
         ON  o.session_id = s.id
         AND o.status NOT IN ('cancelled', 'refunded')
         AND o.deleted_at IS NULL
       WHERE s.id       = $1
         AND s.tenant_id  = $2
       GROUP BY s.id, t.name, s.covers, s.opened_at, s.closed_at`,
      [session_id, tenant_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Session not found or has no billable orders.' });
    }

    res.json({ ok: true, bill: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
