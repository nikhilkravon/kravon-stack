'use strict';

/**
 * Ordering domain — service.
 *
 * Single creation path for ALL order surfaces.
 * Replaces services/order.service.js and the inline SQL in routes/dine-in.js.
 *
 * Surfaces:
 *   channel='web',  fulfillmentType='delivery' → online delivery
 *   channel='web',  fulfillmentType='pickup'   → online pickup
 *   channel='qr',   fulfillmentType='dine_in'  → dine-in QR order
 *
 * F01 fix: one code path creates every order.
 * F02 fix: CustomerService.findOrCreate() resolves identity once.
 * F03 fix: idempotency key enforced at DB level.
 */

const { getClient }      = require('../../db/pool');
const repo               = require('./repository');
const customerService    = require('../customer/service');
const razorpay           = require('../../integrations/razorpay');
const notifyService      = require('../../services/notify.service');
const events             = require('../../utils/events');
const outbox             = require('./outbox');

/* ── Shared tax calculation ───────────────────────────────────────────────── */

function calcGst(tenant, subtotal) {
  const gstCfg     = tenant.gst;
  const gstEnabled = gstCfg?.enabled && ((gstCfg.cgst_rate ?? 0) + (gstCfg.sgst_rate ?? 0)) > 0;
  if (!gstEnabled) return { taxAmount: 0, gstSnapshot: null };

  const cgst      = Number(gstCfg.cgst_rate);
  const sgst      = Number(gstCfg.sgst_rate);
  const totalRate = cgst + sgst;

  let taxAmount;
  if (gstCfg.inclusive) {
    taxAmount = parseFloat((subtotal * totalRate / (100 + totalRate)).toFixed(2));
  } else {
    taxAmount = parseFloat((subtotal * totalRate / 100).toFixed(2));
  }

  const cgstAmt = parseFloat((taxAmount * cgst / totalRate).toFixed(2));
  const sgstAmt = parseFloat((taxAmount - cgstAmt).toFixed(2));

  return {
    taxAmount,
    gstSnapshot: {
      gstin:       gstCfg.gstin  || null,
      cgst_rate:   cgst,
      sgst_rate:   sgst,
      inclusive:   !!gstCfg.inclusive,
      tax_amount:  taxAmount,
      cgst_amount: cgstAmt,
      sgst_amount: sgstAmt,
    },
  };
}

/* ── Verify items against DB ─────────────────────────────────────────────── */

async function resolveMenuItems(client, tenantId, items) {
  const itemIds = items.map(i => i.id);
  const dbRes   = await client.query(
    `SELECT id, name, price FROM menu.menu_items
     WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND is_available = TRUE AND deleted_at IS NULL`,
    [tenantId, itemIds]
  );

  if (dbRes.rows.length !== itemIds.length) {
    throw Object.assign(new Error('One or more items not found or unavailable.'), { status: 400 });
  }

  const dbPriceMap = new Map(dbRes.rows.map(r => [r.id, Number(r.price)]));
  for (const item of items) {
    const dbPrice = dbPriceMap.get(item.id);
    if (dbPrice === undefined) {
      throw Object.assign(new Error(`Item ${item.id} not found or inactive.`), { status: 400 });
    }
    if (dbPrice > 0 && Math.round(dbPrice * 100) !== Math.round(item.price * 100)) {
      throw Object.assign(
        new Error(`Price mismatch for item ${item.id}: expected ₹${dbPrice}, got ₹${item.price}`),
        { status: 400 }
      );
    }
  }
  return dbPriceMap;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

/**
 * Create an online order (delivery or pickup).
 * Called by routes/orders.js.
 */
async function createOnlineOrder(tenant, data, idempotencyKey = null) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Idempotency check
    if (idempotencyKey) {
      const existing = await repo.findByIdempotencyKey(client, tenant.tenant_id, idempotencyKey);
      if (existing) {
        await client.query('ROLLBACK');
        const meta = existing.metadata || {};
        return {
          orderId:         existing.id,
          razorpayOrderId: meta.razorpay_order_id || null,
          razorpayKeyId:   meta.razorpay_key_id   || null,
          total:           Number(existing.total_amount),
          duplicate:       true,
        };
      }
    }

    // Verify items
    await resolveMenuItems(client, tenant.tenant_id, data.items);

    // Calculate totals
    let subtotal = 0;
    for (const item of data.items) {
      subtotal += item.price * item.qty;
      for (const addon of item.addons || []) subtotal += (addon.price || 0) * item.qty;
    }

    const freeAt      = tenant.free_delivery_above ?? 399;
    const stdFee      = tenant.delivery_fee        ?? 39;
    const deliveryFee = data.order_surface === 'orders'
      ? (data.delivery_type === 'express' ? stdFee * 2 : (subtotal >= freeAt ? 0 : stdFee))
      : 0;

    const { taxAmount, gstSnapshot } = calcGst(tenant, subtotal);
    const total = gstSnapshot && !tenant.gst?.inclusive
      ? subtotal + deliveryFee + taxAmount
      : subtotal + deliveryFee;

    const needsRazorpay      = ['razorpay', 'upi', 'card'].includes(data.payment_method);
    const isImmediateConfirm = ['offline', 'cod'].includes(data.payment_method);
    const orderStatus        = isImmediateConfirm ? 'confirmed' : 'pending';

    // Customer identity resolution (F02)
    const customerId = await customerService.findOrCreate(client, tenant.tenant_id, {
      phone: data.customer_phone,
      name:  data.customer_name,
    });

    const fulfillmentType = data.order_surface === 'tables' ? 'dine_in' : 'delivery';
    const tableIdentifier = data.table_identifier || (data.order_surface === 'tables' ? 'takeaway' : null);

    const metadata = {
      customer_name:     data.customer_name,
      customer_phone:    data.customer_phone,
      table_identifier:  tableIdentifier,
      delivery_address:  data.delivery_address  || null,
      delivery_locality: data.delivery_locality || null,
      delivery_landmark: data.delivery_landmark || null,
      payment_method:    data.payment_method,
      gst:               gstSnapshot,
    };

    const orderId = await repo.insertOrder(client, {
      tenantId: tenant.tenant_id, customerId, sessionId: null,
      channel: 'web', fulfillmentType, orderStatus,
      subtotal, deliveryFee, taxAmount, total,
      specialNotes: data.special_notes || null,
      metadata, idempotencyKey,
    });

    await repo.insertOrderItems(client, tenant.tenant_id, orderId, data.items);

    let razorpayOrderId = null;
    let razorpayKeyId   = null;

    if (needsRazorpay) {
      const totalPaise = Math.round(total * 100);
      const payment    = await razorpay.createPayment(tenant, totalPaise, orderId);
      razorpayOrderId  = payment.razorpayOrderId;
      razorpayKeyId    = payment.razorpayKeyId;
      await repo.updateOrderMetadata(client, orderId, { razorpay_order_id: razorpayOrderId });
    }

    // Write event to outbox inside the same transaction — atomic with the order.
    // The outbox poller delivers it to the in-process bus even if this process restarts.
    await outbox.enqueue(client, tenant.tenant_id, 'order.created', {
      tenantId: tenant.tenant_id, orderId, total, channel: data.order_surface,
      isImmediateConfirm,
      customerName:    data.customer_name,
      customerPhone:   data.customer_phone,
      tableIdentifier, deliveryFee,
      paymentMethod:   data.payment_method,
    });

    await client.query('COMMIT');

    // Also emit immediately for same-process listeners (notifications, etc.).
    // If the process restarts before this line, the poller covers delivery.
    events.emit('order.created', {
      tenantId: tenant.tenant_id, orderId, total, channel: data.order_surface,
      isImmediateConfirm,
      customerName: data.customer_name, customerPhone: data.customer_phone,
      tableIdentifier, deliveryFee, paymentMethod: data.payment_method,
    });

    if (isImmediateConfirm) {
      const orderForNotify = {
        id: orderId, tenant_id: tenant.tenant_id, order_surface: data.order_surface,
        table_identifier: tableIdentifier, customer_name: data.customer_name,
        customer_phone: data.customer_phone, subtotal, delivery_fee: deliveryFee,
        total, payment_method: data.payment_method, status: 'confirmed',
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

/**
 * Create a dine-in order from a QR scan.
 * Called by routes/dine-in.js (POST /order).
 */
async function createDineInOrder(tenant, { sessionId, guestName, guestPhone, items, specialNotes, idempotencyKey }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Idempotency check — prevents duplicate kitchen orders on double-tap / retry
    if (idempotencyKey) {
      const existing = await repo.findByIdempotencyKey(client, tenant.tenant_id, idempotencyKey);
      if (existing) {
        await client.query('ROLLBACK');
        return { orderId: existing.id, total: Number(existing.total_amount), duplicate: true };
      }
    }

    // Verify session open
    const sessionRes = await client.query(
      `SELECT id, session_status, bill_owner_name FROM dining.sessions
       WHERE id = $1 AND tenant_id = $2 AND closed_at IS NULL AND deleted_at IS NULL`,
      [sessionId, tenant.tenant_id]
    );
    if (!sessionRes.rows.length) {
      throw Object.assign(new Error('Session is closed or not found.'), { status: 409 });
    }
    const { session_status, bill_owner_name } = sessionRes.rows[0];
    if (session_status === 'closed' || session_status === 'paid') {
      throw Object.assign(new Error('Session is closed. No more orders can be placed.'), { status: 409 });
    }

    // Customer identity (F02) — resolves or creates; ID now wired to the order row
    const customerId = await customerService.findOrCreate(client, tenant.tenant_id, {
      phone: guestPhone, name: guestName,
    });

    // First scanner with identity becomes bill owner
    if (!bill_owner_name && guestName) {
      await client.query(
        `UPDATE dining.sessions
         SET bill_owner_name = $1, bill_owner_phone = $2, updated_at = NOW()
         WHERE id = $3`,
        [guestName, guestPhone ?? null, sessionId]
      );
    }

    // Resolve item prices from DB
    const itemIds = items.map(i => i.menu_item_id);
    const dbRes   = await client.query(
      `SELECT id, name, price FROM menu.menu_items
       WHERE tenant_id = $1 AND id = ANY($2) AND is_available = TRUE AND deleted_at IS NULL`,
      [tenant.tenant_id, itemIds]
    );
    const priceMap = new Map(dbRes.rows.map(r => [r.id, r]));

    for (const item of items) {
      if (!priceMap.has(item.menu_item_id)) {
        throw Object.assign(
          new Error(`Item ${item.menu_item_id} not found or unavailable.`),
          { status: 400 }
        );
      }
    }

    let subtotal = 0;
    const lineItems = items.map(item => {
      const db    = priceMap.get(item.menu_item_id);
      const price = parseFloat(db.price);
      subtotal   += price * item.quantity;
      return { id: db.id, name: db.name, price, qty: item.quantity, note: item.customizations ?? null };
    });

    const guestMeta = { guest_name: guestName, guest_phone: guestPhone };

    const orderId = await repo.insertDineInOrder(client, {
      tenantId: tenant.tenant_id, customerId, sessionId, subtotal, specialNotes, guestMeta, idempotencyKey,
    });
    await repo.insertDineInOrderItems(client, tenant.tenant_id, orderId, lineItems);

    // Enqueue inside the same transaction — durable delivery even if process restarts
    await outbox.enqueue(client, tenant.tenant_id, 'dine_in.order_created', {
      tenantId: tenant.tenant_id, orderId, sessionId, total: subtotal,
    });

    await client.query('COMMIT');

    // Also emit immediately for same-process listeners
    events.emit('dine_in.order_created', {
      tenantId: tenant.tenant_id, orderId, sessionId, total: subtotal,
    });

    return { orderId, total: parseFloat(subtotal.toFixed(2)) };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Update order status. Called by routes/orders.js PATCH /:id.
 */
async function updateStatus(tenantId, orderId, status) {
  return repo.updateStatus(tenantId, orderId, status);
}

/**
 * Confirm order after Razorpay payment capture.
 * Called by routes/webhooks.js — wraps both the payment write and
 * the order status advance in a single transaction (F04 fix).
 */
async function confirmPayment(client, razorpayOrderId, razorpayPaymentId) {
  return repo.confirmByRazorpayOrderId(client, razorpayOrderId, razorpayPaymentId);
}

module.exports = {
  createOnlineOrder,
  createDineInOrder,
  updateStatus,
  confirmPayment,
};
