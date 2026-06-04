/**
 * SERVICE — order.service.js
 * Order creation for Tables and Orders surfaces.
 * Uses v12 schema: menu.menu_items, orders.orders, orders.order_items, customer.customers.
 *
 * Price convention: rupees (NUMERIC) throughout — matching v12 DB.
 * Razorpay receives paise (total * 100) — converted at call site.
 */

'use strict';

const { query, getClient } = require('../db/pool');
const razorpay             = require('../integrations/razorpay');
const notifyService        = require('./notify.service');

async function createOrder(tenant, data) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    /* ── 1. Verify items + prices against DB ─────────────────────────────── */
    const itemIds = data.items.map(i => i.id);
    const dbItems = await client.query(
      `SELECT id, name, price FROM menu.menu_items
       WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND is_available = TRUE AND deleted_at IS NULL`,
      [tenant.tenant_id, itemIds]
    );

    if (dbItems.rows.length !== itemIds.length) {
      throw Object.assign(new Error('One or more items not found or unavailable.'), { status: 400 });
    }

    const dbPriceMap = new Map(dbItems.rows.map(r => [r.id, Number(r.price)]));
    for (const item of data.items) {
      const dbPrice = dbPriceMap.get(item.id);
      if (dbPrice === undefined) {
        throw Object.assign(new Error(`Item ${item.id} not found or inactive.`), { status: 400 });
      }
      // Skip price check for variant items (price=0 base, variant selected by customer)
      if (dbPrice > 0 && Math.round(dbPrice * 100) !== Math.round(item.price * 100)) {
        throw Object.assign(
          new Error(`Price mismatch for item ${item.id}: expected ₹${dbPrice}, got ₹${item.price}`),
          { status: 400 }
        );
      }
    }

    /* ── 2. Calculate totals (rupees) ────────────────────────────────────── */
    let subtotal = 0;
    for (const item of data.items) {
      subtotal += item.price * item.qty;
      for (const addon of item.addons || []) {
        subtotal += (addon.price || 0) * item.qty;
      }
    }

    let deliveryFee = 0;
    if (data.order_surface === 'orders') {
      const freeAt = tenant.free_delivery_above ?? 399;
      const stdFee = tenant.delivery_fee        ?? 39;
      const expFee = stdFee * 2;
      deliveryFee = data.delivery_type === 'express'
        ? expFee
        : (subtotal >= freeAt ? 0 : stdFee);
    }

    /* ── 2a. GST calculation + immutable snapshot ────────────────────────── */
    const gstCfg     = tenant.gst;
    const gstEnabled = gstCfg?.enabled && ((gstCfg.cgst_rate ?? 0) + (gstCfg.sgst_rate ?? 0)) > 0;
    let   taxAmount  = 0;
    let   gstSnapshot = null;

    if (gstEnabled) {
      const cgst      = Number(gstCfg.cgst_rate);
      const sgst      = Number(gstCfg.sgst_rate);
      const totalRate = cgst + sgst;          // e.g. 5 for 2.5+2.5

      if (gstCfg.inclusive) {
        // Tax already baked into subtotal: extract it back out
        taxAmount = parseFloat((subtotal * totalRate / (100 + totalRate)).toFixed(2));
      } else {
        // Tax added on top of subtotal
        taxAmount = parseFloat((subtotal * totalRate / 100).toFixed(2));
      }

      const cgstAmt = parseFloat((taxAmount * cgst / totalRate).toFixed(2));
      const sgstAmt = parseFloat((taxAmount - cgstAmt).toFixed(2));   // remainder avoids rounding gap

      // Snapshot locked at time of order — bills render this, never re-read settings
      gstSnapshot = {
        gstin:      gstCfg.gstin  || null,
        cgst_rate:  cgst,
        sgst_rate:  sgst,
        inclusive:  !!gstCfg.inclusive,
        tax_amount: taxAmount,
        cgst_amount: cgstAmt,
        sgst_amount: sgstAmt,
      };
    }

    const total = gstEnabled && !gstCfg.inclusive
      ? subtotal + deliveryFee + taxAmount
      : subtotal + deliveryFee;

    /* ── 3. Order status ─────────────────────────────────────────────────── */
    const needsRazorpay      = ['razorpay', 'upi', 'card'].includes(data.payment_method);
    const isImmediateConfirm = ['offline', 'cod'].includes(data.payment_method);
    const orderStatus        = isImmediateConfirm ? 'confirmed'       : 'pending';

    /* ── 4. Upsert customer ──────────────────────────────────────────────── */
    let customerId = null;
    if (data.customer_phone) {
      const upsertResult = await client.query(
        `INSERT INTO customer.customers (tenant_id, name, phone)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
         RETURNING id`,
        [tenant.tenant_id, data.customer_name, data.customer_phone]
      );
      customerId = upsertResult.rows[0].id;
    }

    /* ── 5. Write order to orders.orders ────────────────────────────────── */
    const fulfillmentType = data.order_surface === 'tables' ? 'dine_in' : 'delivery';
    const tableIdentifier = data.table_identifier
      || (data.order_surface === 'tables' ? 'takeaway' : null);

    const orderMeta = {
      customer_name:    data.customer_name,
      customer_phone:   data.customer_phone,
      table_identifier: tableIdentifier,
      delivery_address:  data.delivery_address  || null,
      delivery_locality: data.delivery_locality || null,
      delivery_landmark: data.delivery_landmark || null,
      payment_method:    data.payment_method,
      // Immutable GST snapshot — bills must read this, never current settings
      gst: gstSnapshot,
    };

    const orderRes = await client.query(`
      INSERT INTO orders.orders (
        tenant_id, customer_id, channel, fulfillment_type, status,
        subtotal_amount, delivery_charge, tax_amount, discount_amount,
        tip_amount, packaging_charge, total_amount,
        special_instructions, metadata
      ) VALUES ($1,$2,'web',$3,$4,$5,$6,$7,0,0,0,$8,$9,$10)
      RETURNING id
    `, [
      tenant.tenant_id,
      customerId,
      fulfillmentType,
      orderStatus,
      subtotal,
      deliveryFee,
      taxAmount,
      total,
      data.special_notes || null,
      JSON.stringify(orderMeta),
    ]);

    const orderId = orderRes.rows[0].id;

    /* ── 6. Write order_items ────────────────────────────────────────────── */
    for (const item of data.items) {
      const addonsTotal = (item.addons || []).reduce((sum, a) => sum + (a.price || 0) * item.qty, 0);
      await client.query(`
        INSERT INTO orders.order_items (
          tenant_id, order_id, menu_item_id,
          item_name, unit_price, quantity,
          base_price, addons_total, total_price,
          special_note, metadata
        ) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [
        tenant.tenant_id,
        orderId,
        item.id,
        item.name,
        item.price,
        item.qty,
        item.price * item.qty,
        addonsTotal,
        item.price * item.qty + addonsTotal,
        item.note || null,
        item.addons?.length ? JSON.stringify({ addons: item.addons }) : null,
      ]);
    }

    /* ── 7. Razorpay payment order ───────────────────────────────────────── */
    let razorpayOrderId = null;
    let razorpayKeyId   = null;

    if (needsRazorpay) {
      const totalPaise = Math.round(total * 100);
      const payment    = await razorpay.createPayment(tenant, totalPaise, orderId);
      razorpayOrderId  = payment.razorpayOrderId;
      razorpayKeyId    = payment.razorpayKeyId;
      // Store razorpay_order_id in metadata
      await client.query(
        `UPDATE orders.orders
         SET metadata = metadata || $1
         WHERE id = $2`,
        [JSON.stringify({ razorpay_order_id: razorpayOrderId }), orderId]
      );
    }

    await client.query('COMMIT');

    /* ── 8. Immediate confirm: fire notifications ────────────────────────── */
    if (isImmediateConfirm) {
      const orderForNotify = {
        id:               orderId,
        tenant_id:        tenant.tenant_id,
        order_surface:    data.order_surface,
        table_identifier: tableIdentifier,
        customer_name:    data.customer_name,
        customer_phone:   data.customer_phone,
        subtotal,
        delivery_fee:     deliveryFee,
        total,
        payment_method:   data.payment_method,
        status:           'confirmed',
      };

      notifyService.orderConfirmed(tenant, orderForNotify).catch(err =>
        console.error(JSON.stringify({ level: 'error', event: 'order.notify_failed',
          tenantId: tenant.tenant_id, orderId, message: err.message }))
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
