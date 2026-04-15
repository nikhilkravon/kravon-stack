/**
 * ROUTE — webhooks.js
 * POST /v1/webhooks/razorpay
 *
 * Receives inbound payment.captured events from Razorpay.
 *
 * Architecture:
 * - This route has NO resolveRestaurant middleware because Razorpay sends
 *   webhooks to a single platform URL, not per-restaurant.
 * - We verify HMAC signature FIRST, before reading or writing anything.
 * - After confirming the order, we fetch the tenant row to build req.tenant-
 *   compatible object and fire notifications + outbound webhook.
 *
 * Security:
 * - Signature verification uses RAZORPAY_WEBHOOK_SECRET (shared platform secret).
 * - Without a valid signature, the request is rejected before any DB access.
 *
 * Example Razorpay payload:
 *   {
 *     "event": "payment.captured",
 *     "payload": {
 *       "payment": {
 *         "entity": { "id": "pay_xyz", "order_id": "order_abc", ... }
 *       }
 *     }
 *   }
 */

'use strict';

const express       = require('express');
const crypto        = require('crypto');
const { query, getClient } = require('../../db/pool');
const notifyService = require('../../services/notify.service');
const { buildTenant } = require('../middleware/tenant');

const router = express.Router();

router.post('/razorpay', async (req, res) => {

  /* ── 1. Signature verification ─────────────────────────────────────────── */
  const secret    = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature = req.headers['x-razorpay-signature'];
  const body      = req.body; // raw Buffer — preserved by express.raw() in server.js

  // Guard: misconfigured env should never silently pass — reject with 500
  if (!secret) {
    console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not set');
    return res.status(500).json({ error: 'Webhook misconfigured.' });
  }

  if (!signature) {
    console.warn('[razorpay-webhook] Missing x-razorpay-signature header — rejected');
    return res.status(400).json({ error: 'Missing signature.' });
  }

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  // Use timingSafeEqual to prevent timing attacks on signature comparison
  const sigBuffer      = Buffer.from(signature,   'utf8');
  const expectedBuffer = Buffer.from(expectedSig, 'utf8');
  const sigValid = sigBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(sigBuffer, expectedBuffer);

  if (!sigValid) {
    console.warn('[razorpay-webhook] Invalid signature — rejected');
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  /* ── 2. Parse event ────────────────────────────────────────────────────── */
  let event;
  try {
    event = JSON.parse(body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON.' });
  }

  // Only act on payment.captured — acknowledge all other events silently
  if (event.event !== 'payment.captured') {
    return res.json({ ok: true, skipped: true });
  }

  const payment         = event.payload.payment.entity;
  const razorpayOrderId = payment.order_id;
  const razorpayPayId   = payment.id;

  /* ── 3. Confirm order in DB (transaction) ──────────────────────────────── */
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const orderRes = await client.query(
      `UPDATE orders
       SET payment_status       = 'paid',
           status               = 'confirmed',
           razorpay_payment_id  = $1,
           updated_at           = NOW()
       WHERE razorpay_order_id = $2
         AND status = 'pending_payment'
       RETURNING *`,
      [razorpayPayId, razorpayOrderId]
    );

    if (!orderRes.rows.length) {
      await client.query('ROLLBACK');
      // Idempotent — already processed or order not found
      return res.json({ ok: true, skipped: 'order not found or already confirmed' });
    }

    const order = orderRes.rows[0];

    // Upsert customer record for Insights
    await client.query(`
      INSERT INTO customers (rest_id, phone, name, order_count, total_spent, first_order_at, last_order_at)
      VALUES ($1,$2,$3,1,$4,NOW(),NOW())
      ON CONFLICT (rest_id, phone) DO UPDATE
        SET order_count   = customers.order_count + 1,
            total_spent   = customers.total_spent + $4,
            last_order_at = NOW(),
            name          = EXCLUDED.name
    `, [order.rest_id, order.customer_phone, order.customer_name, order.total_amount]);

    await client.query('COMMIT');

    /* ── 4. Notifications + outbound webhook (async, never blocks response) ─ */
    // Fetch restaurant row to build tenant object (no resolveRestaurant here)
    const tenantRes = await query(
      'SELECT * FROM restaurants WHERE rest_id = $1 LIMIT 1',
      [order.rest_id]
    );

    if (tenantRes.rows[0]) {
      const tenant = buildTenant(tenantRes.rows[0]);
      notifyService.orderConfirmed(tenant, order).catch(err =>
        console.error('[razorpay-webhook] notify failed:', err.message)
      );
    }

    res.json({ ok: true });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[razorpay-webhook] transaction failed:', err.message);
    res.status(500).json({ error: 'Webhook processing failed.' });
  } finally {
    client.release();
  }
});

module.exports = router;
