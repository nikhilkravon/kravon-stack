/**
 * ROUTE — orders.js
 * POST /v1/restaurants/:slug/orders
 * GET  /v1/restaurants/:slug/orders/:id  (admin)
 *
 * Handles order creation for BOTH surfaces:
 *
 *   order_surface = "tables"  — dine-in or takeaway from QR / counter
 *     • no delivery_address required
 *     • payment_method: "offline" | "razorpay"
 *     • table_identifier: "T4" (dine-in) | "takeaway"
 *
 *   order_surface = "orders"  — remote delivery order
 *     • delivery_address required
 *     • payment_method: "upi" | "card" | "cod"
 *
 * Flow:
 *   1. Validate (Zod discriminated union on order_surface)
 *   2. Verify items + prices against DB
 *   3. Razorpay order creation (razorpay / upi / card only)
 *   4. DB write
 *   5. Immediate confirm + notify for offline/COD
 *   6. Return { order_id, razorpay_order_id, razorpay_key_id, total }
 */

'use strict';

const express      = require('express');
const rateLimit    = require('express-rate-limit');
const { z }        = require('zod');
const orderService = require('../../domains/ordering/service');
const orderRepo    = require('../../domains/ordering/repository');
const { requireRestaurantAuth } = require('../middleware/auth');
const audit        = require('../../utils/audit');
const events       = require('../../utils/events');

const router = express.Router();

// 30 order-creation attempts per tenant per minute — stops flooding without
// blocking legitimate burst traffic (e.g. a busy table night).
const orderCreateLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => req.tenant?.tenant_id || req.ip,
  message: { error: 'Too many order requests. Please wait a moment.' },
  skip:            (req) => req.method !== 'POST',
});
router.use(orderCreateLimiter);

/* ── Shared cart item schema ────────────────────────────────────────────── */
const CartItemSchema = z.object({
  id:    z.string().uuid(),
  name:  z.string().min(1).max(150),
  price: z.number().min(0),
  qty:   z.number().int().min(1).max(20),
  note:  z.string().max(200).optional(),
  addons: z.array(z.object({
    label: z.string(),
    price: z.number().min(0),
  })).optional(),
});

/* ── Tables surface schema ───────────────────────────────────────────────── */
const TablesOrderSchema = z.object({
  order_surface:    z.literal('tables'),
  customer_name:    z.string().min(1).max(120),
  customer_phone:   z.string().min(10).max(20),
  table_identifier: z.string().max(20).optional(),  // "T4" | "takeaway"
  items:            z.array(CartItemSchema).min(1).max(30),
  payment_method:   z.enum(['offline', 'razorpay']),
  special_notes:    z.string().max(500).optional(),
});

/* ── Orders (delivery) surface schema ───────────────────────────────────── */
const DeliveryOrderSchema = z.object({
  order_surface:     z.literal('orders'),
  customer_name:     z.string().min(1).max(120),
  customer_phone:    z.string().min(10).max(20),
  delivery_address:  z.string().min(5).max(500),
  delivery_locality: z.string().max(100).optional(),
  delivery_landmark: z.string().max(200).optional(),
  items:             z.array(CartItemSchema).min(1).max(30),
  delivery_type:     z.enum(['standard', 'express']).default('standard'),
  payment_method:    z.enum(['upi', 'card', 'cod']),
  special_notes:     z.string().max(500).optional(),
});

/* ── Discriminated union ─────────────────────────────────────────────────── */
const CreateOrderSchema = z.discriminatedUnion('order_surface', [
  TablesOrderSchema,
  DeliveryOrderSchema,
]);

/* ── POST /orders ────────────────────────────────────────────────────────── */
router.post('/', async (req, res, next) => {
  try {
    const parsed = CreateOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const data           = parsed.data;
    const idempotencyKey = req.headers['idempotency-key'] || null;
    const result         = await orderService.createOnlineOrder(req.tenant, data, idempotencyKey);
    // order.created event is emitted inside the domain service

    res.status(201).json({
      ok:    true,
      order: {
        id:                result.orderId,
        total:             result.total,
        razorpay_order_id: result.razorpayOrderId,
        razorpay_key_id:   result.razorpayKeyId,
      },
    });
  } catch (err) {
    next(err);
  }
});

/* ── GET /orders (admin — paginated list) ────────────────────────────────── */
router.get('/', requireRestaurantAuth, async (req, res, next) => {
  try {
    const page    = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit   = Math.min(100,   Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { orders, total } = await orderRepo.listPaginated(req.tenant.tenant_id, {
      page, limit,
      status:  req.query.status  || null,
      channel: req.query.channel || null,
    });
    res.json({ ok: true, orders, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

/* ── GET /orders/:id (admin only) ────────────────────────────────────────── */
router.get('/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const order = await orderRepo.findById(req.tenant.tenant_id, req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true, order });
  } catch (err) {
    next(err);
  }
});

/* ── GET /orders/:id/items (admin only) ──────────────────────────────────── */
router.get('/:id/items', requireRestaurantAuth, async (req, res, next) => {
  try {
    const items = await orderRepo.getItems(req.tenant.tenant_id, req.params.id);
    res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
});

/* ── PATCH /orders/:id (admin — update status) ───────────────────────────── */
const VALID_ORDER_STATUSES = [
  'confirmed', 'preparing', 'ready',
  'out_for_delivery', 'completed', 'delivered', 'cancelled',
];

router.patch('/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    if (!VALID_ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${VALID_ORDER_STATUSES.join(', ')}` });
    }

    const updated = await orderService.updateStatus(req.tenant.tenant_id, req.params.id, status);
    if (!updated) return res.status(404).json({ error: 'Order not found' });

    audit.log(null, {
      tenantId: req.tenant.tenant_id, actorId: req.auth?.staffId, actorType: 'staff',
      action: 'order.status_update', entityType: 'orders.order', entityId: req.params.id,
      newValue: { status }, req,
    });

    events.emit('order.status_updated', {
      tenantId: req.tenant.tenant_id,
      orderId:  req.params.id,
      status,
      actorId:  req.auth?.staffId,
    });

    res.json({ ok: true, order: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
