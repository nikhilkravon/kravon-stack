'use strict';

/**
 * Dining domain — sessions service.
 *
 * Owns: session open/close, session status, bill request, bill summary.
 * Does NOT own order creation (Ordering domain), order listing (Ordering reads).
 */

const { query, getClient } = require('../../db/pool');
const events               = require('../../utils/events');
const audit                = require('../../utils/audit');

async function openSession(tenant, { table_id, covers, reservation_id }, staffId) {
  const tenant_id = tenant.tenant_id;
  const client    = await getClient();
  try {
    await client.query('BEGIN');

    const tableRes = await client.query(
      `SELECT id FROM dining.tables
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [table_id, tenant_id]
    );
    if (!tableRes.rows.length) {
      await client.query('ROLLBACK');
      return { error: 'Table not found.', status: 404 };
    }

    const openCheck = await client.query(
      `SELECT id FROM dining.sessions
       WHERE table_id = $1 AND closed_at IS NULL AND deleted_at IS NULL`,
      [table_id]
    );
    if (openCheck.rows.length) {
      await client.query('ROLLBACK');
      return { error: 'Table already has an open session.', status: 409 };
    }

    const sessionRes = await client.query(
      `INSERT INTO dining.sessions (tenant_id, table_id, covers, reservation_id, opened_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, opened_at`,
      [tenant_id, table_id, covers ?? null, reservation_id ?? null]
    );

    await client.query(
      `UPDATE dining.tables SET status = 'occupied', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [table_id, tenant_id]
    );

    if (reservation_id) {
      await client.query(
        `UPDATE dining.reservations
         SET status = 'seated', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [reservation_id, tenant_id]
      );
    }

    const { id: session_id, opened_at } = sessionRes.rows[0];
    await audit.log(client, {
      tenantId: tenant_id, actorId: staffId, actorType: 'staff',
      action: 'session.open', entityType: 'dining.session', entityId: session_id,
      newValue: { table_id, covers: covers ?? null, reservation_id: reservation_id ?? null },
    });

    // Clear any pending "guests waiting" notifications for this table
    await client.query(
      `UPDATE notifications.notifications
       SET read_at = NOW()
       WHERE tenant_id = $1 AND type = 'dine_in.staff_notify'
         AND entity_id = $2 AND read_at IS NULL`,
      [tenant_id, table_id]
    );

    await client.query('COMMIT');
    events.emit('session.opened', { tenantId: tenant_id, sessionId: session_id, tableId: table_id, covers: covers ?? null });
    return { session_id, table_id, opened_at, reservation_id: reservation_id ?? null };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closeSession(tenant, { session_id }, staffId) {
  const tenant_id = tenant.tenant_id;
  const client    = await getClient();
  try {
    await client.query('BEGIN');

    const totalRes = await client.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM orders.orders
       WHERE session_id = $1 AND tenant_id = $2
         AND status NOT IN ('cancelled', 'refunded') AND deleted_at IS NULL
       FOR UPDATE`,
      [session_id, tenant_id]
    );
    const totalRupees = parseFloat(totalRes.rows[0].total);

    const closeRes = await client.query(
      `UPDATE dining.sessions
       SET closed_at = NOW(), total_billed = $1
       WHERE id = $2 AND tenant_id = $3 AND closed_at IS NULL
       RETURNING closed_at, table_id`,
      [totalRupees, session_id, tenant_id]
    );
    if (!closeRes.rows.length) {
      await client.query('ROLLBACK');
      return { error: 'Session already closed or not found.', status: 409 };
    }

    const { closed_at, table_id } = closeRes.rows[0];
    await client.query(
      `UPDATE dining.tables SET status = 'available', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [table_id, tenant_id]
    );

    await audit.log(client, {
      tenantId: tenant_id, actorId: staffId, actorType: 'staff',
      action: 'session.close', entityType: 'dining.session', entityId: session_id,
      newValue: { table_id, total_billed: totalRupees },
    });

    // Clear any pending "guests waiting" notifications for this table
    await client.query(
      `UPDATE notifications.notifications
       SET read_at = NOW()
       WHERE tenant_id = $1 AND type = 'dine_in.staff_notify'
         AND entity_id = $2 AND read_at IS NULL`,
      [tenant_id, table_id]
    );

    await client.query('COMMIT');

    // Create settlement after COMMIT so a crash between the two doesn't leave
    // an orphaned settlement pointing at an unclosed session.
    let settlement_id = null;
    let settlementTotal = totalRupees;
    try {
      const billingService = require('../billing/service');
      const settlResult = await billingService.createFromSession(tenant, session_id, staffId);
      if (settlResult.settlement) {
        settlement_id   = settlResult.settlement.id;
        settlementTotal = settlResult.settlement.total ?? totalRupees;
      }
    } catch (settlErr) {
      // Non-fatal: session close already committed; settlement can be created manually.
    }

    events.emit('session.closed', { tenantId: tenant_id, sessionId: session_id, tableId: table_id, totalBilled: settlementTotal });
    return { session_id, closed_at, total_billed: totalRupees, settlement_id };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getStatus(tenant_id, table_id) {
  if (!UUID_RE.test(table_id)) return { error: 'table_id must be a UUID', status: 400 };

  const tableCheck = await query(
    `SELECT id FROM dining.tables WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [table_id, tenant_id]
  );
  if (!tableCheck.rows.length) return { error: 'Table not found.', status: 404 };

  const result = await query(
    `SELECT s.id, s.opened_at, s.covers, s.session_status,
            s.bill_owner_name, s.bill_requested_at,
            t.name AS table_name
     FROM dining.sessions s
     JOIN dining.tables t ON t.id = s.table_id
     WHERE s.table_id = $1 AND s.tenant_id = $2
       AND s.closed_at IS NULL AND s.deleted_at IS NULL
     LIMIT 1`,
    [table_id, tenant_id]
  );

  if (!result.rows.length) {
    // No open session — check for recently closed session to surface session_status (e.g. 'paid')
    const closed = await query(
      `SELECT s.session_status
       FROM dining.sessions s
       WHERE s.table_id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL
       ORDER BY s.closed_at DESC NULLS LAST
       LIMIT 1`,
      [table_id, tenant_id]
    );
    const lastStatus = closed.rows[0]?.session_status || null;
    return { open: false, session_status: lastStatus };
  }

  const { id: session_id, opened_at, covers, table_name,
          session_status, bill_owner_name, bill_requested_at } = result.rows[0];
  return {
    open: true, session_id, table_name, opened_at, covers,
    session_status,
    has_bill_owner:   !!bill_owner_name,
    bill_owner_name:  bill_owner_name || null,
    bill_requested:   !!bill_requested_at,
  };
}

async function getSessionOrders(tenant_id, session_id) {
  if (!UUID_RE.test(session_id)) return { error: 'session_id must be a UUID', status: 400 };

  const result = await query(
    `SELECT
       o.id           AS order_id,
       o.created_at,
       o.status,
       o.total_amount AS total,
       o.metadata     ->> 'guest_name' AS guest_name,
       json_agg(
         json_build_object('name', oi.item_name, 'qty', oi.quantity, 'price', oi.unit_price)
         ORDER BY oi.id
       ) AS items
     FROM orders.orders o
     JOIN orders.order_items oi ON oi.order_id = o.id
     JOIN dining.sessions s ON s.id = o.session_id
     WHERE o.session_id = $1 AND o.tenant_id = $2
       AND o.status NOT IN ('cancelled', 'refunded') AND o.deleted_at IS NULL
       AND s.deleted_at IS NULL
     GROUP BY o.id
     ORDER BY o.created_at ASC`,
    [session_id, tenant_id]
  );
  return { orders: result.rows };
}

async function requestBill(tenant_id, { session_id, requested_by }) {
  if (!UUID_RE.test(session_id)) return { error: 'session_id must be a UUID', status: 400 };

  const result = await query(
    `UPDATE dining.sessions
     SET session_status    = 'bill_requested',
         bill_requested_at = COALESCE(bill_requested_at, NOW()),
         bill_requested_by = COALESCE(bill_requested_by, $3),
         updated_at        = NOW()
     WHERE id = $1 AND tenant_id = $2 AND closed_at IS NULL AND deleted_at IS NULL
     RETURNING id, session_status, bill_requested_at, table_id`,
    [session_id, tenant_id, requested_by ?? null]
  );

  if (!result.rows.length) return { error: 'Session not found or already closed.', status: 404 };

  const tableRow = await query(
    `SELECT name FROM dining.tables WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [result.rows[0].table_id, tenant_id]
  );
  const tableName = tableRow.rows[0]?.name || 'Unknown table';

  events.emit('dine_in.bill_requested', { tenantId: tenant_id, sessionId: session_id, requestedBy: requested_by ?? null });
  return { bill_requested_at: result.rows[0].bill_requested_at };
}

async function getBill(tenant_id, session_id) {
  if (!UUID_RE.test(session_id)) return { error: 'session_id must be a UUID', status: 400 };

  const result = await query(
    `SELECT
       s.id       AS session_id,
       t.name     AS table_name,
       s.covers,
       s.opened_at,
       s.closed_at,
       json_agg(
         json_build_object(
           'order_id', o.id, 'subtotal', o.subtotal_amount,
           'total', o.total_amount, 'tax', o.tax_amount,
           'gst', o.metadata->'gst', 'items', oi.items_agg
         ) ORDER BY o.created_at
       ) AS orders,
       SUM(o.subtotal_amount) AS subtotal,
       SUM(o.total_amount)    AS grand_total,
       SUM(o.tax_amount)      AS total_tax
     FROM dining.sessions s
     JOIN dining.tables t ON t.id = s.table_id
     JOIN orders.orders o
       ON o.session_id = s.id AND o.status NOT IN ('cancelled', 'refunded') AND o.deleted_at IS NULL
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('name', oi2.item_name, 'qty', oi2.quantity, 'price', oi2.unit_price)) AS items_agg
       FROM orders.order_items oi2 WHERE oi2.order_id = o.id
     ) oi ON TRUE
     WHERE s.id = $1 AND s.tenant_id = $2
     GROUP BY s.id, t.name, s.covers, s.opened_at, s.closed_at`,
    [session_id, tenant_id]
  );

  if (!result.rows.length) return { error: 'Session not found or has no billable orders.', status: 404 };

  const row    = result.rows[0];
  const orders = row.orders || [];

  const snapshots = orders.map(o => o.gst).filter(g => g && g.cgst_rate != null);
  let gst_snapshot = null, gst_inconsistent = false;
  if (snapshots.length > 0) {
    gst_snapshot = snapshots[0];
    gst_inconsistent = snapshots.some(g =>
      g.cgst_rate !== gst_snapshot.cgst_rate || g.sgst_rate !== gst_snapshot.sgst_rate ||
      g.inclusive !== gst_snapshot.inclusive || g.gstin !== gst_snapshot.gstin
    );
  }

  const subtotal      = parseFloat(row.subtotal    || 0);
  const grand_total   = parseFloat(row.grand_total  || 0);
  const total_tax     = parseFloat(row.total_tax    || 0);
  const taxable_amount = gst_snapshot?.inclusive
    ? parseFloat((subtotal - total_tax).toFixed(2))
    : subtotal;

  const cgst_amount = gst_snapshot
    ? parseFloat((total_tax * gst_snapshot.cgst_rate / (gst_snapshot.cgst_rate + gst_snapshot.sgst_rate)).toFixed(2))
    : 0;
  const sgst_amount = gst_snapshot ? parseFloat((total_tax - cgst_amount).toFixed(2)) : 0;

  return {
    bill: {
      session_id: row.session_id, table_name: row.table_name, covers: row.covers,
      opened_at: row.opened_at, closed_at: row.closed_at, orders,
      subtotal, taxable_amount, cgst_amount, sgst_amount, total_tax, grand_total,
      gst_snapshot, gst_inconsistent,
    },
  };
}

async function getTableName(tenant_id, table_id) {
  if (!UUID_RE.test(table_id)) return null;
  const res = await query(
    `SELECT name FROM dining.tables WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [table_id, tenant_id]
  );
  return res.rows[0]?.name || null;
}

async function notifyStaffTableReady(tenant, table_id) {
  if (!UUID_RE.test(table_id)) return { error: 'table_id must be a UUID', status: 400 };

  const res = await query(
    `SELECT name FROM dining.tables WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [table_id, tenant.tenant_id]
  );
  if (!res.rows.length) return { error: 'Table not found.', status: 404 };

  const tableName = res.rows[0].name;

  // Fire in-process event — notification.listeners.js will create the in-app alert
  events.emit('dine_in.staff_notify', {
    tenantId: tenant.tenant_id,
    tableId:  table_id,
    tableName,
  });

  return { notified: true };
}

function _buildClosedSessionsQuery(tenant_id, {
  limit = 50, offset = 0,
  date_from = null, date_to = null,
  table_search = null, payment_mode = null,
} = {}) {
  const params  = [tenant_id];
  const filters = [
    `s.tenant_id = $1`,
    `s.closed_at IS NOT NULL`,
    `s.deleted_at IS NULL`,
  ];

  if (date_from) { params.push(date_from); filters.push(`s.closed_at >= $${params.length}`); }
  if (date_to)   { params.push(date_to);   filters.push(`s.closed_at <  $${params.length}`); }
  if (table_search) { params.push(`%${table_search}%`); filters.push(`t.name ILIKE $${params.length}`); }
  if (payment_mode) { params.push(payment_mode); filters.push(`o2.payment_method = $${params.length}`); }

  const where = filters.join(' AND ');
  return { params, where };
}

async function listClosedSessions(tenant_id, opts = {}) {
  const { limit = 50, offset = 0 } = opts;
  const { params, where } = _buildClosedSessionsQuery(tenant_id, opts);

  const [result, countRes] = await Promise.all([
    query(
      `SELECT
         s.id          AS session_id,
         t.name        AS table_name,
         s.covers,
         s.opened_at,
         s.closed_at,
         COALESCE(SUM(o.total_amount) FILTER (WHERE o.status NOT IN ('cancelled','refunded')), 0) AS grand_total,
         COUNT(o.id)   FILTER (WHERE o.status NOT IN ('cancelled','refunded'))                    AS order_count,
         o2.payment_method
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       LEFT JOIN orders.orders o
         ON o.session_id = s.id AND o.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT metadata->>'payment_method' AS payment_method
         FROM orders.orders
         WHERE session_id = s.id AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1
       ) o2 ON TRUE
       WHERE ${where}
       GROUP BY s.id, t.name, s.covers, s.opened_at, s.closed_at, o2.payment_method
       ORDER BY s.closed_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    query(
      `SELECT COUNT(DISTINCT s.id) AS total
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       LEFT JOIN LATERAL (
         SELECT metadata->>'payment_method' AS payment_method
         FROM orders.orders
         WHERE session_id = s.id AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1
       ) o2 ON TRUE
       WHERE ${where}`,
      params
    ),
  ]);

  return {
    sessions: result.rows.map(r => ({
      ...r,
      grand_total: Number(r.grand_total),
      order_count: Number(r.order_count),
    })),
    total: parseInt(countRes.rows[0].total, 10),
  };
}

async function listClosedSessionsExport(tenant_id, opts = {}) {
  return listClosedSessions(tenant_id, { ...opts, limit: 5000, offset: 0 });
}

module.exports = {
  openSession, closeSession, getStatus, getSessionOrders,
  requestBill, getBill, getTableName, notifyStaffTableReady,
  listClosedSessions, listClosedSessionsExport,
};
