'use strict';

/**
 * Ordering domain — repository.
 *
 * All SQL for orders.orders and orders.order_items lives here.
 * Services call these functions; routes never query orders tables directly.
 */

const { query } = require('../../db/pool');

async function findById(tenantId, orderId) {
  const res = await query(
    `SELECT * FROM orders.orders WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    [orderId, tenantId]
  );
  return res.rows[0] || null;
}

async function findByIdempotencyKey(client, tenantId, key) {
  const res = await client.query(
    `SELECT id, total_amount, metadata FROM orders.orders
     WHERE tenant_id = $1 AND idempotency_key = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId, key]
  );
  return res.rows[0] || null;
}

async function insertOrder(client, {
  tenantId, customerId, sessionId, channel, fulfillmentType,
  orderStatus, subtotal, deliveryFee, taxAmount, total,
  specialNotes, metadata, idempotencyKey,
}) {
  const res = await client.query(`
    INSERT INTO orders.orders (
      tenant_id, customer_id, session_id, channel, fulfillment_type, status,
      subtotal_amount, delivery_charge, tax_amount, discount_amount,
      tip_amount, packaging_charge, total_amount,
      special_instructions, metadata, idempotency_key
    ) VALUES ($1,$2,$3,'web',$4,$5,$6,$7,$8,0,0,0,$9,$10,$11,$12)
    RETURNING id
  `, [
    tenantId, customerId, sessionId || null, channel, fulfillmentType,
    orderStatus, subtotal, deliveryFee, taxAmount, total,
    specialNotes || null, JSON.stringify(metadata), idempotencyKey || null,
  ]);
  return res.rows[0].id;
}

async function insertDineInOrder(client, {
  tenantId, customerId, sessionId, subtotal, specialNotes, guestMeta, idempotencyKey,
}) {
  const res = await client.query(
    `INSERT INTO orders.orders (
       tenant_id, customer_id, session_id, channel, fulfillment_type,
       status, subtotal_amount, tax_amount, total_amount,
       special_instructions, metadata, idempotency_key
     ) VALUES ($1, $2, $3, 'qr', 'dine_in', 'confirmed', $4, 0, $4, $5, $6, $7)
     RETURNING id`,
    [tenantId, customerId || null, sessionId, subtotal, specialNotes || null, JSON.stringify(guestMeta), idempotencyKey || null]
  );
  return res.rows[0].id;
}

async function insertOrderItems(client, tenantId, orderId, items) {
  for (const item of items) {
    const addonsTotal = (item.addons || []).reduce((s, a) => s + (a.price || 0) * item.qty, 0);
    await client.query(`
      INSERT INTO orders.order_items (
        tenant_id, order_id, menu_item_id,
        item_name, unit_price, quantity,
        addons_total, total_price,
        special_note
      ) VALUES ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9)
    `, [
      tenantId, orderId, item.id, item.name, item.price, item.qty,
      addonsTotal, item.price * item.qty + addonsTotal, item.note || null,
    ]);
  }
}

async function insertDineInOrderItems(client, tenantId, orderId, lineItems) {
  for (const line of lineItems) {
    const lineTotal = parseFloat((line.price * line.qty).toFixed(2));
    await client.query(
      `INSERT INTO orders.order_items (
         tenant_id, order_id, menu_item_id,
         item_name, unit_price, tax_rate, quantity,
         addons_total, total_price, special_note
       ) VALUES ($1, $2, $3, $4, $5, 0, $6, 0, $7, $8)`,
      [tenantId, orderId, line.id, line.name, line.price, line.qty, lineTotal, line.note || null]
    );
  }
}

async function updateOrderMetadata(client, orderId, patch) {
  await client.query(
    `UPDATE orders.orders SET metadata = metadata || $1 WHERE id = $2`,
    [JSON.stringify(patch), orderId]
  );
}

async function updateStatus(tenantId, orderId, status) {
  const res = await query(
    `UPDATE orders.orders
     SET status = $1, updated_at = NOW()
     WHERE id = $2::uuid AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING id, status, updated_at`,
    [status, orderId, tenantId]
  );
  return res.rows[0] || null;
}

async function confirmByRazorpayOrderId(client, razorpayOrderId, razorpayPaymentId) {
  const res = await client.query(
    `UPDATE orders.orders
     SET status     = 'confirmed',
         metadata   = metadata || $1,
         updated_at = NOW()
     WHERE metadata->>'razorpay_order_id' = $2
       AND status = 'pending'
     RETURNING *`,
    [JSON.stringify({ razorpay_payment_id: razorpayPaymentId }), razorpayOrderId]
  );
  return res.rows[0] || null;
}

async function listPaginated(tenantId, { page = 1, limit = 25, status = null, channel = null, fulfillment_type = null } = {}) {
  const params  = [tenantId];
  const filters = ['o.tenant_id = $1', 'o.deleted_at IS NULL'];

  if (status) {
    if (status === 'completed') {
      filters.push(`o.status IN ('completed','delivered')`);
    } else if (status === 'live') {
      filters.push(`o.status IN ('pending','confirmed','preparing','ready','out_for_delivery')`);
    } else {
      params.push(status);
      filters.push(`o.status = $${params.length}`);
    }
  }
  if (channel) {
    params.push(channel);
    filters.push(`o.channel = $${params.length}`);
  }
  if (fulfillment_type) {
    params.push(fulfillment_type);
    filters.push(`o.fulfillment_type = $${params.length}`);
  }

  const where  = `WHERE ${filters.join(' AND ')}`;
  const offset = (page - 1) * limit;

  const [listRes, countRes] = await Promise.all([
    query(
      `SELECT o.id, o.channel, o.fulfillment_type, o.status,
              o.total_amount, o.created_at,
              o.metadata->>'payment_method'    AS payment_method,
              o.metadata->>'table_identifier'  AS table_identifier,
              c.name  AS customer_name,
              c.phone AS customer_phone,
              COALESCE(
                json_agg(
                  json_build_object(
                    'name', oi.item_name,
                    'qty',  oi.quantity,
                    'price', oi.unit_price
                  )
                ) FILTER (WHERE oi.id IS NOT NULL),
                '[]'
              ) AS items
       FROM orders.orders o
       LEFT JOIN customer.customers c  ON c.id = o.customer_id AND c.deleted_at IS NULL
       LEFT JOIN orders.order_items oi ON oi.order_id = o.id
       ${where}
       GROUP BY o.id, c.name, c.phone
       ORDER BY o.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*) AS total FROM orders.orders o ${where}`, params),
  ]);

  return {
    orders: listRes.rows.map(o => ({ ...o, total_amount: Number(o.total_amount) })),
    total:  parseInt(countRes.rows[0].total, 10),
  };
}

async function getItems(tenantId, orderId) {
  const res = await query(
    `SELECT oi.item_name, oi.quantity, oi.unit_price, oi.total_price, oi.special_note
     FROM orders.order_items oi
     JOIN orders.orders o ON o.id = oi.order_id
     WHERE oi.order_id = $1::uuid AND o.tenant_id = $2`,
    [orderId, tenantId]
  );
  return res.rows.map(r => ({
    ...r,
    unit_price:  Number(r.unit_price),
    total_price: Number(r.total_price),
  }));
}

module.exports = {
  findById, findByIdempotencyKey,
  insertOrder, insertDineInOrder,
  insertOrderItems, insertDineInOrderItems,
  updateOrderMetadata, updateStatus,
  confirmByRazorpayOrderId,
  listPaginated, getItems,
};
