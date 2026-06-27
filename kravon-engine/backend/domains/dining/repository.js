'use strict';

const { query } = require('../../db/pool');

/* ── Tables ─────────────────────────────────────────────────────────────── */

async function listTables(tenantId) {
  const res = await query(
    `SELECT
       t.id, t.name, t.capacity, t.floor, t.status, t.qr_code, t.is_active,
       t.created_at, t.updated_at,
       s.id                AS session_id,
       s.opened_at         AS session_opened_at,
       s.covers            AS session_covers,
       s.session_status    AS session_status,
       s.bill_owner_name   AS session_bill_owner,
       s.bill_requested_at AS session_bill_requested_at,
       COALESCE(
         (SELECT SUM(o.total_amount)
          FROM orders.orders o
          WHERE o.session_id = s.id
            AND o.status NOT IN ('cancelled','refunded')
            AND o.deleted_at IS NULL),
         0
       ) AS session_total,
       (SELECT n.created_at
        FROM notifications.notifications n
        WHERE n.tenant_id = $1
          AND n.type = 'dine_in.staff_notify'
          AND n.entity_id = t.id::text
          AND n.read_at IS NULL
        ORDER BY n.created_at DESC
        LIMIT 1
       ) AS staff_notify_at
     FROM dining.tables t
     LEFT JOIN dining.sessions s
       ON s.table_id = t.id AND s.closed_at IS NULL AND s.deleted_at IS NULL
     WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
     ORDER BY t.name`,
    [tenantId]
  );
  return res.rows;
}

async function listOpenSessions(tenantId) {
  const res = await query(
    `SELECT
       s.id, s.opened_at, s.covers,
       t.name AS table_name, t.capacity,
       COALESCE(
         (SELECT SUM(o.total_amount)
          FROM orders.orders o
          WHERE o.session_id = s.id
            AND o.status NOT IN ('cancelled','refunded')
            AND o.deleted_at IS NULL),
         0
       ) AS total,
       (SELECT COUNT(*)
        FROM orders.orders o
        WHERE o.session_id = s.id AND o.deleted_at IS NULL) AS order_count
     FROM dining.sessions s
     JOIN dining.tables t ON t.id = s.table_id
     WHERE s.tenant_id = $1 AND s.closed_at IS NULL AND s.deleted_at IS NULL
     ORDER BY s.opened_at ASC`,
    [tenantId]
  );
  return res.rows;
}

async function getLocationId(tenantId) {
  const res = await query(
    `SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1`,
    [tenantId]
  );
  return res.rows[0]?.id || null;
}

async function insertTable(tenantId, locationId, { name, capacity, floor }) {
  const res = await query(
    `INSERT INTO dining.tables (tenant_id, location_id, name, capacity, floor, status, is_active)
     VALUES ($1, $2, $3, $4, $5, 'available', TRUE)
     RETURNING id, name, capacity, floor, status, is_active, created_at`,
    [tenantId, locationId, name, capacity ?? null, floor ?? null]
  );
  return res.rows[0];
}

async function setTableQrCode(tableId, qrCode) {
  await query(`UPDATE dining.tables SET qr_code = $1 WHERE id = $2`, [qrCode, tableId]);
}

async function updateTable(tenantId, id, data) {
  const sets = []; const values = []; let idx = 1;
  if (data.name      !== undefined) { sets.push(`name = $${idx++}`);      values.push(data.name); }
  if (data.capacity  !== undefined) { sets.push(`capacity = $${idx++}`);  values.push(data.capacity); }
  if (data.floor     !== undefined) { sets.push(`floor = $${idx++}`);     values.push(data.floor); }
  if (data.is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(data.is_active); }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  values.push(id, tenantId);
  const res = await query(
    `UPDATE dining.tables SET ${sets.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING id, name, capacity, floor, status, is_active, updated_at`,
    values
  );
  return res.rows[0] || null;
}

async function hasOpenSession(tableId) {
  const res = await query(
    `SELECT id FROM dining.sessions WHERE table_id = $1 AND closed_at IS NULL AND deleted_at IS NULL LIMIT 1`,
    [tableId]
  );
  return res.rows.length > 0;
}

async function softDeleteTable(tenantId, id) {
  const res = await query(
    `UPDATE dining.tables SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

async function verifyOrderTenant(tenantId, orderId) {
  const res = await query(
    'SELECT id FROM orders.orders WHERE id = $1::uuid AND tenant_id = $2',
    [orderId, tenantId]
  );
  return res.rows.length > 0;
}

async function insertReview(tenantId, { orderId, sessionId, stars, feedback }) {
  await query(
    `INSERT INTO dining.reviews (tenant_id, order_id, session_id, rating, comment, source)
     VALUES ($1, $2, $3, $4, $5, 'web')`,
    [tenantId, orderId || null, sessionId || null, stars, feedback || null]
  );
}

module.exports = {
  listTables, listOpenSessions,
  getLocationId, insertTable, setTableQrCode, updateTable,
  hasOpenSession, softDeleteTable,
  verifyOrderTenant, insertReview,
};
