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

const express  = require('express');
const { z }    = require('zod');
const { query } = require('../../db/pool');
const orderService = require('../../services/order.service');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

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

    const data   = parsed.data;
    const result = await orderService.createOrder(req.tenant, data);

    res.status(201).json({
      ok:                true,
      order_id:          result.orderId,
      razorpay_order_id: result.razorpayOrderId,
      razorpay_key_id:   result.razorpayKeyId,
      total:             result.total,
    });
  } catch (err) {
    next(err);
  }
});

/* ── GET /orders (admin — paginated list) ────────────────────────────────── */
router.get('/', requireRestaurantAuth, async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const page     = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset   = (page - 1) * limit;
    const status   = req.query.status  || null;
    const channel  = req.query.channel || null;  // 'qr'|'web'|'whatsapp'|'pos'

    const params  = [tenantId];
    const filters = ['o.tenant_id = $1', 'o.deleted_at IS NULL'];

    if (status) {
      params.push(status);
      filters.push(`o.status = $${params.length}`);
    }
    if (channel) {
      params.push(channel);
      filters.push(`o.channel = $${params.length}`);
    }

    const where = `WHERE ${filters.join(' AND ')}`;

    const [listRes, countRes] = await Promise.all([
      query(
        `SELECT o.id, o.channel, o.fulfillment_type, o.status,
                o.total_amount, o.created_at,
                c.name  AS customer_name,
                c.phone AS customer_phone
         FROM orders.orders o
         LEFT JOIN customer.customers c
                ON c.id = o.customer_id AND c.deleted_at IS NULL
         ${where}
         ORDER BY o.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*) AS total FROM orders.orders o ${where}`,
        params
      ),
    ]);

    const total = parseInt(countRes.rows[0].total, 10);
    res.json({
      ok:     true,
      orders: listRes.rows.map(o => ({ ...o, total_amount: Number(o.total_amount) })),
      total,
      page,
      limit,
      pages:  Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

/* ── GET /orders/:id (admin only) ────────────────────────────────────────── */
router.get('/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const result = await query(
      'SELECT * FROM orders.orders WHERE id=$1::uuid AND tenant_id=$2',
      [id, req.tenant.tenant_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Order not found' });
    res.json({ ok: true, order: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
