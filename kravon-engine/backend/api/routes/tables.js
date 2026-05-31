/**
 * ROUTE — tables.js
 * GET    /v1/restaurants/:slug/tables              — list tables + current status
 * POST   /v1/restaurants/:slug/tables              — create table
 * PUT    /v1/restaurants/:slug/tables/:id          — update table
 * DELETE /v1/restaurants/:slug/tables/:id          — soft delete
 * GET    /v1/restaurants/:slug/tables/sessions     — all open sessions with order totals
 */

'use strict';

const express  = require('express');
const { z }    = require('zod');
const { query, getClient } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireRestaurantAuth);

/* ── GET /tables ─────────────────────────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const result   = await query(
      `SELECT
         t.id, t.name, t.capacity, t.floor, t.status, t.qr_code, t.is_active,
         t.created_at, t.updated_at,
         s.id          AS session_id,
         s.opened_at   AS session_opened_at,
         s.covers      AS session_covers,
         COALESCE(
           (SELECT SUM(o.total_amount)
            FROM orders.orders o
            WHERE o.session_id = s.id
              AND o.status NOT IN ('cancelled','refunded')
              AND o.deleted_at IS NULL),
           0
         ) AS session_total
       FROM dining.tables t
       LEFT JOIN dining.sessions s
         ON s.table_id = t.id AND s.closed_at IS NULL AND s.deleted_at IS NULL
       WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
       ORDER BY t.name`,
      [tenantId]
    );
    res.json({ ok: true, tables: result.rows.map(r => ({
      id:         r.id,
      name:       r.name,
      capacity:   r.capacity,
      floor:      r.floor,
      status:     r.status,
      qr_code:    r.qr_code,
      is_active:  r.is_active,
      created_at: r.created_at,
      session: r.session_id ? {
        id:         r.session_id,
        opened_at:  r.session_opened_at,
        covers:     r.session_covers,
        total:      Number(r.session_total),
      } : null,
    }))});
  } catch (err) { next(err); }
});

/* ── GET /tables/sessions ────────────────────────────────────────────────── */
router.get('/sessions', async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const result   = await query(
      `SELECT
         s.id, s.opened_at, s.covers,
         t.name AS table_name,
         t.capacity,
         COALESCE(
           (SELECT SUM(o.total_amount)
            FROM orders.orders o
            WHERE o.session_id = s.id
              AND o.status NOT IN ('cancelled','refunded')
              AND o.deleted_at IS NULL),
           0
         ) AS total,
         (SELECT COUNT(*)
          FROM orders.orders o
          WHERE o.session_id = s.id AND o.deleted_at IS NULL) AS order_count
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       WHERE s.tenant_id = $1
         AND s.closed_at IS NULL
         AND s.deleted_at IS NULL
       ORDER BY s.opened_at ASC`,
      [tenantId]
    );
    res.json({ ok: true, sessions: result.rows.map(r => ({
      ...r,
      total:       Number(r.total),
      order_count: Number(r.order_count),
    }))});
  } catch (err) { next(err); }
});

/* ── POST /tables ────────────────────────────────────────────────────────── */
const CreateTableSchema = z.object({
  name:     z.string().min(1).max(50),
  capacity: z.number().int().min(1).max(50).optional(),
  floor:    z.string().max(50).optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = CreateTableSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const tenantId = req.tenant.tenant_id;
    const { name, capacity, floor } = parsed.data;

    // Get first active location for this tenant
    const locRes = await query(
      'SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1',
      [tenantId]
    );
    if (!locRes.rows.length) {
      return res.status(400).json({ error: 'No active location found for this restaurant.' });
    }
    const locationId = locRes.rows[0].id;

    // Build QR code URL
    const qrCode = `${process.env.APP_BASE_URL || 'https://app.kravon.in'}/${req.tenant.slug}/tables?table_id=`;

    const result = await query(
      `INSERT INTO dining.tables (tenant_id, location_id, name, capacity, floor, status, is_active)
       VALUES ($1, $2, $3, $4, $5, 'available', TRUE)
       RETURNING id, name, capacity, floor, status, is_active, created_at`,
      [tenantId, locationId, name, capacity ?? null, floor ?? null]
    );

    const table = result.rows[0];

    // Update qr_code with real table ID now that we have it
    await query(
      'UPDATE dining.tables SET qr_code = $1 WHERE id = $2',
      [`${qrCode}${table.id}`, table.id]
    );

    res.status(201).json({ ok: true, table: { ...table, qr_code: `${qrCode}${table.id}` } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A table with this name already exists.' });
    next(err);
  }
});

/* ── PUT /tables/:id ─────────────────────────────────────────────────────── */
const UpdateTableSchema = z.object({
  name:      z.string().min(1).max(50).optional(),
  capacity:  z.number().int().min(1).max(50).optional(),
  floor:     z.string().max(50).optional(),
  is_active: z.boolean().optional(),
});

router.put('/:id', async (req, res, next) => {
  try {
    const parsed = UpdateTableSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const d        = parsed.data;
    const tenantId = req.tenant.tenant_id;
    const sets     = [];
    const values   = [];
    let   idx      = 1;

    if (d.name      !== undefined) { sets.push(`name = $${idx++}`);      values.push(d.name); }
    if (d.capacity  !== undefined) { sets.push(`capacity = $${idx++}`);  values.push(d.capacity); }
    if (d.floor     !== undefined) { sets.push(`floor = $${idx++}`);     values.push(d.floor); }
    if (d.is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(d.is_active); }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    sets.push(`updated_at = NOW()`);
    values.push(req.params.id, tenantId);

    const result = await query(
      `UPDATE dining.tables SET ${sets.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING id, name, capacity, floor, status, is_active, updated_at`,
      values
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Table not found' });
    res.json({ ok: true, table: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A table with this name already exists.' });
    next(err);
  }
});

/* ── DELETE /tables/:id ──────────────────────────────────────────────────── */
router.delete('/:id', async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;

    // Block delete if table has an open session
    const sessionCheck = await query(
      `SELECT id FROM dining.sessions WHERE table_id = $1 AND closed_at IS NULL AND deleted_at IS NULL LIMIT 1`,
      [req.params.id]
    );
    if (sessionCheck.rows.length) {
      return res.status(409).json({ error: 'Cannot delete a table with an open session. Close the session first.' });
    }

    const result = await query(
      `UPDATE dining.tables SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, tenantId]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Table not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
