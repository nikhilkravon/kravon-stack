'use strict';

/**
 * Customer domain — repository.
 *
 * All SQL for customer.customers lives here.
 * No route or service imports this directly from outside the domain — they
 * call CustomerService instead.
 */

const { query } = require('../../db/pool');

async function findByPhone(client, tenantId, phone) {
  const q   = client ? client.query.bind(client) : query;
  const res = await q(
    `SELECT id, name, phone, email FROM customer.customers
     WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL
     LIMIT 1`,
    [tenantId, phone]
  );
  return res.rows[0] || null;
}

async function findById(tenantId, customerId) {
  const res = await query(
    `SELECT id, name, phone, email, created_at, updated_at
     FROM customer.customers
     WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [tenantId, customerId]
  );
  return res.rows[0] || null;
}

/**
 * Upsert by phone. Returns the customer row (id guaranteed).
 * Uses ON CONFLICT so concurrent calls are safe.
 */
async function upsertByPhone(client, tenantId, { phone, name, email = null }) {
  const res = await client.query(
    `INSERT INTO customer.customers (tenant_id, name, phone, email, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (tenant_id, phone) WHERE phone IS NOT NULL AND deleted_at IS NULL
     DO UPDATE SET
       name       = EXCLUDED.name,
       email      = COALESCE(EXCLUDED.email, customer.customers.email),
       updated_at = NOW()
     RETURNING id, name, phone, email`,
    [tenantId, name || null, phone, email]
  );
  return res.rows[0];
}

async function listPaginated(tenantId, { page = 1, limit = 25, search = null } = {}) {
  const offset  = (page - 1) * limit;
  const params  = [tenantId];
  const filters = ['c.tenant_id = $1', 'c.deleted_at IS NULL'];

  if (search) {
    params.push(`%${search}%`);
    filters.push(`(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.email ILIKE $${params.length})`);
  }

  const where = `WHERE ${filters.join(' AND ')}`;

  const [listRes, countRes] = await Promise.all([
    query(
      `SELECT c.id, c.name, c.phone, c.email, c.notes, c.tags, c.created_at,
              COUNT(o.id)         AS order_count,
              SUM(o.total_amount) AS total_spent,
              MAX(o.created_at)   AS last_order_at
       FROM customer.customers c
       LEFT JOIN orders.orders o
         ON o.customer_id = c.id
         AND o.status NOT IN ('cancelled','refunded')
         AND o.deleted_at IS NULL
       ${where}
       GROUP BY c.id
       ORDER BY last_order_at DESC NULLS LAST, c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*) AS total FROM customer.customers c ${where}`, params),
  ]);

  return {
    customers: listRes.rows.map(r => ({
      ...r,
      order_count: Number(r.order_count),
      total_spent: r.total_spent ? Number(r.total_spent) : null,
    })),
    total: parseInt(countRes.rows[0].total, 10),
  };
}

async function updateNotes(tenantId, customerId, { notes, tags }) {
  const sets = []; const values = []; let idx = 1;
  if (notes !== undefined) { sets.push(`notes = $${idx++}`); values.push(notes); }
  if (tags  !== undefined) { sets.push(`tags  = $${idx++}`); values.push(tags); }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  values.push(customerId, tenantId);
  const res = await query(
    `UPDATE customer.customers SET ${sets.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING id, name, phone, email, notes, tags, updated_at`,
    values
  );
  return res.rows[0] || null;
}

module.exports = { findByPhone, findById, upsertByPhone, listPaginated, updateNotes };
