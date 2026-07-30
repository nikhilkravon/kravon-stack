/**
 * ROUTE — dine-in.js
 *
 * HTTP layer only. All business logic lives in domain services:
 *   domains/dining/sessions.js     — session lifecycle, bill
 *   domains/dining/kitchen.js      — kitchen view (all channels)
 *   domains/dining/reservations.js — reservation CRUD
 *   domains/ordering/service.js    — dine-in order creation
 *
 * Endpoints:
 *   POST /session/open           (staff JWT)
 *   POST /session/close          (staff JWT)
 *   POST /session/transfer       (staff JWT)
 *   GET  /boot                   (public) — unified: session status + orders in one call
 *   GET  /session/status         (public)
 *   GET  /session/orders         (public)
 *   POST /session/request-bill   (public)
 *   POST /order                  (public)
 *   GET  /kitchen                (staff JWT)
 *   GET  /sessions/closed         (staff JWT) — paginated bill history
 *   GET  /bill                   (staff JWT)
 *   POST /reservations           (public)
 *   GET  /reservations           (staff JWT)
 *   PATCH /reservations/:id      (staff JWT)
 */

'use strict';

const express    = require('express');
const { z }      = require('zod');
const rateLimit  = require('express-rate-limit');

const sessions     = require('../../domains/dining/sessions');
const kitchen      = require('../../domains/dining/kitchen');
const reservations = require('../../domains/dining/reservations');
const orderService = require('../../domains/ordering/service');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

const publicLimiter = rateLimit({
  keyGenerator: (req) => `${req.tenant?.tenant_id || 'unknown'}:${req.ip}`,
  max: 50, windowMs: 60000,
  message: { error: 'Too many requests. Please try again later.' }
});

const orderLimiter = rateLimit({
  keyGenerator: (req) => `${req.tenant?.tenant_id || 'unknown'}:${req.ip}`,
  max: 60, windowMs: 60000,
  message: { error: 'Too many orders. Please try again later.' }
});

/* ── Helper: send domain error or 500 ─────────────────────────────────────── */
function sendResult(res, result, successStatus = 200) {
  if (result.error) return res.status(result.status || 500).json({ error: result.error });
  res.status(successStatus).json({ ok: true, ...result });
}

/* ── POST /session/open ─────────────────────────────────────────────────── */
const OpenSessionSchema = z.object({
  table_id:       z.string().uuid(),
  covers:         z.number().int().min(1).max(50).optional(),
  reservation_id: z.string().uuid().optional(),
});

router.post('/session/open', requireRestaurantAuth, async (req, res, next) => {
  const parsed = OpenSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await sessions.openSession(req.tenant, parsed.data, req.auth?.staffId);
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── POST /session/close ────────────────────────────────────────────────── */
const CloseSessionSchema = z.object({ session_id: z.string().uuid() });

router.post('/session/close', requireRestaurantAuth, async (req, res, next) => {
  const parsed = CloseSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await sessions.closeSession(req.tenant, parsed.data, req.auth?.staffId);
    if (result.error) return res.status(result.status || 500).json({ error: result.error });
    res.json({ ok: true, session_id: result.session_id, settlement_id: result.settlement_id || null });
  } catch (err) { next(err); }
});

/* ── POST /session/transfer ─────────────────────────────────────────────── */
const TransferSessionSchema = z.object({
  session_id:  z.string().uuid(),
  to_table_id: z.string().uuid(),
});

router.post('/session/transfer', requireRestaurantAuth, async (req, res, next) => {
  const parsed = TransferSessionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await sessions.transferSession(req.tenant, parsed.data, req.auth?.staffId);
    sendResult(res, result, 200);
  } catch (err) { next(err); }
});

/* ── GET /boot?table_id=xxx ─────────────────────────────────────────────
 * Unified QR boot: returns session status + active orders in one call.
 * Replaces two sequential calls (status then orders) in the tables frontend.
 */
router.get('/boot', publicLimiter, async (req, res, next) => {
  try {
    const status = await sessions.getStatus(req.tenant.tenant_id, req.query.table_id);
    if (status.error) return res.status(status.status || 500).json({ error: status.error });
    if (!status.open) {
      // Still return table_name so the "not open" screen can show the table name
      const tableName = await sessions.getTableName(req.tenant.tenant_id, req.query.table_id);
      return res.json({ ok: true, open: false, table_name: tableName });
    }

    const ordersResult = await sessions.getSessionOrders(req.tenant.tenant_id, status.session_id);
    res.json({ ok: true, open: true, session: status, orders: ordersResult.orders || [] });
  } catch (err) { next(err); }
});

/* ── POST /notify-staff ─────────────────────────────────────────────────
 * Guest at an inactive table taps "Notify Staff". Creates an in-app alert.
 */
const NotifyStaffSchema = z.object({
  table_id: z.string().uuid(),
});

router.post('/notify-staff', publicLimiter, async (req, res, next) => {
  const parsed = NotifyStaffSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await sessions.notifyStaffTableReady(req.tenant, parsed.data.table_id);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── GET /session/status?table_id=xxx ──────────────────────────────────── */
router.get('/session/status', publicLimiter, async (req, res, next) => {
  try {
    const result = await sessions.getStatus(req.tenant.tenant_id, req.query.table_id);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── GET /session/orders?session_id=xxx ─────────────────────────────────── */
router.get('/session/orders', publicLimiter, async (req, res, next) => {
  try {
    const result = await sessions.getSessionOrders(req.tenant.tenant_id, req.query.session_id);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── POST /session/request-bill ─────────────────────────────────────────── */
const RequestBillSchema = z.object({
  session_id:   z.string().uuid(),
  requested_by: z.string().min(1).max(100).optional(),
});

router.post('/session/request-bill', publicLimiter, async (req, res, next) => {
  const parsed = RequestBillSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await sessions.requestBill(req.tenant.tenant_id, parsed.data);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── POST /order ────────────────────────────────────────────────────────── */
const DineInOrderSchema = z.object({
  session_id:    z.string().uuid(),
  guest_name:    z.string().min(1).max(100).optional(),
  guest_phone:   z.string().min(8).max(20).optional(),
  items: z.array(z.object({
    menu_item_id:   z.string().uuid(),
    quantity:       z.number().int().min(1).max(20),
    customizations: z.string().max(500).optional(),
  })).min(1).max(30),
  special_notes: z.string().max(500).optional(),
});

router.post('/order', publicLimiter, orderLimiter, async (req, res, next) => {
  const parsed = DineInOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  try {
    const idempotencyKey = req.headers['idempotency-key'] || null;
    const result = await orderService.createDineInOrder(req.tenant, {
      sessionId:    parsed.data.session_id,
      guestName:    parsed.data.guest_name,
      guestPhone:   parsed.data.guest_phone,
      items:        parsed.data.items,
      specialNotes: parsed.data.special_notes,
      idempotencyKey,
    });
    res.status(result.duplicate ? 200 : 201).json({ ok: true, order_id: result.orderId, total: result.total });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/* ── GET /kitchen ───────────────────────────────────────────────────────── */
router.get('/kitchen', requireRestaurantAuth, async (req, res, next) => {
  try {
    const result = await kitchen.getKitchenView(req.tenant.tenant_id);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

/* ── GET /sessions/closed ───────────────────────────────────────────────── */
router.get('/sessions/closed', requireRestaurantAuth, async (req, res, next) => {
  try {
    const limit        = Math.min(100, Math.max(1, parseInt(req.query.limit,  10) || 50));
    const offset       = Math.max(0,               parseInt(req.query.offset, 10) || 0);
    const date_from    = req.query.date_from    || null;
    const date_to      = req.query.date_to      || null;
    const table_search = req.query.table_search || null;
    const payment_mode = req.query.payment_mode || null;
    const result = await sessions.listClosedSessions(req.tenant.tenant_id, {
      limit, offset, date_from, date_to, table_search, payment_mode,
    });
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

/* ── GET /sessions/closed/export ─────────────────────────────────────────── */
router.get('/sessions/closed/export', requireRestaurantAuth, async (req, res, next) => {
  try {
    const date_from    = req.query.date_from    || null;
    const date_to      = req.query.date_to      || null;
    const table_search = req.query.table_search || null;
    const payment_mode = req.query.payment_mode || null;
    const { sessions: rows } = await sessions.listClosedSessionsExport(req.tenant.tenant_id, {
      date_from, date_to, table_search, payment_mode,
    });

    const header = ['Session ID', 'Table', 'Covers', 'Opened At', 'Closed At', 'Orders', 'Total (₹)', 'Payment Mode'];
    const esc    = v => (v == null ? '' : String(v).replace(/"/g, '""'));
    const lines  = [
      header.map(h => `"${h}"`).join(','),
      ...rows.map(r => [
        r.session_id,
        esc(r.table_name),
        r.covers ?? '',
        r.opened_at ? new Date(r.opened_at).toISOString() : '',
        r.closed_at ? new Date(r.closed_at).toISOString() : '',
        r.order_count,
        r.grand_total.toFixed(2),
        esc(r.payment_method),
      ].map(v => `"${v}"`).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bill-history-${Date.now()}.csv"`);
    res.send('﻿' + lines.join('\r\n')); // BOM for Excel
  } catch (err) { next(err); }
});

/* ── GET /bill?session_id=xxx ───────────────────────────────────────────── */
router.get('/bill', requireRestaurantAuth, async (req, res, next) => {
  try {
    const result = await sessions.getBill(req.tenant.tenant_id, req.query.session_id);
    sendResult(res, result);
  } catch (err) { next(err); }
});

/* ── GET /bill/render?session_id=xxx — printable GST bill ─────────────── */
router.get('/bill/render', requireRestaurantAuth, async (req, res, next) => {
  try {
    const { query: dbQuery } = require('../../db/pool');
    const renderer = require('../../services/bill.renderer');

    const [billResult, restaurantRes] = await Promise.all([
      sessions.getBill(req.tenant.tenant_id, req.query.session_id),
      dbQuery(
        `SELECT r.name, r.settings,
                l.address, l.city, l.phone
         FROM tenant.restaurants r
         LEFT JOIN tenant.locations l
                ON l.tenant_id = r.id AND l.is_active = TRUE
         WHERE r.id = $1 LIMIT 1`,
        [req.tenant.tenant_id]
      ),
    ]);

    if (billResult.error) return res.status(billResult.status || 404).json({ error: billResult.error });

    const row = restaurantRes.rows[0] || {};
    const restaurant = {
      name:     row.name,
      settings: row.settings || {},
      location: { address: row.address, city: row.city, phone: row.phone },
    };

    const html = renderer.renderSessionBill(billResult.bill, restaurant);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) { next(err); }
});

/* ── POST /reservations ───────────────────────────────────────────────────── */
const ReservationSchema = z.object({
  customer_name:    z.string().min(1).max(100),
  customer_phone:   z.string().min(8).max(20),
  customer_email:   z.string().email().optional(),
  party_size:       z.number().int().min(1).max(50),
  reservation_time: z.string().refine((val) => !Number.isNaN(new Date(val).getTime()), {
    message: 'reservation_time must be a valid ISO 8601 datetime with timezone offset',
  }),
  occasion:       z.string().max(150).optional(),
  dietary_notes:  z.string().max(500).optional(),
  table_id:       z.string().uuid().optional(),
});

router.post('/reservations', publicLimiter, async (req, res, next) => {
  const parsed = ReservationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try {
    const result = await reservations.create(req.tenant, parsed.data);
    sendResult(res, result, 201);
  } catch (err) { next(err); }
});

/* ── GET /reservations ─────────────────────────────────────────────────── */
router.get('/reservations', requireRestaurantAuth, async (req, res, next) => {
  try {
    const page  = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit = Math.min(100,   Math.max(1, parseInt(req.query.limit, 10) || 25));
    const status = req.query.upcoming_only === 'true'
      ? 'upcoming'
      : (req.query.status || null);
    const { reservations: list, total } = await reservations.list(req.tenant.tenant_id, {
      page, limit, status,
    });
    res.json({ ok: true, reservations: list, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

/* ── PATCH /reservations/:id ─────────────────────────────────────────────── */
router.patch('/reservations/:id', requireRestaurantAuth, async (req, res, next) => {
  const { status, notes, table_id } = req.body;
  if (!status && notes === undefined) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const result = await reservations.updateStatus(
      req.tenant, req.params.id,
      { status, notes, table_id }, req.auth?.staffId
    );
    sendResult(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
