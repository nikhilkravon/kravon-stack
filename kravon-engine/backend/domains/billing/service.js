'use strict';

/**
 * Billing domain — settlement service.
 *
 * Business logic layer. Coordinates:
 *   - repository.js (SQL)
 *   - calculator.js (pure totals)
 *   - audit.js (change trail)
 *   - pool.js (transactions)
 *
 * Key invariants enforced here:
 *   1. Settlements in 'finalized' or 'voided' status cannot be edited.
 *   2. Orders are NEVER written to here.
 *   3. Every line mutation creates a revision row.
 *   4. All amounts arrive/depart as paise integers.
 *   5. Totals are recalculated from lines after every change — never manually set.
 */

const { getClient } = require('../../db/pool');
const repo      = require('./repository');
const calc      = require('./calculator');
const audit     = require('../../utils/audit');
const orderRepo = require('../ordering/repository');
const { query } = require('../../db/pool');

// ── Lead repository (lazy-loaded to avoid circular deps) ────────────────────
function _leadRepo() { return require('../catering/repository'); }

// ── Capability constants ─────────────────────────────────────────────────────

const CAP = {
  ADD_ITEMS:          'CAN_ADD_ITEMS',
  REMOVE_ITEMS:       'CAN_REMOVE_ITEMS',
  OVERRIDE_PRICE:     'CAN_OVERRIDE_PRICE',
  APPLY_DISCOUNT:     'CAN_APPLY_DISCOUNT',
  COMP_ITEM:          'CAN_COMP_ITEM',
  VOID_SETTLEMENT:    'CAN_VOID_SETTLEMENT',
  FINALIZE:           'CAN_FINALIZE_SETTLEMENT',
  ADD_PAYMENT:        'CAN_ADD_PAYMENT',
  GENERATE_INVOICE:   'CAN_GENERATE_INVOICE',
};

// Role → capabilities map.
// In a future release this can be moved to the DB (tenant.role_capabilities table).
// For now it mirrors the system roles defined in v22-seed-roles.js.
const ROLE_CAPS = {
  owner: new Set(Object.values(CAP)),
  manager: new Set([
    CAP.ADD_ITEMS, CAP.REMOVE_ITEMS, CAP.OVERRIDE_PRICE,
    CAP.APPLY_DISCOUNT, CAP.COMP_ITEM, CAP.FINALIZE,
    CAP.ADD_PAYMENT, CAP.GENERATE_INVOICE,
  ]),
  cashier: new Set([
    CAP.ADD_ITEMS, CAP.APPLY_DISCOUNT, CAP.FINALIZE,
    CAP.ADD_PAYMENT, CAP.GENERATE_INVOICE,
  ]),
  host: new Set([CAP.ADD_ITEMS, CAP.REMOVE_ITEMS]),
  kitchen: new Set([]),
  catering: new Set([]),
};

function hasCap(staffRoles, cap) {
  return (staffRoles || []).some(r => ROLE_CAPS[r]?.has(cap));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function guardEditable(settlement) {
  if (settlement.status === 'finalized') {
    return { error: 'Settlement is finalized and cannot be edited.', status: 409 };
  }
  if (settlement.status === 'voided') {
    return { error: 'Settlement is voided.', status: 409 };
  }
  return null;
}

async function _recalcAndSave(client, tenantId, settlementId) {
  const lines  = await repo.listLines(client, tenantId, settlementId);
  const totals = calc.calculate(lines);
  return repo.updateSettlementTotals(client, settlementId, totals);
}

// ── Create settlement from session ───────────────────────────────────────────

/**
 * createFromSession(tenant, sessionId, staffId, staffRoles)
 *
 * Reads all non-cancelled orders for the session, mirrors them as ORDER_ITEM
 * settlement lines, applies GST from the first order's snapshot, creates
 * a ROUND_OFF line if needed, and persists the settlement.
 *
 * If a settlement already exists for this session (idempotent), returns it.
 */
async function createFromSession(tenant, sessionId, staffId) {
  const tenantId = tenant.tenant_id;

  const existing = await repo.findSettlementBySession(tenantId, sessionId);
  if (existing) return { settlement: _fmtSettlement(existing) };

  // Load session + orders
  const sessionRes = await query(
    `SELECT s.id, s.covers, t.name AS table_name
     FROM dining.sessions s
     JOIN dining.tables t ON t.id = s.table_id
     WHERE s.id = $1 AND s.tenant_id = $2 AND s.deleted_at IS NULL`,
    [sessionId, tenantId],
  );
  if (!sessionRes.rows.length) return { error: 'Session not found.', status: 404 };
  const session = sessionRes.rows[0];

  const ordersRes = await query(
    `SELECT o.id, o.subtotal_amount, o.total_amount, o.tax_amount,
            o.metadata->'gst' AS gst, o.metadata->>'guest_name' AS guest_name,
            json_agg(json_build_object(
              'id', oi.id, 'name', oi.item_name, 'qty', oi.quantity,
              'unit_price', oi.unit_price, 'total_price', oi.total_price,
              'special_note', oi.special_note, 'menu_item_id', oi.menu_item_id
            ) ORDER BY oi.id) AS items
     FROM orders.orders o
     JOIN orders.order_items oi ON oi.order_id = o.id
     WHERE o.session_id = $1 AND o.tenant_id = $2
       AND o.status NOT IN ('cancelled','refunded') AND o.deleted_at IS NULL
     GROUP BY o.id
     ORDER BY o.created_at ASC`,
    [sessionId, tenantId],
  );

  const orders = ordersRes.rows;
  if (!orders.length) return { error: 'No billable orders on this session.', status: 422 };

  // Find GST snapshot from first order that has one
  const gst_snapshot = orders.map(o => o.gst).find(g => g && g.cgst_rate != null) || null;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const settlement = await repo.createSettlement(client, {
      tenantId, sessionId,
      notes: `Table ${session.table_name} — ${session.covers ?? ''} covers`,
      createdBy: staffId,
    });
    const sid = settlement.id;
    let sortOrder = 0;

    // Mirror ORDER_ITEM lines — batch insert to avoid N+1 round-trips
    const lineRows   = [];
    const lineParams = [];
    for (const order of orders) {
      for (const item of order.items) {
        const unit_paise  = calc.paise(item.unit_price);
        const amount_paise = Math.round(unit_paise * item.qty);
        const base = lineParams.length;
        lineRows.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11})`);
        lineParams.push(
          tenantId, sid, calc.LINE.ORDER_ITEM,
          order.id, item.id,
          item.name + (item.special_note ? ` — ${item.special_note}` : ''),
          item.qty, unit_paise, amount_paise,
          false,   // is_comp
          sortOrder++,
        );
      }
    }
    if (lineRows.length) {
      await client.query(
        `INSERT INTO billing.settlement_lines
           (tenant_id, settlement_id, line_type, source_order_id, source_order_item_id,
            description, quantity, unit_price_paise, amount_paise, is_comp, sort_order)
         VALUES ${lineRows.join(',')}`,
        lineParams,
      );
    }

    // Apply GST lines if snapshot present
    if (gst_snapshot) {
      // Compute subtotal from item lines only first
      const itemLines = await repo.listLines(client, tenantId, sid);
      const { subtotal_paise } = calc.calculate(itemLines);
      const gstLines = calc.buildGstLines(subtotal_paise, gst_snapshot);
      for (const gl of gstLines) {
        await repo.insertLine(client, tenantId, sid, { ...gl, sort_order: sortOrder++ });
      }
    }

    // Recalculate totals
    const finalTotals = await _recalcAndSave(client, tenantId, sid);

    // First revision
    await repo.insertRevision(client, tenantId, sid, {
      actorId:    staffId,
      changeType: 'status_change',
      afterState: { status: 'draft', source: 'session', orders: orders.length },
    });

    await audit.log(client, {
      tenantId, actorId: staffId, actorType: 'staff',
      action: 'settlement.create', entityType: 'billing.settlement', entityId: sid,
      newValue: { session_id: sessionId, order_count: orders.length },
    });

    await client.query('COMMIT');
    return { settlement: _fmtSettlement(finalTotals) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Create settlement from delivery/takeaway order ───────────────────────────

/**
 * createFromOrder(tenant, orderId, staffId)
 *
 * Creates a settlement from a delivery or takeaway order.
 * Mirrors order items as ORDER_ITEM lines. Idempotent.
 */
async function createFromOrder(tenant, orderId, staffId) {
  const tenantId = tenant.tenant_id;

  const existing = await repo.findSettlementByOrder(tenantId, orderId);
  if (existing) return { settlement: _fmtSettlement(existing) };

  const orderRes = await query(
    `SELECT o.id, o.total_amount, o.subtotal_amount, o.tax_amount, o.fulfillment_type,
            o.special_instructions, o.metadata,
            o.metadata->>'customer_name' AS customer_name,
            json_agg(json_build_object(
              'id', oi.id, 'name', oi.item_name, 'qty', oi.quantity,
              'unit_price', oi.unit_price, 'total_price', oi.total_price,
              'special_note', oi.special_note, 'menu_item_id', oi.menu_item_id
            ) ORDER BY oi.id) AS items
     FROM orders.orders o
     JOIN orders.order_items oi ON oi.order_id = o.id
     WHERE o.id = $1::uuid AND o.tenant_id = $2
       AND o.status NOT IN ('cancelled','refunded') AND o.deleted_at IS NULL
     GROUP BY o.id`,
    [orderId, tenantId],
  );
  if (!orderRes.rows.length) return { error: 'Order not found or not billable.', status: 404 };
  const order = orderRes.rows[0];

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const label = `${order.fulfillment_type || 'order'} — ${order.customer_name || 'Guest'}`.trim();
    const settlement = await repo.createSettlement(client, {
      tenantId, orderId, notes: label, createdBy: staffId,
    });
    const sid = settlement.id;
    let sortOrder = 0;

    const lineRows   = [];
    const lineParams = [];
    for (const item of order.items) {
      const unit_paise   = calc.paise(item.unit_price);
      const amount_paise = Math.round(unit_paise * item.qty);
      const base = lineParams.length;
      lineRows.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11})`);
      lineParams.push(
        tenantId, sid, calc.LINE.ORDER_ITEM,
        orderId, item.id,
        item.name + (item.special_note ? ` — ${item.special_note}` : ''),
        item.qty, unit_paise, amount_paise,
        false, sortOrder++,
      );
    }
    if (lineRows.length) {
      await client.query(
        `INSERT INTO billing.settlement_lines
           (tenant_id, settlement_id, line_type, source_order_id, source_order_item_id,
            description, quantity, unit_price_paise, amount_paise, is_comp, sort_order)
         VALUES ${lineRows.join(',')}`,
        lineParams,
      );
    }

    const finalTotals = await _recalcAndSave(client, tenantId, sid);
    await repo.insertRevision(client, tenantId, sid, {
      actorId: staffId, changeType: 'status_change',
      afterState: { status: 'draft', source: 'order', order_id: orderId },
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.create',
      entityType: 'billing.settlement', entityId: sid,
      newValue: { order_id: orderId, item_count: order.items.length },
    });

    await client.query('COMMIT');
    return { settlement: _fmtSettlement(finalTotals) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Create settlement from catering lead ─────────────────────────────────────

/**
 * createFromCatering(tenant, leadId, staffId)
 *
 * Creates a settlement from a catering lead. Idempotent.
 * Catering settlements start as a blank draft — staff populate lines manually
 * since catering quotes are bespoke.
 */
async function createFromCatering(tenant, leadId, staffId) {
  const tenantId = tenant.tenant_id;

  const existing = await repo.findSettlementByLead(tenantId, leadId);
  if (existing) return { settlement: _fmtSettlement(existing) };

  const leadRes = await query(
    `SELECT id, contact_name, event_date, event_type
     FROM catering.leads
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    [leadId, tenantId],
  );
  if (!leadRes.rows.length) return { error: 'Catering lead not found.', status: 404 };
  const lead = leadRes.rows[0];

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const label = `${lead.event_type || 'Catering'} — ${lead.contact_name}`;
    const settlement = await repo.createSettlement(client, {
      tenantId, leadId, notes: label, createdBy: staffId,
    });
    const sid = settlement.id;

    const finalTotals = await _recalcAndSave(client, tenantId, sid);
    await repo.insertRevision(client, tenantId, sid, {
      actorId: staffId, changeType: 'status_change',
      afterState: { status: 'draft', source: 'catering', lead_id: leadId },
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.create',
      entityType: 'billing.settlement', entityId: sid,
      newValue: { lead_id: leadId },
    });

    await client.query('COMMIT');
    return { settlement: _fmtSettlement(finalTotals) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Create manual settlement ─────────────────────────────────────────────────

/**
 * createManual(tenant, { notes, internal_ref }, staffId)
 *
 * Creates a blank settlement not linked to any source transaction.
 * Staff populate all lines manually.
 */
async function createManual(tenant, { notes = null, internal_ref = null } = {}, staffId) {
  const tenantId = tenant.tenant_id;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const settlement = await repo.createSettlement(client, {
      tenantId, notes, createdBy: staffId,
    });
    const sid = settlement.id;

    // Store internal_ref if provided
    if (internal_ref) {
      await client.query(
        `UPDATE billing.settlements SET internal_ref = $1 WHERE id = $2`,
        [internal_ref, sid],
      );
    }

    const finalTotals = await _recalcAndSave(client, tenantId, sid);
    await repo.insertRevision(client, tenantId, sid, {
      actorId: staffId, changeType: 'status_change',
      afterState: { status: 'draft', source: 'manual' },
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.create',
      entityType: 'billing.settlement', entityId: sid,
      newValue: { source: 'manual', notes },
    });

    await client.query('COMMIT');
    // Re-fetch to get internal_ref in response
    const updated = await repo.findSettlement(null, tenantId, sid);
    return { settlement: _fmtSettlement(updated || finalTotals) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── List settlements (invoice dashboard) ─────────────────────────────────────

async function listSettlements(tenantId, filters) {
  const { settlements, total } = await repo.listSettlements(tenantId, filters);
  const page  = filters.page  || 1;
  const limit = filters.limit || 50;
  return {
    settlements: settlements.map(s => ({
      id:               s.id,
      status:           s.status,
      source_type:      s.source_type,
      total_paise:      s.total_paise,
      paid_paise:       s.paid_paise,
      balance_paise:    Math.max(0, (s.total_paise || 0) - (s.paid_paise || 0)),
      total:            calc.toRupees(s.total_paise),
      notes:            s.notes,
      internal_ref:     s.internal_ref,
      table_name:       s.table_name  || null,
      customer_name:    s.customer_name || s.lead_name || null,
      fulfillment_type: s.fulfillment_type || null,
      created_at:       s.created_at,
      finalized_at:     s.finalized_at,
    })),
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

// ── Get settlement with lines ─────────────────────────────────────────────────

async function getSettlement(tenantId, settlementId) {
  const s = await repo.findSettlement(null, tenantId, settlementId);
  if (!s) return { error: 'Settlement not found.', status: 404 };
  const [lines, payments] = await Promise.all([
    repo.listLines(null, tenantId, settlementId),
    repo.listPayments(tenantId, settlementId),
  ]);
  return { settlement: _fmtSettlement(s), lines: lines.map(_fmtLine), payments: payments.map(_fmtPayment) };
}

async function getSettlementBySession(tenantId, sessionId, tenant = null) {
  const s = await repo.findSettlementBySession(tenantId, sessionId);
  if (s) return getSettlement(tenantId, s.id);

  // Compensating flow: session was closed but settlement creation failed (crash between
  // COMMIT and the post-COMMIT createFromSession call in closeSession). Auto-create now.
  if (tenant) {
    const created = await createFromSession(tenant, sessionId, null);
    if (created.settlement) return getSettlement(tenantId, created.settlement.id);
  }

  return { error: 'No settlement found for this session.', status: 404 };
}

// ── Add line ──────────────────────────────────────────────────────────────────

async function addLine(tenant, settlementId, lineData, staffId, staffRoles) {
  const tenantId = tenant.tenant_id;

  if (lineData.line_type === calc.LINE.MANUAL_ITEM || lineData.line_type === calc.LINE.ORDER_ITEM) {
    if (!hasCap(staffRoles, CAP.ADD_ITEMS)) return { error: 'Insufficient permissions to add items.', status: 403 };
  }
  if (lineData.line_type === calc.LINE.DISCOUNT) {
    if (!hasCap(staffRoles, CAP.APPLY_DISCOUNT)) return { error: 'Insufficient permissions to apply discounts.', status: 403 };
  }
  if (lineData.line_type === calc.LINE.COMPLIMENTARY_ITEM) {
    if (!hasCap(staffRoles, CAP.COMP_ITEM)) return { error: 'Insufficient permissions to comp items.', status: 403 };
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const settlement = await repo.findSettlement(client, tenantId, settlementId);
    if (!settlement) { await client.query('ROLLBACK'); return { error: 'Settlement not found.', status: 404 }; }
    const guardErr = guardEditable(settlement);
    if (guardErr) { await client.query('ROLLBACK'); return guardErr; }

    const line = await repo.insertLine(client, tenantId, settlementId, lineData);
    const updated = await _recalcAndSave(client, tenantId, settlementId);

    await repo.insertRevision(client, tenantId, settlementId, {
      actorId: staffId, changeType: 'line_add', lineId: line.id,
      afterState: _fmtLine(line),
      reason: lineData.comp_reason || lineData.reason || null,
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.line_add',
      entityType: 'billing.settlement', entityId: settlementId,
      newValue: { line_type: lineData.line_type, amount_paise: lineData.amount_paise, description: lineData.description },
    });

    await client.query('COMMIT');
    return { line: _fmtLine(line), totals: _fmtTotals(updated) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Edit line ─────────────────────────────────────────────────────────────────

async function editLine(tenant, settlementId, lineId, patch, staffId, staffRoles) {
  const tenantId = tenant.tenant_id;

  if (patch.unit_price_paise !== undefined || patch.amount_paise !== undefined) {
    if (!hasCap(staffRoles, CAP.OVERRIDE_PRICE)) return { error: 'Insufficient permissions to override price.', status: 403 };
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const settlement = await repo.findSettlement(client, tenantId, settlementId);
    if (!settlement) { await client.query('ROLLBACK'); return { error: 'Settlement not found.', status: 404 }; }
    const guardErr = guardEditable(settlement);
    if (guardErr) { await client.query('ROLLBACK'); return guardErr; }

    // Capture before state
    const beforeRes = await client.query(
      `SELECT * FROM billing.settlement_lines WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [lineId, tenantId],
    );
    if (!beforeRes.rows.length) { await client.query('ROLLBACK'); return { error: 'Line not found.', status: 404 }; }
    const before = beforeRes.rows[0];

    const updated = await repo.updateLine(client, tenantId, lineId, patch);
    const newTotals = await _recalcAndSave(client, tenantId, settlementId);

    await repo.insertRevision(client, tenantId, settlementId, {
      actorId: staffId, changeType: 'line_edit', lineId,
      beforeState: _fmtLine(before), afterState: _fmtLine(updated),
      reason: patch.reason || null,
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.line_edit',
      entityType: 'billing.settlement', entityId: settlementId,
      oldValue: _fmtLine(before), newValue: _fmtLine(updated),
    });

    await client.query('COMMIT');
    return { line: _fmtLine(updated), totals: _fmtTotals(newTotals) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Remove line ───────────────────────────────────────────────────────────────

async function removeLine(tenant, settlementId, lineId, staffId, staffRoles, reason) {
  const tenantId = tenant.tenant_id;
  if (!hasCap(staffRoles, CAP.REMOVE_ITEMS)) return { error: 'Insufficient permissions to remove items.', status: 403 };

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const settlement = await repo.findSettlement(client, tenantId, settlementId);
    if (!settlement) { await client.query('ROLLBACK'); return { error: 'Settlement not found.', status: 404 }; }
    const guardErr = guardEditable(settlement);
    if (guardErr) { await client.query('ROLLBACK'); return guardErr; }

    const beforeRes = await client.query(
      `SELECT * FROM billing.settlement_lines WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [lineId, tenantId],
    );
    if (!beforeRes.rows.length) { await client.query('ROLLBACK'); return { error: 'Line not found.', status: 404 }; }

    await repo.softDeleteLine(client, tenantId, lineId);
    const newTotals = await _recalcAndSave(client, tenantId, settlementId);

    await repo.insertRevision(client, tenantId, settlementId, {
      actorId: staffId, changeType: 'line_remove', lineId,
      beforeState: _fmtLine(beforeRes.rows[0]), reason,
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.line_remove',
      entityType: 'billing.settlement', entityId: settlementId,
      oldValue: _fmtLine(beforeRes.rows[0]), newValue: { reason },
    });

    await client.query('COMMIT');
    return { ok: true, totals: _fmtTotals(newTotals) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Finalize ──────────────────────────────────────────────────────────────────

async function finalizeSettlement(tenant, settlementId, staffId, staffRoles, gst_snapshot) {
  const tenantId = tenant.tenant_id;
  if (!hasCap(staffRoles, CAP.FINALIZE)) return { error: 'Insufficient permissions to finalize settlement.', status: 403 };

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const settlement = await repo.findSettlement(client, tenantId, settlementId);
    if (!settlement) { await client.query('ROLLBACK'); return { error: 'Settlement not found.', status: 404 }; }
    if (settlement.status === 'finalized') { await client.query('ROLLBACK'); return { settlement: _fmtSettlement(settlement) }; }
    if (settlement.status === 'voided') { await client.query('ROLLBACK'); return { error: 'Settlement is voided.', status: 409 }; }

    const updated = await repo.updateSettlementStatus(
      client, tenantId, settlementId, 'finalized', staffId, { gst_snapshot },
    );

    await repo.insertRevision(client, tenantId, settlementId, {
      actorId: staffId, changeType: 'status_change',
      beforeState: { status: settlement.status }, afterState: { status: 'finalized' },
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.finalize',
      entityType: 'billing.settlement', entityId: settlementId,
      newValue: { total_paise: updated.total_paise },
    });

    await client.query('COMMIT');
    return { settlement: _fmtSettlement(updated) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Void ──────────────────────────────────────────────────────────────────────

async function voidSettlement(tenant, settlementId, staffId, staffRoles, void_reason) {
  const tenantId = tenant.tenant_id;
  if (!hasCap(staffRoles, CAP.VOID_SETTLEMENT)) return { error: 'Insufficient permissions to void settlement.', status: 403 };

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const settlement = await repo.findSettlement(client, tenantId, settlementId);
    if (!settlement) { await client.query('ROLLBACK'); return { error: 'Settlement not found.', status: 404 }; }
    if (settlement.status === 'voided') { await client.query('ROLLBACK'); return { settlement: _fmtSettlement(settlement) }; }

    const updated = await repo.updateSettlementStatus(
      client, tenantId, settlementId, 'voided', staffId, { void_reason },
    );
    await repo.insertRevision(client, tenantId, settlementId, {
      actorId: staffId, changeType: 'status_change',
      beforeState: { status: settlement.status }, afterState: { status: 'voided', void_reason },
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.void',
      entityType: 'billing.settlement', entityId: settlementId,
      newValue: { void_reason },
    });

    await client.query('COMMIT');
    return { settlement: _fmtSettlement(updated) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Record payment / refund ───────────────────────────────────────────────────
// A payment and a refund are recorded through the same function — both are
// always-positive rows (kind='payment' | 'refund'); sumPayments nets them.

async function recordPayment(tenant, settlementId, paymentData, staffId, staffRoles) {
  const tenantId = tenant.tenant_id;
  if (!hasCap(staffRoles, CAP.ADD_PAYMENT)) return { error: 'Insufficient permissions to record payment.', status: 403 };

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const settlement = await repo.findSettlement(client, tenantId, settlementId);
    if (!settlement) { await client.query('ROLLBACK'); return { error: 'Settlement not found.', status: 404 }; }
    if (settlement.status === 'voided') { await client.query('ROLLBACK'); return { error: 'Cannot record payment on voided settlement.', status: 409 }; }

    const payment = await repo.insertPayment(client, tenantId, settlementId, {
      ...paymentData,
      recordedBy: staffId,
    });

    // Update paid_paise denorm — floor at 0 so a refund cannot push it negative
    const rawPaid   = await repo.sumPayments(client, settlementId);
    const totalPaid = Math.max(0, rawPaid);
    await repo.updatePaidPaise(client, settlementId, tenantId, totalPaid);

    await repo.insertRevision(client, tenantId, settlementId, {
      actorId: staffId, changeType: paymentData.kind === 'refund' ? 'refund_recorded' : 'payment_recorded',
      afterState: { method: paymentData.method, amount_paise: paymentData.amount_paise },
      reason: paymentData.reason || null,
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: paymentData.kind === 'refund' ? 'settlement.refund' : 'settlement.payment',
      entityType: 'billing.settlement', entityId: settlementId,
      newValue: { method: paymentData.method, amount_paise: paymentData.amount_paise, reason: paymentData.reason || null },
    });

    await client.query('COMMIT');
    return {
      payment: _fmtPayment(payment),
      paid_paise:    totalPaid,
      balance_paise: Math.max(0, settlement.total_paise - totalPaid),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Correct a mis-entered payment ─────────────────────────────────────────────
// Soft-voids the original row (never deletes it) so the ledger stays legible —
// whoever reviews the bill later sees a struck-through entry with a reason,
// not a silently vanished number. Distinct from recordPayment(kind:'refund'),
// which means "money actually went back to the guest."

async function correctPayment(tenant, settlementId, paymentId, staffId, staffRoles, voidReason) {
  const tenantId = tenant.tenant_id;
  if (!hasCap(staffRoles, CAP.ADD_PAYMENT)) return { error: 'Insufficient permissions to correct payment.', status: 403 };

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const settlement = await repo.findSettlement(client, tenantId, settlementId);
    if (!settlement) { await client.query('ROLLBACK'); return { error: 'Settlement not found.', status: 404 }; }
    if (settlement.status === 'voided') { await client.query('ROLLBACK'); return { error: 'Cannot correct a payment on a voided settlement.', status: 409 }; }

    const before = await repo.findPayment(client, tenantId, paymentId);
    if (!before || before.settlement_id !== settlementId) { await client.query('ROLLBACK'); return { error: 'Payment not found.', status: 404 }; }
    if (before.voided_at) { await client.query('ROLLBACK'); return { error: 'Payment already corrected.', status: 409 }; }

    const voided = await repo.voidPayment(client, tenantId, paymentId, { voidedBy: staffId, voidReason });
    if (!voided) { await client.query('ROLLBACK'); return { error: 'Payment not found.', status: 404 }; }

    const rawPaid   = await repo.sumPayments(client, settlementId);
    const totalPaid = Math.max(0, rawPaid);
    await repo.updatePaidPaise(client, settlementId, tenantId, totalPaid);

    await repo.insertRevision(client, tenantId, settlementId, {
      actorId: staffId, changeType: 'payment_corrected',
      beforeState: _fmtPayment(before), reason: voidReason,
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'settlement.payment_correct',
      entityType: 'billing.settlement', entityId: settlementId,
      oldValue: _fmtPayment(before), newValue: { void_reason: voidReason },
    });

    await client.query('COMMIT');
    return {
      payment: _fmtPayment(voided),
      paid_paise:    totalPaid,
      balance_paise: Math.max(0, settlement.total_paise - totalPaid),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Generate invoice ──────────────────────────────────────────────────────────

async function generateInvoice(tenant, settlementId, staffId, staffRoles) {
  const tenantId = tenant.tenant_id;
  if (!hasCap(staffRoles, CAP.GENERATE_INVOICE)) return { error: 'Insufficient permissions to generate invoice.', status: 403 };

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock settlement + read all snapshot data inside the transaction so a concurrent
    // payment cannot slip in between the reads and the invoice write.
    const settlementRes = await client.query(
      `SELECT * FROM billing.settlements WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [settlementId, tenantId],
    );
    if (!settlementRes.rows.length) { await client.query('ROLLBACK'); return { error: 'Settlement not found.', status: 404 }; }
    const settlement = settlementRes.rows[0];
    if (settlement.status !== 'finalized') { await client.query('ROLLBACK'); return { error: 'Settlement must be finalized before generating an invoice.', status: 422 }; }

    const [lines, payments, restaurantRes, existingVersions] = await Promise.all([
      repo.listLines(client, tenantId, settlementId),
      client.query(`SELECT * FROM billing.payments WHERE settlement_id = $1 AND tenant_id = $2 ORDER BY recorded_at ASC`, [settlementId, tenantId]),
      client.query(`SELECT name, settings FROM tenant.restaurants WHERE id = $1 LIMIT 1`, [tenantId]),
      client.query(`SELECT id FROM billing.invoices WHERE settlement_id = $1 AND tenant_id = $2 FOR UPDATE`, [settlementId, tenantId]),
    ]);

    const restaurant = restaurantRes.rows[0] || {};
    const gst        = settlement.gst_snapshot;
    const totals     = calc.calculate(lines);
    const version    = existingVersions.rows.length + 1;

    const snapshot = {
      settlement_id:   settlementId,
      restaurant_name: restaurant.name,
      gstin:           gst?.gstin || restaurant.settings?.gst?.gstin || null,
      lines:           lines.map(_fmtLine),
      payments:        payments.rows.map(_fmtPayment),
      gst_snapshot:    gst,
      subtotal_paise:  totals.subtotal_paise,
      discount_paise:  totals.discount_paise,
      tax_paise:       totals.tax_paise,
      tip_paise:       totals.tip_paise,
      round_off_paise: totals.round_off_paise,
      total_paise:     totals.total_paise,
      paid_paise:      settlement.paid_paise,
      generated_at:    new Date().toISOString(),
    };

    const invoiceNumber = await repo.nextInvoiceNumber(client, tenantId);
    const invoice = await repo.insertInvoice(client, tenantId, settlementId, {
      snapshot, generatedBy: staffId, version, invoiceNumber,
    });
    await audit.log(client, {
      tenantId, actorId: staffId, action: 'invoice.generate',
      entityType: 'billing.invoice', entityId: invoice.id,
      newValue: { invoice_number: invoiceNumber, version, settlement_id: settlementId },
    });
    await client.query('COMMIT');
    return { invoice: { id: invoice.id, invoice_number: invoiceNumber, version, snapshot, generated_at: invoice.generated_at } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getRevisions(tenantId, settlementId) {
  const s = await repo.findSettlement(null, tenantId, settlementId);
  if (!s) return { error: 'Settlement not found.', status: 404 };
  const revisions = await repo.listRevisions(tenantId, settlementId);
  return { revisions };
}

// ── Format helpers ────────────────────────────────────────────────────────────

function _fmtSettlement(s) {
  if (!s) return null;
  return {
    id:                 s.id,
    session_id:         s.session_id,
    order_id:           s.order_id,
    lead_id:            s.lead_id,
    status:             s.status,
    notes:              s.notes,
    subtotal:           calc.toRupees(s.subtotal_paise),
    discount:           calc.toRupees(s.discount_paise),
    tax:                calc.toRupees(s.tax_paise),
    tip:                calc.toRupees(s.tip_paise),
    round_off:          calc.toRupees(s.round_off_paise),
    total:              calc.toRupees(s.total_paise),
    paid:               calc.toRupees(Math.max(0, s.paid_paise)),
    balance:            calc.toRupees(Math.max(0, s.total_paise - Math.max(0, s.paid_paise))),
    // Raw paise for client-side calculation without float arithmetic
    subtotal_paise:     s.subtotal_paise,
    discount_paise:     s.discount_paise,
    tax_paise:          s.tax_paise,
    tip_paise:          s.tip_paise,
    round_off_paise:    s.round_off_paise,
    total_paise:        s.total_paise,
    paid_paise:         Math.max(0, s.paid_paise),
    gst_snapshot:       s.gst_snapshot,
    finalized_at:       s.finalized_at,
    voided_at:          s.voided_at,
    void_reason:        s.void_reason,
    created_at:         s.created_at,
  };
}

function _fmtLine(l) {
  if (!l) return null;
  return {
    id:                   l.id,
    line_type:            l.line_type,
    source_order_id:      l.source_order_id,
    source_order_item_id: l.source_order_item_id,
    description:          l.description,
    quantity:             Number(l.quantity),
    unit_price_paise:     l.unit_price_paise != null ? Number(l.unit_price_paise) : null,
    amount_paise:         Number(l.amount_paise),
    amount:               calc.toRupees(Number(l.amount_paise)),
    percent:              l.percent != null ? Number(l.percent) : null,
    tax_name:             l.tax_name,
    tax_rate:             l.tax_rate != null ? Number(l.tax_rate) : null,
    is_comp:              l.is_comp,
    comp_reason:          l.comp_reason,
    sort_order:           l.sort_order,
  };
}

function _fmtPayment(p) {
  return {
    id:          p.id,
    method:      p.method,
    amount_paise:p.amount_paise,
    amount:      calc.toRupees(p.amount_paise),
    kind:        p.kind || 'payment',
    reason:      p.reason || null,
    reference:   p.reference,
    notes:       p.notes,
    recorded_at: p.recorded_at,
    voided_at:   p.voided_at || null,
    void_reason: p.void_reason || null,
  };
}

function _fmtTotals(s) {
  return {
    subtotal_paise:  s.subtotal_paise,
    discount_paise:  s.discount_paise,
    tax_paise:       s.tax_paise,
    tip_paise:       s.tip_paise,
    round_off_paise: s.round_off_paise,
    total_paise:     s.total_paise,
    subtotal:        calc.toRupees(s.subtotal_paise),
    discount:        calc.toRupees(s.discount_paise),
    tax:             calc.toRupees(s.tax_paise),
    tip:             calc.toRupees(s.tip_paise),
    round_off:       calc.toRupees(s.round_off_paise),
    total:           calc.toRupees(s.total_paise),
  };
}

module.exports = {
  CAP, hasCap,
  createFromSession, createFromOrder, createFromCatering, createManual,
  listSettlements,
  getSettlement, getSettlementBySession,
  addLine, editLine, removeLine,
  finalizeSettlement, voidSettlement,
  recordPayment, correctPayment, generateInvoice, getRevisions,
};
