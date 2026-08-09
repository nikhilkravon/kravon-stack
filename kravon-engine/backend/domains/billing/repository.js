'use strict';

/**
 * Billing domain — settlement repository.
 * All SQL for billing.* tables lives here.
 * Services call these; routes never touch billing tables directly.
 */

const { query, getClient } = require('../../db/pool');

// ── Settlements ──────────────────────────────────────────────────────────────

async function findSettlement(client, tenantId, settlementId) {
  const exec = client ? (s, p) => client.query(s, p) : (s, p) => query(s, p);
  const res = await exec(
    `SELECT * FROM billing.settlements
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    [settlementId, tenantId],
  );
  return res.rows[0] || null;
}

// Locking variant for any read-modify-write sequence inside a transaction
// (payments, line edits, finalize, void, etc.) — without this, two concurrent
// requests against the same settlement can both read the same pre-mutation
// state and each write back a result that only reflects their own change,
// silently losing the other (confirmed: concurrent payments both insert
// correctly into billing.payments, but paid_paise ends up reflecting only
// one of them because both transactions summed payments before the other's
// insert was visible to them under READ COMMITTED). Requires an active
// client/transaction — never call this outside BEGIN.
async function findSettlementForUpdate(client, tenantId, settlementId) {
  const res = await client.query(
    `SELECT * FROM billing.settlements
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
     FOR UPDATE`,
    [settlementId, tenantId],
  );
  return res.rows[0] || null;
}

// Voided settlements are excluded from "does one already exist" lookups —
// voiding must free the session/order/lead to be billed again, not dead-end it.
async function findSettlementBySession(tenantId, sessionId) {
  const res = await query(
    `SELECT * FROM billing.settlements
     WHERE session_id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
       AND status != 'voided'
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId, tenantId],
  );
  return res.rows[0] || null;
}

async function findSettlementByOrder(tenantId, orderId) {
  const res = await query(
    `SELECT * FROM billing.settlements
     WHERE order_id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
       AND status != 'voided'
     ORDER BY created_at DESC LIMIT 1`,
    [orderId, tenantId],
  );
  return res.rows[0] || null;
}

async function findSettlementByLead(tenantId, leadId) {
  const res = await query(
    `SELECT * FROM billing.settlements
     WHERE lead_id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL
       AND status != 'voided'
     ORDER BY created_at DESC LIMIT 1`,
    [leadId, tenantId],
  );
  return res.rows[0] || null;
}

async function listSettlements(tenantId, {
  page = 1, limit = 50, status = null, source = null,
  search = null, date_from = null, date_to = null,
} = {}) {
  const params  = [tenantId];
  const filters = ['s.tenant_id = $1', 's.deleted_at IS NULL'];

  if (status) {
    params.push(status);
    filters.push(`s.status = $${params.length}`);
  }
  if (source === 'dine_in') {
    filters.push('s.session_id IS NOT NULL');
  } else if (source === 'order') {
    filters.push('s.order_id IS NOT NULL AND s.session_id IS NULL');
  } else if (source === 'catering') {
    filters.push('s.lead_id IS NOT NULL');
  } else if (source === 'manual') {
    filters.push('s.session_id IS NULL AND s.order_id IS NULL AND s.lead_id IS NULL');
  }
  if (date_from) {
    params.push(date_from);
    filters.push(`s.created_at >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    filters.push(`s.created_at <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const p = params.length;
    filters.push(`(s.notes ILIKE $${p} OR s.internal_ref ILIKE $${p})`);
  }

  const where  = `WHERE ${filters.join(' AND ')}`;
  const offset = (page - 1) * limit;

  const [listRes, countRes] = await Promise.all([
    query(
      `SELECT s.id, s.status, s.session_id, s.order_id, s.lead_id,
              s.total_paise, s.paid_paise, s.notes, s.internal_ref,
              s.created_at, s.finalized_at,
              CASE
                WHEN s.session_id IS NOT NULL THEN 'dine_in'
                WHEN s.order_id   IS NOT NULL THEN 'order'
                WHEN s.lead_id    IS NOT NULL THEN 'catering'
                ELSE 'manual'
              END AS source_type,
              t.name AS table_name,
              o.metadata->>'customer_name'  AS customer_name,
              o.metadata->>'fulfillment_type' AS fulfillment_type,
              l.contact_name AS lead_name
       FROM billing.settlements s
       LEFT JOIN dining.sessions  ss ON ss.id = s.session_id
       LEFT JOIN dining.tables    t  ON t.id  = ss.table_id
       LEFT JOIN orders.orders    o  ON o.id  = s.order_id
       LEFT JOIN catering.leads   l  ON l.id  = s.lead_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    query(
      `SELECT COUNT(*) AS total FROM billing.settlements s ${where}`,
      params,
    ),
  ]);

  return {
    settlements: listRes.rows,
    total: parseInt(countRes.rows[0].total, 10),
  };
}

async function createSettlement(client, {
  tenantId, sessionId = null, orderId = null, leadId = null,
  notes = null, createdBy = null,
}) {
  const res = await client.query(
    `INSERT INTO billing.settlements
       (tenant_id, session_id, order_id, lead_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, sessionId, orderId, leadId, notes, createdBy],
  );
  return res.rows[0];
}

async function updateSettlementTotals(client, settlementId, totals) {
  const res = await client.query(
    `UPDATE billing.settlements
     SET subtotal_paise       = $2,
         discount_paise       = $3,
         service_charge_paise = $4,
         packaging_paise      = $5,
         tax_paise            = $6,
         tip_paise            = $7,
         round_off_paise      = $8,
         total_paise          = $9,
         updated_at           = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      settlementId,
      totals.subtotal_paise,
      totals.discount_paise,
      totals.charge_paise,
      totals.packaging_paise,
      totals.tax_paise,
      totals.tip_paise,
      totals.round_off_paise,
      totals.total_paise,
    ],
  );
  return res.rows[0];
}

async function updateSettlementStatus(client, tenantId, settlementId, status, actorId, extra = {}) {
  const sets = ['status = $3', 'updated_at = NOW()'];
  const params = [settlementId, tenantId, status];

  if (status === 'finalized') {
    sets.push(`finalized_at = NOW()`, `finalized_by = $${params.length + 1}`);
    params.push(actorId);
    if (extra.gst_snapshot) {
      sets.push(`gst_snapshot = $${params.length + 1}`);
      params.push(JSON.stringify(extra.gst_snapshot));
    }
  }
  if (status === 'voided') {
    sets.push(`voided_at = NOW()`, `voided_by = $${params.length + 1}`, `void_reason = $${params.length + 2}`);
    params.push(actorId, extra.void_reason || null);
  }

  const res = await client.query(
    `UPDATE billing.settlements
     SET ${sets.join(', ')}
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    params,
  );
  return res.rows[0] || null;
}

async function updateSettlementNotes(client, tenantId, settlementId, notes) {
  const exec = client ? (s, p) => client.query(s, p) : (s, p) => query(s, p);
  const res = await exec(
    `UPDATE billing.settlements
     SET notes = $3, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [settlementId, tenantId, notes],
  );
  return res.rows[0] || null;
}

async function updatePaidPaise(client, settlementId, tenantId, paidPaise) {
  await client.query(
    `UPDATE billing.settlements
     SET paid_paise = $3, updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [settlementId, tenantId, paidPaise],
  );
}

// ── Settlement Lines ─────────────────────────────────────────────────────────

async function listLines(client, tenantId, settlementId) {
  const exec = client ? (s, p) => client.query(s, p) : (s, p) => query(s, p);
  const res = await exec(
    `SELECT * FROM billing.settlement_lines
     WHERE settlement_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY sort_order ASC, created_at ASC`,
    [settlementId, tenantId],
  );
  return res.rows;
}

async function insertLine(client, tenantId, settlementId, line) {
  // Discount amounts are stored as negative paise — enforce at the storage boundary
  let amount_paise = Math.round(Number(line.amount_paise));
  if (line.line_type === 'DISCOUNT') amount_paise = -Math.abs(amount_paise);

  const res = await client.query(
    `INSERT INTO billing.settlement_lines (
       tenant_id, settlement_id, line_type,
       source_order_id, source_order_item_id,
       description, quantity, unit_price_paise, amount_paise,
       percent, applies_to, tax_name, tax_rate,
       is_comp, comp_reason, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      tenantId, settlementId, line.line_type,
      line.source_order_id || null, line.source_order_item_id || null,
      line.description, line.quantity ?? 1,
      line.unit_price_paise ?? null, amount_paise,
      line.percent ?? null, line.applies_to ?? null,
      line.tax_name ?? null, line.tax_rate ?? null,
      line.is_comp ?? false, line.comp_reason ?? null,
      line.sort_order ?? 0,
    ],
  );
  return res.rows[0];
}

async function updateLine(client, tenantId, lineId, patch) {
  const sets   = [];
  const params = [lineId, tenantId];

  // Mirror insertLine: DISCOUNT amounts must be stored as negative paise
  if (patch.amount_paise !== undefined && patch.line_type === 'DISCOUNT') {
    patch = { ...patch, amount_paise: -Math.abs(Math.round(Number(patch.amount_paise))) };
  } else if (patch.amount_paise !== undefined) {
    patch = { ...patch, amount_paise: Math.round(Number(patch.amount_paise)) };
  }

  // Fetch line_type from DB if caller didn't provide it, so we can enforce the invariant
  // even when only amount_paise is patched without line_type in the payload.
  // (line_type is immutable after insert, so reading it here is safe)
  if (patch.amount_paise !== undefined && patch.line_type === undefined) {
    const typeRes = await client.query(
      `SELECT line_type FROM billing.settlement_lines WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [lineId, tenantId]
    );
    if (typeRes.rows[0]?.line_type === 'DISCOUNT') {
      patch = { ...patch, amount_paise: -Math.abs(patch.amount_paise) };
    }
  }

  const allowed = ['description','quantity','unit_price_paise','amount_paise',
                   'percent','is_comp','comp_reason','sort_order'];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  const res = await client.query(
    `UPDATE billing.settlement_lines
     SET ${sets.join(', ')}
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING *`,
    params,
  );
  return res.rows[0] || null;
}

async function softDeleteLine(client, tenantId, lineId) {
  const res = await client.query(
    `UPDATE billing.settlement_lines
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [lineId, tenantId],
  );
  return res.rows[0] || null;
}

// ── Revisions ─────────────────────────────────────────────────────────────────

async function nextRevisionNumber(client, settlementId) {
  const res = await client.query(
    `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next
     FROM billing.settlement_revisions WHERE settlement_id = $1`,
    [settlementId],
  );
  return res.rows[0].next;
}

async function insertRevision(client, tenantId, settlementId, {
  actorId, actorType = 'staff', changeType, lineId = null,
  beforeState = null, afterState = null, reason = null,
}) {
  const revNum = await nextRevisionNumber(client, settlementId);
  await client.query(
    `INSERT INTO billing.settlement_revisions
       (tenant_id, settlement_id, revision_number, actor_id, actor_type,
        change_type, line_id, before_state, after_state, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      tenantId, settlementId, revNum, actorId, actorType, changeType, lineId,
      beforeState ? JSON.stringify(beforeState) : null,
      afterState  ? JSON.stringify(afterState)  : null,
      reason,
    ],
  );
  return revNum;
}

async function listRevisions(tenantId, settlementId) {
  const res = await query(
    `SELECT r.*, s.name AS actor_name, s.email AS actor_email
     FROM billing.settlement_revisions r
     LEFT JOIN tenant.staff s ON s.id = r.actor_id
     WHERE r.settlement_id = $1 AND r.tenant_id = $2
     ORDER BY r.revision_number ASC`,
    [settlementId, tenantId],
  );
  return res.rows;
}

// ── Invoices ──────────────────────────────────────────────────────────────────

async function nextInvoiceNumber(client, tenantId) {
  const res = await client.query(
    `INSERT INTO billing.invoice_counters (tenant_id, last_number)
     VALUES ($1, 1)
     ON CONFLICT (tenant_id) DO UPDATE
       SET last_number = billing.invoice_counters.last_number + 1
     RETURNING last_number`,
    [tenantId],
  );
  const num = res.rows[0].last_number;
  const year = new Date().getFullYear().toString().slice(-2);
  return `INV-${year}-${String(num).padStart(5, '0')}`;
}

async function insertInvoice(client, tenantId, settlementId, { snapshot, generatedBy, version = 1, invoiceNumber }) {
  const res = await client.query(
    `INSERT INTO billing.invoices
       (tenant_id, settlement_id, invoice_number, snapshot, version, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [tenantId, settlementId, invoiceNumber, JSON.stringify(snapshot), version, generatedBy],
  );
  return res.rows[0];
}

async function listInvoices(tenantId, settlementId) {
  const res = await query(
    `SELECT id, invoice_number, version, generated_at, generated_by
     FROM billing.invoices
     WHERE settlement_id = $1 AND tenant_id = $2
     ORDER BY version DESC`,
    [settlementId, tenantId],
  );
  return res.rows;
}

async function getInvoice(tenantId, invoiceId) {
  const res = await query(
    `SELECT * FROM billing.invoices WHERE id = $1 AND tenant_id = $2`,
    [invoiceId, tenantId],
  );
  return res.rows[0] || null;
}

// ── Payments ──────────────────────────────────────────────────────────────────
// Every row's amount_paise is always positive (DB-enforced). A refund to the
// guest is its own row (kind='refund') that nets against the total; a
// correction to a mis-entered payment soft-voids the original row instead of
// deleting it, so the ledger stays append-only and legible after the fact.

async function insertPayment(client, tenantId, settlementId, { method, amount_paise, kind, reason, reference, notes, recordedBy }) {
  const res = await client.query(
    `INSERT INTO billing.payments
       (tenant_id, settlement_id, method, amount_paise, kind, reason, reference, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [tenantId, settlementId, method, amount_paise, kind || 'payment', reason || null, reference || null, notes || null, recordedBy || null],
  );
  return res.rows[0];
}

async function findPayment(client, tenantId, paymentId) {
  const exec = client ? (s, p) => client.query(s, p) : (s, p) => query(s, p);
  const res = await exec(
    `SELECT * FROM billing.payments WHERE id = $1 AND tenant_id = $2`,
    [paymentId, tenantId],
  );
  return res.rows[0] || null;
}

async function voidPayment(client, tenantId, paymentId, { voidedBy, voidReason }) {
  const res = await client.query(
    `UPDATE billing.payments
     SET voided_at = NOW(), voided_by = $1, void_reason = $2
     WHERE id = $3 AND tenant_id = $4 AND voided_at IS NULL
     RETURNING *`,
    [voidedBy || null, voidReason, paymentId, tenantId],
  );
  return res.rows[0] || null;
}

async function listPayments(tenantId, settlementId) {
  const res = await query(
    `SELECT * FROM billing.payments
     WHERE settlement_id = $1 AND tenant_id = $2
     ORDER BY recorded_at ASC`,
    [settlementId, tenantId],
  );
  return res.rows;
}

// Nets payments minus refunds, excluding voided (corrected) rows entirely.
async function sumPayments(client, settlementId) {
  const res = await client.query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_paise ELSE amount_paise END), 0) AS total
     FROM billing.payments WHERE settlement_id = $1 AND voided_at IS NULL`,
    [settlementId],
  );
  return parseInt(res.rows[0].total, 10);
}

module.exports = {
  findSettlement, findSettlementForUpdate, findSettlementBySession, findSettlementByOrder, findSettlementByLead,
  listSettlements,
  createSettlement, updateSettlementTotals, updateSettlementStatus,
  updateSettlementNotes, updatePaidPaise,
  listLines, insertLine, updateLine, softDeleteLine,
  nextRevisionNumber, insertRevision, listRevisions,
  nextInvoiceNumber, insertInvoice, listInvoices, getInvoice,
  insertPayment, findPayment, voidPayment, listPayments, sumPayments,
};
