/**
 * SERVICE — order.service.js
 * Owns the order creation lifecycle for both Tables and Orders surfaces.
 *
 * Key responsibilities:
 *   - Price verification: always server-side, never trust frontend prices
 *   - Delivery fee from tenant DB row (not hardcoded constants)
 *   - Razorpay payment order creation for razorpay/upi/card payments
 *   - Offline/COD: confirmed immediately, notifications fired directly
 *   - Outbound webhook fires on every confirmed order (via notify.service)
 *
 * Architecture:
 *   Routes call createOrder(tenant, data) and get back { orderId, ... }.
 *   This service never touches req/res — it is a pure business logic layer.
 *
 * Order pipeline:
 *   1. Verify items + prices against DB
 *   2. Calculate totals (delivery fee from tenant config)
 *   3. Create Razorpay order if payment requires it
 *   4. Determine initial status (confirmed for offline/COD, pending_payment for Razorpay)
 *   5. Write order to DB (transaction)
 *   6. Immediate confirm path: upsert customer + fire notifications (offline/COD only)
 *      Razorpay path: notifications fire from webhooks.js after payment.captured
 *   7. Return { orderId, razorpayOrderId, razorpayKeyId, total }
 *
 * Example call:
 *   const result = await createOrder(req.tenant, req.body);
 *   // result = { orderId: 112, razorpayOrderId: "order_abc", razorpayKeyId: "rzp_...", total: 49900 }
 */

'use strict';

const { query, getClient } = require('../db/pool');
const razorpay             = require('../integrations/razorpay');
const notifyService        = require('./notify.service');

/**
 * createOrder(tenant, data)
 *
 * @param {object} tenant - req.tenant ({ rest_id, razorpay_key_id, delivery_fee, ... })
 * @param {object} data   - validated order body from Zod schema in orders route
 * @returns {{ orderId, razorpayOrderId, razorpayKeyId, total }}
 */
async function createOrder(tenant, data) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    /* ── 1. Verify items + prices against DB ─────────────────────────────── */
    // Frontend prices are advisory only. We verify every item against the DB.
    // A price mismatch means tampering — reject with 400.
    const itemIds = data.items.map(i => i.id);
    const dbItems = await client.query(
      `SELECT id, name, price_paise FROM menu_items
       WHERE rest_id = $1 AND id = ANY($2) AND active = TRUE`,
      [tenant.rest_id, itemIds]
    );

    const dbPriceMap = new Map(dbItems.rows.map(r => [r.id, r.price_paise]));
    for (const item of data.items) {
      const dbPrice = dbPriceMap.get(item.id);
      if (dbPrice === undefined) {
        throw Object.assign(new Error(`Item ${item.id} not found or inactive.`), { status: 400 });
      }
      // Client sends price in rupees; DB stores paise
      if (dbPrice !== item.price * 100) {
        throw Object.assign(
          new Error(`Price mismatch for item ${item.id}: expected ₹${dbPrice / 100}, got ₹${item.price}`),
          { status: 400 }
        );
      }
    }

    /* ── 2. Calculate totals ─────────────────────────────────────────────── */
    let subtotal = 0;
    for (const item of data.items) {
      subtotal += item.price * 100 * item.qty;
      for (const addon of item.addons || []) {
        subtotal += addon.price * 100 * item.qty;
      }
    }

    // Tables orders never have a delivery fee — customer is physically present
    // Orders (delivery) use per-tenant delivery fee from the DB row
    let deliveryFee = 0;
    if (data.order_surface === 'orders') {
      const freeAt = tenant.free_delivery_above ?? 49900; // ₹499 default
      const stdFee = tenant.delivery_fee        ?? 4900;  // ₹49 default
      const expFee = Math.round(stdFee * 2);              // express = 2× standard
      deliveryFee = data.delivery_type === 'express'
        ? expFee
        : (subtotal >= freeAt ? 0 : stdFee);
    }

    const total = subtotal + deliveryFee;

    /* ── 3. Initial order status ────────────────────────────────────────── */
    const needsRazorpay      = ['razorpay', 'upi', 'card'].includes(data.payment_method);
    const isImmediateConfirm = ['offline', 'cod'].includes(data.payment_method);
    const orderStatus   = isImmediateConfirm ? 'confirmed'       : 'pending_payment';
    const paymentStatus = isImmediateConfirm ? 'pending'         : 'awaiting_payment';

    /* ── 4. Write order to DB ────────────────────────────────────────────── */
    const itemsJson = data.items.map(i => ({
      id:     i.id,
      name:   i.name,
      price:  i.price,
      qty:    i.qty,
      note:   i.note   || null,
      addons: i.addons || [],
    }));

    const tableIdentifier = data.table_identifier
      || (data.order_surface === 'tables' ? 'takeaway' : null);

    const orderRes = await client.query(`
      INSERT INTO orders (
        rest_id, order_surface, table_identifier,
        customer_name, customer_phone,
        delivery_address, delivery_locality, delivery_landmark,
        items_json, special_notes,
        subtotal, delivery_fee, total_amount,
        delivery_type, payment_method, payment_status,
        razorpay_order_id, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id
    `, [
      tenant.rest_id,
      data.order_surface,
      tableIdentifier,
      data.customer_name,
      data.customer_phone,
      data.delivery_address  || null,
      data.delivery_locality || null,
      data.delivery_landmark || null,
      JSON.stringify(itemsJson),
      data.special_notes     || null,
      subtotal,
      deliveryFee,
      total,
      data.delivery_type     || null,
      data.payment_method,
      paymentStatus,
      null,           // razorpay_order_id — filled in below after Razorpay call
      orderStatus,
    ]);

    /* ── 5. Razorpay payment order ───────────────────────────────────────── */
    // Insert happens first so we can pass the real orderId as the Razorpay receipt.
    // This makes every Razorpay order uniquely traceable back to our DB row.
    let razorpayOrderId = null;
    let razorpayKeyId   = null;

    if (needsRazorpay) {
      const payment    = await razorpay.createPayment(tenant, total, orderRes.rows[0].id);
      razorpayOrderId  = payment.razorpayOrderId;
      razorpayKeyId    = payment.razorpayKeyId;
      // Write razorpay_order_id back to the row
      await client.query(
        'UPDATE orders SET razorpay_order_id = $1 WHERE id = $2',
        [razorpayOrderId, orderRes.rows[0].id]
      );
    }

    /* ── 6. Immediate confirm path (offline / COD) ───────────────────────── */
    // For Razorpay payments, notifications fire from webhooks.js after capture.
    const orderId = orderRes.rows[0].id;

    if (isImmediateConfirm) {
      // Upsert customer record inside the same transaction
      await client.query(`
        INSERT INTO customers (rest_id, phone, name, order_count, total_spent, first_order_at, last_order_at)
        VALUES ($1,$2,$3,1,$4,NOW(),NOW())
        ON CONFLICT (rest_id, phone) DO UPDATE
          SET order_count   = customers.order_count + 1,
              total_spent   = customers.total_spent + $4,
              last_order_at = NOW(),
              name          = EXCLUDED.name
      `, [tenant.rest_id, data.customer_phone, data.customer_name, total]);
    }

    await client.query('COMMIT');

    if (isImmediateConfirm) {
      // Build order object for notify (mirrors DB row shape)
      const orderForNotify = {
        id:               orderId,
        rest_id:    tenant.rest_id,
        order_surface:    data.order_surface,
        table_identifier: tableIdentifier,
        customer_name:    data.customer_name,
        customer_phone:   data.customer_phone,
        items_json:       JSON.stringify(itemsJson),
        subtotal,
        delivery_fee:     deliveryFee,
        total,
        payment_method:   data.payment_method,
        status:           'confirmed',
      };

      // Fire-and-forget — notifications must never block the response
      notifyService.orderConfirmed(tenant, orderForNotify).catch(err =>
        console.error('[order.service] notify failed:', err.message)
      );
    }

    return { orderId, razorpayOrderId, razorpayKeyId, total };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createOrder };
