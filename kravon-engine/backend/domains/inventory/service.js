'use strict';

/**
 * Inventory domain — service.
 *
 * Manual stock tracking. Stock is never stored directly — inventory.items
 * holds identity + threshold only; inventory.movements is an append-only
 * ledger; inventory.stock_levels (view) sums movements into current_stock.
 * See db/kravon_schema_v20.sql lines 2245-2304.
 *
 * Costing layer (v27): inventory.purchase_lots is a parallel FIFO costing
 * ledger, consulted only for cost/value — it never overrides quantity truth
 * from inventory.movements. A purchase (or a positive adjustment) opens a
 * lot; a wastage/correction/negative-adjustment consumes open lots oldest
 * first and records the resulting COGS on the movement row.
 *
 * Scope: no recipe/BOM link to menu items, no auto-depletion on order
 * creation, no purchase orders. See the approved plans.
 */

const { getClient } = require('../../db/pool');
const repo = require('./repository');

const MOVEMENT_TYPES = ['purchase', 'wastage', 'adjustment', 'correction'];

/* ── Items ──────────────────────────────────────────────────────────────── */

async function listItems(tenantId) {
  return repo.listItems(tenantId);
}

async function getItem(tenantId, id) {
  return repo.getItem(tenantId, id);
}

async function createItem(tenantId, data) {
  return repo.insertItem(tenantId, data);
}

async function updateItem(tenantId, id, data) {
  return repo.updateItem(tenantId, id, data);
}

async function deleteItem(tenantId, id) {
  return repo.softDeleteItem(tenantId, id);
}

/* ── Vendors ────────────────────────────────────────────────────────────── */

async function listVendors(tenantId) {
  return repo.listVendors(tenantId);
}

async function createVendor(tenantId, data) {
  return repo.insertVendor(tenantId, data);
}

async function updateVendor(tenantId, id, data) {
  return repo.updateVendor(tenantId, id, data);
}

async function deleteVendor(tenantId, id) {
  return repo.softDeleteVendor(tenantId, id);
}

/* ── FIFO consumption ──────────────────────────────────────────────────── */

// All quantity columns are NUMERIC(12,3) — round every intermediate JS float
// to 3dp before comparing or persisting. Raw IEEE 754 arithmetic on
// fractional quantities (e.g. 5 - 1.1 - 2.2 !== 1.7, 2.3 - 1.2 !== 1.1) can
// drift a hair off an exact value in either direction, which would wrongly
// reject/allow a boundary stock check or leave a lot with a dangling
// non-zero remainder after it should be fully consumed.
function _round3(n) { return Math.round(n * 1000) / 1000; }

/**
 * _consumeFifo — depletes open purchase lots oldest-first to cover `qty`
 * units leaving stock. Returns the total COGS (paise) for the consumed
 * portion, or null if none of the touched lots had a recorded cost (so the
 * caller can distinguish "genuinely free" from "cost unknown").
 *
 * Lots with unit_cost_paise = NULL are still consumed for quantity purposes
 * (FIFO ordering doesn't depend on every lot being priced) but contribute
 * nothing to the returned COGS total.
 *
 * Does not enforce a floor — the caller (recordMovement) already guards
 * against depleting more than current_stock for wastage/correction. If a
 * negative adjustment consumes more than the open lots hold (e.g. stock
 * predates costing being turned on), remaining qty is simply not costed.
 */
async function _consumeFifo(client, tenantId, itemId, qty) {
  let remaining = _round3(qty);
  let cogsPaise = 0;
  let anyCosted = false;

  const lots = await repo.listOpenLotsForConsumption(client, tenantId, itemId);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const consumed = _round3(Math.min(lot.quantity_remaining, remaining));
    if (consumed <= 0) continue;

    await repo.decrementLot(client, lot.id, consumed);
    remaining = _round3(remaining - consumed);

    if (lot.unit_cost_paise !== null) {
      anyCosted = true;
      cogsPaise += Math.round(lot.unit_cost_paise * consumed);
    }
  }

  return anyCosted ? cogsPaise : null;
}

/* ── Movements ──────────────────────────────────────────────────────────── */

/**
 * recordMovement — logs a stock movement against an item.
 *
 * purchase:   quantity must be > 0 (stock in). Opens a new FIFO lot at
 *             unit_cost (optional) from vendor (optional).
 * wastage:    quantity must be < 0 (stock out); blocked if it would push
 *             current_stock negative. Consumes FIFO lots for COGS.
 * correction: quantity must be < 0 (same guard as wastage) — a mis-count
 *             going down uses this type instead of "wastage" so ledger
 *             reporting can distinguish real loss from a counting error.
 *             Consumes FIFO lots for COGS.
 * adjustment: quantity can be positive or negative freely — reconciling a
 *             manual stock count against the ledger is the entire point,
 *             so it is not blocked by the negative-stock guard.
 *             Positive: opens a FIFO lot (stock found, treated like a
 *             purchase for costing purposes). Negative: consumes FIFO lots
 *             for COGS, same as wastage.
 */
async function recordMovement(tenantId, itemId, { movement_type, quantity, notes, unit_cost_paise, vendor_id }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the item row first — inventory.stock_levels is an unlocked view,
    // so two concurrent movements against the same item would otherwise
    // both read the same current_stock before either commits and both pass
    // the negative-stock guard below, overselling stock into the negative.
    // Locking here serializes movement writes per item: the second
    // transaction blocks until the first commits, then sees the true
    // post-commit stock level.
    const item = await repo.lockItem(client, tenantId, itemId);
    if (!item) {
      await client.query('ROLLBACK');
      return null;
    }

    if (vendor_id) {
      const vendor = await repo.verifyVendor(tenantId, vendor_id);
      if (!vendor) {
        throw Object.assign(new Error('Vendor not found.'), { status: 400 });
      }
    }

    if (['wastage', 'correction'].includes(movement_type)) {
      const { current_stock } = await repo.getStockLevel(client, tenantId, itemId);
      // _round3 — see note above _consumeFifo: avoids float drift at the
      // negative-stock boundary (e.g. depleting exactly to zero).
      if (_round3(current_stock + quantity) < 0) {
        throw Object.assign(
          new Error(`This would take stock below zero (current: ${current_stock}).`),
          { status: 409 }
        );
      }
    }

    const opensLot   = movement_type === 'purchase' || (movement_type === 'adjustment' && quantity > 0);
    const consumesFifo = !opensLot && quantity < 0; // wastage, correction, negative adjustment

    const row = await repo.insertMovement(client, tenantId, {
      inventory_item_id: itemId,
      movement_type, quantity, notes,
      reference_type: 'manual',
    });

    if (opensLot) {
      await repo.insertLot(client, tenantId, {
        inventory_item_id: itemId,
        movement_id: row.id,
        vendor_id: vendor_id ?? null,
        unit_cost_paise: unit_cost_paise ?? null,
        quantity: Math.abs(quantity),
      });
    } else if (consumesFifo) {
      const cogsPaise = await _consumeFifo(client, tenantId, itemId, Math.abs(quantity));
      if (cogsPaise !== null) {
        await repo.setMovementCogs(client, row.id, cogsPaise);
        row.cogs_paise = cogsPaise;
      }
    }

    await client.query('COMMIT');
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listMovements(tenantId, itemId, pagination) {
  return repo.listMovements(tenantId, itemId, pagination);
}

module.exports = {
  MOVEMENT_TYPES,
  listItems, getItem, createItem, updateItem, deleteItem,
  listVendors, createVendor, updateVendor, deleteVendor,
  recordMovement, listMovements,
};
