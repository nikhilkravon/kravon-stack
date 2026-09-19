'use strict';

const { query } = require('../../db/pool');

function q(client) {
  return client ? client.query.bind(client) : query;
}

/* ── Items ──────────────────────────────────────────────────────────────── */

// Stock value + uncosted quantity — aggregated from open FIFO lots
// (quantity_remaining > 0). Lots with no unit_cost_paise contribute to
// uncosted_stock instead of being treated as zero-value, so a partially
// costed item doesn't silently understate its value.
const LOT_VALUE_SUBQUERY = `
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(l.unit_cost_paise * l.quantity_remaining) FILTER (WHERE l.unit_cost_paise IS NOT NULL), 0) AS stock_value_paise,
      COALESCE(SUM(l.quantity_remaining) FILTER (WHERE l.unit_cost_paise IS NULL), 0) AS uncosted_stock
    FROM inventory.purchase_lots l
    WHERE l.inventory_item_id = i.id AND l.quantity_remaining > 0
  ) v ON TRUE
`;

function _normalizeItemRow(row) {
  return {
    ...row,
    current_stock:       Number(row.current_stock),
    low_stock_threshold: row.low_stock_threshold !== null ? Number(row.low_stock_threshold) : null,
    stock_value_paise:   Number(row.stock_value_paise || 0),
    uncosted_stock:      Number(row.uncosted_stock || 0),
  };
}

async function listItems(tenantId) {
  const res = await query(
    `SELECT i.id, i.name, i.unit, i.low_stock_threshold, i.metadata, i.created_at, i.updated_at,
            COALESCE(s.current_stock, 0)   AS current_stock,
            COALESCE(s.is_low_stock, FALSE) AS is_low_stock,
            s.last_movement_at,
            v.stock_value_paise, v.uncosted_stock
     FROM inventory.items i
     LEFT JOIN inventory.stock_levels s ON s.inventory_item_id = i.id
     ${LOT_VALUE_SUBQUERY}
     WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
     ORDER BY i.name`,
    [tenantId]
  );
  return res.rows.map(_normalizeItemRow);
}

async function getItem(tenantId, id) {
  const res = await query(
    `SELECT i.id, i.name, i.unit, i.low_stock_threshold, i.metadata, i.created_at, i.updated_at,
            COALESCE(s.current_stock, 0)   AS current_stock,
            COALESCE(s.is_low_stock, FALSE) AS is_low_stock,
            s.last_movement_at,
            v.stock_value_paise, v.uncosted_stock
     FROM inventory.items i
     LEFT JOIN inventory.stock_levels s ON s.inventory_item_id = i.id
     ${LOT_VALUE_SUBQUERY}
     WHERE i.id = $1 AND i.tenant_id = $2 AND i.deleted_at IS NULL`,
    [id, tenantId]
  );
  const row = res.rows[0];
  return row ? _normalizeItemRow(row) : null;
}

async function insertItem(tenantId, d) {
  const res = await query(
    `INSERT INTO inventory.items (tenant_id, name, unit, low_stock_threshold, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, unit, low_stock_threshold, metadata, created_at`,
    [tenantId, d.name, d.unit ?? null, d.low_stock_threshold ?? null, d.metadata ?? {}]
  );
  const row = res.rows[0];
  row.low_stock_threshold = row.low_stock_threshold !== null ? Number(row.low_stock_threshold) : null;
  return row;
}

async function updateItem(tenantId, id, d) {
  const sets = []; const values = []; let idx = 1;
  if (d.name                !== undefined) { sets.push(`name = $${idx++}`);                values.push(d.name); }
  if (d.unit                !== undefined) { sets.push(`unit = $${idx++}`);                values.push(d.unit ?? null); }
  if (d.low_stock_threshold !== undefined) { sets.push(`low_stock_threshold = $${idx++}`); values.push(d.low_stock_threshold ?? null); }
  if (d.metadata            !== undefined) { sets.push(`metadata = $${idx++}`);            values.push(d.metadata ?? {}); }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  values.push(id, tenantId);
  const res = await query(
    `UPDATE inventory.items SET ${sets.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING id, name, unit, low_stock_threshold, metadata, updated_at`,
    values
  );
  const row = res.rows[0];
  if (!row) return null;
  row.low_stock_threshold = row.low_stock_threshold !== null ? Number(row.low_stock_threshold) : null;
  return row;
}

async function softDeleteItem(tenantId, id) {
  const res = await query(
    `UPDATE inventory.items SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

async function verifyItem(tenantId, id) {
  const res = await query(
    `SELECT id FROM inventory.items WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

// Locks the item row for the duration of the caller's transaction — used at
// the start of recordMovement so two concurrent movements against the same
// item serialize instead of both reading the same pre-commit stock level.
// inventory.stock_levels is a view over inventory.movements with no row of
// its own to lock; locking inventory.items achieves the same serialization
// per item without taking a table-level lock on the movements ledger.
async function lockItem(client, tenantId, id) {
  const res = await client.query(
    `SELECT id FROM inventory.items WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

/* ── Stock level (single item, used inside movement transactions) ────────── */

async function getStockLevel(client, tenantId, itemId) {
  const res = await q(client)(
    `SELECT current_stock, is_low_stock FROM inventory.stock_levels
     WHERE inventory_item_id = $1 AND tenant_id = $2`,
    [itemId, tenantId]
  );
  const row = res.rows[0];
  return row ? { current_stock: Number(row.current_stock), is_low_stock: row.is_low_stock } : { current_stock: 0, is_low_stock: false };
}

/* ── Movements ──────────────────────────────────────────────────────────── */

async function insertMovement(client, tenantId, d) {
  const res = await q(client)(
    `INSERT INTO inventory.movements
       (tenant_id, inventory_item_id, movement_type, quantity, reference_type, reference_id, notes, metadata, cogs_paise)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, inventory_item_id, movement_type, quantity, reference_type, reference_id, notes, cogs_paise, created_at`,
    [
      tenantId, d.inventory_item_id, d.movement_type, d.quantity,
      d.reference_type ?? null, d.reference_id ?? null, d.notes ?? null, d.metadata ?? {},
      d.cogs_paise ?? null,
    ]
  );
  const row = res.rows[0];
  row.quantity   = Number(row.quantity);
  row.cogs_paise = row.cogs_paise !== null ? Number(row.cogs_paise) : null;
  return row;
}

async function setMovementCogs(client, movementId, cogsPaise) {
  await q(client)(
    `UPDATE inventory.movements SET cogs_paise = $1 WHERE id = $2`,
    [cogsPaise, movementId]
  );
}

async function listMovements(tenantId, itemId, { limit = 50, cursor = null } = {}) {
  const params = [itemId, tenantId];
  let cursorClause = '';
  if (cursor) {
    params.push(cursor);
    cursorClause = `AND created_at < $${params.length}`;
  }
  params.push(limit);
  const res = await query(
    `SELECT id, movement_type, quantity, reference_type, reference_id, notes, cogs_paise, created_at
     FROM inventory.movements
     WHERE inventory_item_id = $1 AND tenant_id = $2 ${cursorClause}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows.map(r => ({
    ...r,
    quantity:   Number(r.quantity),
    cogs_paise: r.cogs_paise !== null ? Number(r.cogs_paise) : null,
  }));
}

/* ── Vendors ────────────────────────────────────────────────────────────── */

async function listVendors(tenantId) {
  const res = await query(
    `SELECT id, name, phone, email, notes, metadata, created_at, updated_at
     FROM inventory.vendors
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY name`,
    [tenantId]
  );
  return res.rows;
}

async function insertVendor(tenantId, d) {
  const res = await query(
    `INSERT INTO inventory.vendors (tenant_id, name, phone, email, notes, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, phone, email, notes, metadata, created_at`,
    [tenantId, d.name, d.phone ?? null, d.email ?? null, d.notes ?? null, d.metadata ?? {}]
  );
  return res.rows[0];
}

async function updateVendor(tenantId, id, d) {
  const sets = []; const values = []; let idx = 1;
  if (d.name     !== undefined) { sets.push(`name = $${idx++}`);     values.push(d.name); }
  if (d.phone    !== undefined) { sets.push(`phone = $${idx++}`);    values.push(d.phone ?? null); }
  if (d.email    !== undefined) { sets.push(`email = $${idx++}`);    values.push(d.email ?? null); }
  if (d.notes    !== undefined) { sets.push(`notes = $${idx++}`);    values.push(d.notes ?? null); }
  if (d.metadata !== undefined) { sets.push(`metadata = $${idx++}`); values.push(d.metadata ?? {}); }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  values.push(id, tenantId);
  const res = await query(
    `UPDATE inventory.vendors SET ${sets.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING id, name, phone, email, notes, metadata, updated_at`,
    values
  );
  return res.rows[0] || null;
}

async function softDeleteVendor(tenantId, id) {
  const res = await query(
    `UPDATE inventory.vendors SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

async function verifyVendor(tenantId, id) {
  const res = await query(
    `SELECT id FROM inventory.vendors WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

/* ── Purchase lots (FIFO costing) ──────────────────────────────────────── */

async function insertLot(client, tenantId, d) {
  const res = await q(client)(
    `INSERT INTO inventory.purchase_lots
       (tenant_id, inventory_item_id, movement_id, vendor_id, unit_cost_paise, quantity_received, quantity_remaining, received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$6,COALESCE($7, NOW()))
     RETURNING id, inventory_item_id, movement_id, vendor_id, unit_cost_paise, quantity_received, quantity_remaining, received_at`,
    [
      tenantId, d.inventory_item_id, d.movement_id ?? null, d.vendor_id ?? null,
      d.unit_cost_paise ?? null, d.quantity, d.received_at ?? null,
    ]
  );
  const row = res.rows[0];
  row.unit_cost_paise    = row.unit_cost_paise !== null ? Number(row.unit_cost_paise) : null;
  row.quantity_received  = Number(row.quantity_received);
  row.quantity_remaining = Number(row.quantity_remaining);
  return row;
}

// Locks open lots for this item within the caller's transaction — prevents
// two concurrent depleting movements from double-consuming the same lot.
async function listOpenLotsForConsumption(client, tenantId, itemId) {
  const res = await q(client)(
    `SELECT id, unit_cost_paise, quantity_remaining
     FROM inventory.purchase_lots
     WHERE inventory_item_id = $1 AND tenant_id = $2 AND quantity_remaining > 0
     ORDER BY received_at ASC, created_at ASC
     FOR UPDATE`,
    [itemId, tenantId]
  );
  return res.rows.map(r => ({
    ...r,
    unit_cost_paise:    r.unit_cost_paise !== null ? Number(r.unit_cost_paise) : null,
    quantity_remaining: Number(r.quantity_remaining),
  }));
}

async function decrementLot(client, lotId, consumedQty) {
  await q(client)(
    `UPDATE inventory.purchase_lots SET quantity_remaining = quantity_remaining - $1 WHERE id = $2`,
    [consumedQty, lotId]
  );
}

module.exports = {
  listItems, getItem, insertItem, updateItem, softDeleteItem, verifyItem, lockItem,
  getStockLevel, insertMovement, setMovementCogs, listMovements,
  listVendors, insertVendor, updateVendor, softDeleteVendor, verifyVendor,
  insertLot, listOpenLotsForConsumption, decrementLot,
};
