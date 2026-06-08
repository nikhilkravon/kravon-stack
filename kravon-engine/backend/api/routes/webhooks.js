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

const express         = require('express');
const crypto          = require('crypto');
const { query, getClient } = require('../../db/pool');
const notifyService   = require('../../services/notify.service');
const orderingService = require('../../domains/ordering/service');

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

    // Ordering domain owns this mutation (F04: atomic payment + order update)
    const order = await orderingService.confirmPayment(client, razorpayOrderId, razorpayPayId);

    if (!order) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, skipped: 'order not found or already confirmed' });
    }

    const meta = order.metadata || {};
    await client.query('COMMIT');

    /* ── 4. Emit order.created — notification listeners handle WhatsApp + in-app ── */
    const events = require('../../utils/events');
    events.emit('order.created', {
      tenantId: order.tenant_id,
      orderId:  order.id,
      total:    Number(order.total_amount),
      channel:  order.channel,
    });

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
