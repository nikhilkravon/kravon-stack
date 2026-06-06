/**
 * ROUTE — dine-in.js
 * POST /v1/restaurants/:slug/dine-in/session/open    (staff JWT)
 * POST /v1/restaurants/:slug/dine-in/session/close   (staff JWT)
 * GET  /v1/restaurants/:slug/dine-in/session/status  (public — customer QR scan)
 * POST /v1/restaurants/:slug/dine-in/order           (public — customer QR order)
 * GET  /v1/restaurants/:slug/dine-in/kitchen         (staff JWT)
 * GET  /v1/restaurants/:slug/dine-in/bill            (staff JWT)
 * POST /v1/restaurants/:slug/dine-in/reservations    (public)
 *
 * All queries use v12 multi-schema: orders.orders, orders.order_items,
 * menu.menu_items, dining.sessions, dining.tables.
 * Money: NUMERIC(10,2) decimal rupees throughout.
 */

'use strict';

const express              = require('express');
const { z }                = require('zod');
const rateLimit            = require('express-rate-limit');
const { query, getClient } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');
const audit                = require('../../utils/audit');
const events               = require('../../utils/events');

const router = express.Router();

const publicDineInLimiter = rateLimit({
  keyGenerator: (req) => `${req.tenant?.tenant_id || 'unknown'}:${req.ip}`,
  max:      50,
  windowMs: 60000,
  message: { error: 'Too many requests. Please try again later.' }
});

const orderLimiter = rateLimit({
  keyGenerator: (req) => `${req.tenant?.tenant_id || 'unknown'}:${req.ip}`,
  max:      20,
  windowMs: 60000,
  message: { error: 'Too many orders. Please try again later.' }
});

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

    // FOR UPDATE locks the table row — prevents two concurrent opens on the same table.
    const tableRes = await client.query(
      `SELECT id FROM dining.tables
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [table_id, tenant_id]
    );
    if (!tableRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Table not found.' });
    }

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

    const { id: session_id, opened_at } = sessionRes.rows[0];
    await audit.log(client, {
      tenantId: tenant_id, actorId: req.auth?.staffId, actorType: 'staff',
      action: 'session.open', entityType: 'dining.session', entityId: session_id,
      newValue: { table_id, covers: covers ?? null }, req,
    });
    await client.query('COMMIT');
    events.emit('session.opened', { tenantId: tenant_id, sessionId: session_id, tableId: table_id, covers: covers ?? null });
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
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const totalRes = await client.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM orders.orders
       WHERE session_id = $1
         AND tenant_id  = $2
         AND status NOT IN ('cancelled', 'refunded')
         AND deleted_at IS NULL`,
      [session_id, tenant_id]
    );
    const totalRupees = parseFloat(totalRes.rows[0].total);

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

    await audit.log(client, {
      tenantId: tenant_id, actorId: req.auth?.staffId, actorType: 'staff',
      action: 'session.close', entityType: 'dining.session', entityId: session_id,
      newValue: { table_id, total_billed: totalRupees }, req,
    });
    await client.query('COMMIT');
    events.emit('session.closed', { tenantId: tenant_id, sessionId: session_id, tableId: table_id, totalBilled: totalRupees });
    res.json({ ok: true, session_id, closed_at, total_billed: totalRupees });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/* ── GET /session/status?table_id=xxx ──────────────────────────────────── */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get('/session/status', publicDineInLimiter, async (req, res, next) => {
  const { table_id } = req.query;
  if (!table_id || !UUID_RE.test(table_id)) {
    return res.status(400).json({ error: 'table_id query param (UUID) is required.' });
  }
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  try {
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
       WHERE s.table_id  = $1
         AND s.tenant_id = $2
         AND s.closed_at  IS NULL
         AND s.deleted_at IS NULL
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
const DineInOrderSchema = z.object({
  session_id:    z.string().uuid(),
  items: z.array(z.object({
    menu_item_id:   z.string().uuid(),
    quantity:       z.number().int().min(1).max(20),
    customizations: z.string().max(500).optional(),
  })).min(1).max(30),
  special_notes: z.string().max(500).optional(),
});

router.post('/order', publicDineInLimiter, orderLimiter, async (req, res, next) => {
  const parsed = DineInOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { session_id, items, special_notes } = parsed.data;
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const sessionRes = await client.query(
      `SELECT id FROM dining.sessions
       WHERE id = $1 AND tenant_id = $2 AND closed_at IS NULL AND deleted_at IS NULL`,
      [session_id, tenant_id]
    );
    if (!sessionRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Session is closed or not found.' });
    }

    const itemIds = items.map(i => i.menu_item_id);
    const dbItems = await client.query(
      `SELECT id, name, price FROM menu.menu_items
       WHERE tenant_id = $1 AND id = ANY($2) AND is_available = TRUE AND deleted_at IS NULL`,
      [tenant_id, itemIds]
    );
    const priceMap = new Map(dbItems.rows.map(r => [r.id, r]));

    for (const item of items) {
      if (!priceMap.has(item.menu_item_id)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Item ${item.menu_item_id} not found or unavailable.` });
      }
    }

    let subtotal = 0;
    const lineItems = items.map(item => {
      const db    = priceMap.get(item.menu_item_id);
      const price = parseFloat(db.price);
      subtotal   += price * item.quantity;
      return { id: db.id, name: db.name, price, qty: item.quantity, note: item.customizations ?? null };
    });

    const orderRes = await client.query(
      `INSERT INTO orders.orders (
         tenant_id, session_id, channel, fulfillment_type,
         status, subtotal_amount, tax_amount, total_amount,
         special_instructions, metadata
       ) VALUES ($1, $2, 'qr', 'dine_in', 'confirmed', $3, 0, $3, $4, '{}')
       RETURNING id`,
      [tenant_id, session_id, subtotal, special_notes ?? null]
    );
    const order_id = orderRes.rows[0].id;

    for (const line of lineItems) {
      const lineTotal = parseFloat((line.price * line.qty).toFixed(2));
      await client.query(
        `INSERT INTO orders.order_items (
           tenant_id, order_id, menu_item_id,
           item_name, unit_price, tax_rate, quantity,
           addons_total, total_price, special_note
         ) VALUES ($1, $2, $3, $4, $5, 0, $6, 0, $7, $8)`,
        [tenant_id, order_id, line.id, line.name, line.price, line.qty, lineTotal, line.note]
      );
    }

    await client.query('COMMIT');
    events.emit('dine_in.order_created', { tenantId: tenant_id, orderId: order_id, sessionId: session_id, total: subtotal });
    res.status(201).json({ ok: true, order_id, total: parseFloat(subtotal.toFixed(2)) });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/* ── POST /reservations ───────────────────────────────────────────────────── */
const ReservationSchema = z.object({
  customer_name:    z.string().min(1).max(100),
  customer_phone:   z.string().min(8).max(20),
  customer_email:   z.string().email().optional(),
  party_size:       z.number().int().min(1).max(50),
  // Client MUST include timezone offset, e.g. "2024-06-01T10:00:00+05:30"
  reservation_time: z.string().refine((val) => !Number.isNaN(new Date(val).getTime()), {
    message: 'reservation_time must be a valid ISO 8601 datetime with timezone offset',
  }),
  occasion:       z.string().max(150).optional(),
  dietary_notes:  z.string().max(500).optional(),
  table_id:       z.string().uuid().optional(),
});

function generateConfirmationCode() {
  return `R${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

router.post('/reservations', async (req, res, next) => {
  const parsed = ReservationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }

  const {
    customer_name, customer_phone, customer_email,
    party_size, reservation_time, occasion, dietary_notes, table_id,
  } = parsed.data;

  const tenant_id = req.tenant.tenant_id;
  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  // ── Reservation settings gate ──────────────────────────────────────────
  const resCfg = req.tenant.reservations || {};
  if (resCfg.accepts_reservations === false) {
    return res.status(409).json({ error: 'This restaurant is not currently accepting reservations.' });
  }

  const reservationAt = new Date(reservation_time);
  if (Number.isNaN(reservationAt.getTime())) {
    return res.status(400).json({ error: 'reservation_time is invalid.' });
  }

  // Advance window checks
  const nowMs          = Date.now();
  const maxAdvanceDays = resCfg.max_advance_days  ?? 30;
  const minAdvanceHrs  = resCfg.min_advance_hours ?? 2;
  const maxPartySize   = resCfg.max_party_size    ?? 12;

  if (reservationAt.getTime() < nowMs + minAdvanceHrs * 3600_000) {
    return res.status(400).json({ error: `Reservations must be made at least ${minAdvanceHrs} hour(s) in advance.` });
  }
  if (reservationAt.getTime() > nowMs + maxAdvanceDays * 86400_000) {
    return res.status(400).json({ error: `Reservations can only be made up to ${maxAdvanceDays} day(s) in advance.` });
  }
  if (party_size > maxPartySize) {
    return res.status(400).json({ error: `Maximum party size is ${maxPartySize}. Please call us for larger groups.` });
  }

  // Slot validation — only when slots are configured
  const slots = resCfg.slots || [];
  if (slots.length) {
    const dayOfWeek = reservationAt.getDay(); // 0=Sun, 6=Sat
    const hhmm      = `${String(reservationAt.getHours()).padStart(2, '0')}:${String(reservationAt.getMinutes()).padStart(2, '0')}`;
    const inSlot    = slots.some(s => s.day === dayOfWeek && hhmm >= s.open && hhmm < s.close);
    if (!inSlot) {
      return res.status(400).json({ error: 'The selected time is outside our reservation hours. Please choose a time within our available slots.' });
    }
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    let customer_id = null;
    if (customer_phone) {
      const upsertResult = await client.query(
        `INSERT INTO customer.customers (tenant_id, name, phone, email, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (tenant_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
         RETURNING id`,
        [tenant_id, customer_name, customer_phone, customer_email ?? null]
      );
      customer_id = upsertResult.rows[0].id;
    }

    let validatedTableId = null;
    if (table_id) {
      const tableRes = await client.query(
        `SELECT id FROM dining.tables
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [table_id, tenant_id]
      );
      if (!tableRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Table not found.' });
      }
      validatedTableId = table_id;
    }

    const confirmation_code = generateConfirmationCode();
    const reservationRes = await client.query(
      `INSERT INTO dining.reservations (
         tenant_id, location_id, customer_id, table_id,
         party_size, reservation_time, status, source,
         occasion, dietary_notes, confirmation_code,
         metadata, created_at, updated_at
       ) VALUES ($1, NULL, $2, $3, $4, $5, 'pending', 'presence', $6, $7, $8, '{}', NOW(), NOW())
       RETURNING id, confirmation_code`,
      [tenant_id, customer_id, validatedTableId, party_size, reservationAt.toISOString(), occasion ?? null, dietary_notes ?? null, confirmation_code]
    );

    await client.query('COMMIT');
    events.emit('reservation.created', {
      tenantId:        tenant_id,
      reservationId:   reservationRes.rows[0].id,
      partySize:       party_size,
      reservationTime: reservationAt.toISOString(),
    });
    res.status(201).json({
      ok: true,
      reservation_id:    reservationRes.rows[0].id,
      confirmation_code: reservationRes.rows[0].confirmation_code,
      status: 'pending',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/* ── GET /reservations (admin — paginated list) ─────────────────────────── */
router.get('/reservations', requireRestaurantAuth, async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const page     = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset   = (page - 1) * limit;
    const status   = req.query.status || null;

    const params  = [tenantId];
    const filters = ['r.tenant_id = $1', 'r.deleted_at IS NULL'];

    if (status === 'upcoming') {
      filters.push(`r.status IN ('pending','confirmed') AND r.reservation_time > NOW()`);
    } else if (status) {
      params.push(status);
      filters.push(`r.status = $${params.length}`);
    }

    const where = `WHERE ${filters.join(' AND ')}`;

    const [listRes, countRes] = await Promise.all([
      query(
        `SELECT r.id, r.party_size, r.reservation_time, r.status,
                r.occasion, r.dietary_notes, r.confirmation_code,
                r.source, r.created_at, r.table_id,
                c.name  AS customer_name,
                c.phone AS customer_phone,
                c.email AS customer_email,
                t.name AS table_label
         FROM dining.reservations r
         LEFT JOIN customer.customers c ON c.id = r.customer_id AND c.deleted_at IS NULL
         LEFT JOIN dining.tables t      ON t.id = r.table_id    AND t.deleted_at IS NULL
         ${where}
         ORDER BY r.reservation_time ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) AS total FROM dining.reservations r ${where}`, params),
    ]);

    const total = parseInt(countRes.rows[0].total, 10);
    res.json({
      ok:           true,
      reservations: listRes.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

/* ── PATCH /reservations/:id (admin — confirm / cancel / complete) ───────── */
const VALID_RES_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];

router.patch('/reservations/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (!status && notes === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    if (status && !VALID_RES_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${VALID_RES_STATUSES.join(', ')}` });
    }

    const sets   = [];
    const params = [req.params.id, req.tenant.tenant_id];

    if (status)           { params.push(status); sets.push(`status = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); sets.push(`dietary_notes = $${params.length}`); }
    if (status === 'cancelled') { sets.push(`cancelled_at = NOW()`); }
    sets.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE dining.reservations
       SET ${sets.join(', ')}
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id, status, updated_at`,
      params
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Reservation not found' });

    if (status) {
      events.emit('reservation.status_updated', {
        tenantId:      req.tenant.tenant_id,
        reservationId: req.params.id,
        status,
        actorId:       req.auth?.staffId,
      });
    }

    res.json({ ok: true, reservation: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/* ── GET /kitchen ───────────────────────────────────────────────────────── */
router.get('/kitchen', requireRestaurantAuth, async (req, res, next) => {
  const tenant_id = req.tenant.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ error: 'Dining tables not configured for this restaurant.' });
  }

  try {
    const result = await query(
      `SELECT
         t.name    AS table_name,
         s.id      AS session_id,
         s.opened_at,
         s.covers,
         json_agg(
           json_build_object(
             'order_id',   o.id,
             'status',     o.status,
             'created_at', o.created_at,
             'items',      oi.items_agg
           ) ORDER BY o.created_at
         ) FILTER (WHERE o.id IS NOT NULL) AS orders
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       LEFT JOIN orders.orders o
         ON  o.session_id = s.id
         AND o.status IN ('pending', 'confirmed', 'preparing')
         AND o.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT json_agg(
           json_build_object(
             'name', oi2.item_name,
             'qty',  oi2.quantity,
             'note', oi2.special_note
           )
         ) AS items_agg
         FROM orders.order_items oi2
         WHERE oi2.order_id = o.id
       ) oi ON TRUE
       WHERE s.tenant_id  = $1
         AND s.closed_at IS NULL
         AND s.deleted_at IS NULL
       GROUP BY t.name, s.id, s.opened_at, s.covers
       ORDER BY s.opened_at ASC
       LIMIT 200`,
      [tenant_id]
    );
    res.json({ ok: true, tables: result.rows });
  } catch (err) {
    next(err);
  }
});

/* ── GET /bill?session_id=xxx ───────────────────────────────────────────── */
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
         s.id       AS session_id,
         t.name     AS table_name,
         s.covers,
         s.opened_at,
         s.closed_at,
         json_agg(
           json_build_object(
             'order_id',  o.id,
             'subtotal',  o.subtotal_amount,
             'total',     o.total_amount,
             'tax',       o.tax_amount,
             'gst',       o.metadata->'gst',
             'items',     oi.items_agg
           ) ORDER BY o.created_at
         ) AS orders,
         SUM(o.subtotal_amount) AS subtotal,
         SUM(o.total_amount)    AS grand_total,
         SUM(o.tax_amount)      AS total_tax
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       JOIN orders.orders o
         ON  o.session_id = s.id
         AND o.status NOT IN ('cancelled', 'refunded')
         AND o.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT json_agg(
           json_build_object(
             'name',  oi2.item_name,
             'qty',   oi2.quantity,
             'price', oi2.unit_price
           )
         ) AS items_agg
         FROM orders.order_items oi2
         WHERE oi2.order_id = o.id
       ) oi ON TRUE
       WHERE s.id        = $1
         AND s.tenant_id = $2
       GROUP BY s.id, t.name, s.covers, s.opened_at, s.closed_at`,
      [session_id, tenant_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Session not found or has no billable orders.' });
    }

    const row    = result.rows[0];
    const orders = row.orders || [];

    // ── GST snapshot consistency check ──────────────────────────────────────
    // Each order carries its own snapshot. Verify they all agree — if GST
    // settings changed mid-session, the bill cannot be rendered cleanly and
    // accounting must review manually.
    const snapshots = orders
      .map(o => o.gst)
      .filter(g => g && g.cgst_rate != null);

    let gst_snapshot     = null;
    let gst_inconsistent = false;

    if (snapshots.length > 0) {
      gst_snapshot = snapshots[0];
      gst_inconsistent = snapshots.some(g =>
        g.cgst_rate  !== gst_snapshot.cgst_rate  ||
        g.sgst_rate  !== gst_snapshot.sgst_rate  ||
        g.inclusive  !== gst_snapshot.inclusive  ||
        g.gstin      !== gst_snapshot.gstin
      );
    }

    // ── Bill totals ─────────────────────────────────────────────────────────
    const subtotal      = parseFloat(row.subtotal   || 0);
    const grand_total   = parseFloat(row.grand_total || 0);
    const total_tax     = parseFloat(row.total_tax   || 0);
    const taxable_amount = gst_snapshot?.inclusive
      ? parseFloat((subtotal - total_tax).toFixed(2))
      : subtotal;

    const cgst_amount = gst_snapshot
      ? parseFloat((total_tax * gst_snapshot.cgst_rate / (gst_snapshot.cgst_rate + gst_snapshot.sgst_rate)).toFixed(2))
      : 0;
    const sgst_amount = gst_snapshot
      ? parseFloat((total_tax - cgst_amount).toFixed(2))
      : 0;

    const bill = {
      session_id:       row.session_id,
      table_name:       row.table_name,
      covers:           row.covers,
      opened_at:        row.opened_at,
      closed_at:        row.closed_at,
      orders,
      // Structured totals matching invoice layout
      subtotal,
      taxable_amount,
      cgst_amount,
      sgst_amount,
      total_tax,
      grand_total,
      // GST metadata
      gst_snapshot,
      gst_inconsistent,   // true = accounting warning; bill UI should flag this
    };

    res.json({ ok: true, bill });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
