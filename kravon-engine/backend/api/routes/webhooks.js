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

    // Look up order by razorpay_order_id stored in metadata JSONB
    const orderRes = await client.query(
      `UPDATE orders.orders
       SET status     = 'confirmed',
           metadata   = metadata || $1,
           updated_at = NOW()
       WHERE metadata->>'razorpay_order_id' = $2
         AND status = 'pending'
       RETURNING *`,
      [JSON.stringify({ razorpay_payment_id: razorpayPayId }), razorpayOrderId]
    );

    if (!orderRes.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ ok: true, skipped: 'order not found or already confirmed' });
    }

    const order = orderRes.rows[0];
    const meta  = order.metadata || {};

    await client.query('COMMIT');

    /* ── 4. Notifications + outbound webhook ────────────────────────────── */
    const tenantRes = await query(
      `SELECT id, slug, name, has_presence, has_orders, has_tables, has_catering, has_insights, settings
       FROM tenant.restaurants WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [order.tenant_id]
    );

    if (tenantRes.rows[0]) {
      const tr = tenantRes.rows[0];
      // Minimal tenant object for notify
      const tenant = {
        tenant_id:   tr.id,
        slug:        tr.slug,
        name:        tr.name,
        webhook_url: tr.settings?.webhook_url || null,
        wa_number:   null,
      };
      const orderForNotify = {
        ...order,
        customer_name:  meta.customer_name,
        customer_phone: meta.customer_phone,
        order_surface:  order.fulfillment_type === 'delivery' ? 'orders' : 'tables',
      };
      notifyService.orderConfirmed(tenant, orderForNotify).catch(err =>
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
