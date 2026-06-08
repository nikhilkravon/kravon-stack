'use strict';

/**
 * Catering domain — service.
 *
 * Owns the lead pipeline: creation, scoring, status updates.
 * F10 fix: when a lead converts to 'confirmed', it creates a catering event record
 * so the sale has an operational anchor beyond the pipeline.
 *
 * Re-exports createLead from the existing lead.service.js (backward compat).
 * All new catering logic lives here.
 */

const { query }     = require('../../db/pool');
const notifyService = require('../../services/notify.service');
const events        = require('../../utils/events');

/* ── Scoring ─────────────────────────────────────────────────────────────── */

const BUDGET_SCORES = { '5L+': 4, '2.5-5L': 3, '1-2.5L': 2, 'below-1L': 0 };
const PAX_SCORES    = { '500+': 3, '300-500': 2, '150-300': 2, '50-150': 1 };
const TYPE_SCORES   = {
  'corporate-offsite': 3, 'product-launch': 3,
  'conference': 2, 'daily-office': 2, 'other': 1,
};

function scoreLead(budget, headcount, type) {
  return (BUDGET_SCORES[budget] || 0) + (PAX_SCORES[headcount] || 0) + (TYPE_SCORES[type] || 0);
}

function scoreTier(score) {
  if (score >= 8) return 'hot';
  if (score >= 5) return 'warm';
  return 'cool';
}

function generateRef(tenantName) {
  const prefix = (tenantName || 'K').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

/* ── Public API ──────────────────────────────────────────────────────────── */

async function createLead(tenant, data) {
  const score = scoreLead(data.budget, data.headcount, data.event_type);
  const tier  = scoreTier(score);
  const ref   = generateRef(tenant.name);

  const result = await query(`
    INSERT INTO catering.leads (
      tenant_id, contact_name, contact_phone, contact_email,
      event_type, preferred_date_from, preferred_date_to,
      notes, source, status, custom_fields
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'web','new',$9)
    RETURNING id
  `, [
    tenant.tenant_id, data.name, data.phone, data.email,
    data.event_type || null, data.date_start || null, data.date_end || null,
    data.notes || null,
    JSON.stringify({ company: data.company || null, budget: data.budget || null,
                     headcount: data.headcount || null, ref, score, tier }),
  ]);

  const lead = result.rows[0];

  notifyService.leadReceived(tenant, { ...data, id: lead.id, ref, tier, score }).catch(err =>
    console.error(JSON.stringify({ level: 'error', event: 'lead.notify_failed',
      tenantId: tenant.tenant_id, leadId: lead.id, message: err.message }))
  );

  return { id: lead.id, ref, tier };
}

/**
 * Update lead status.
 * F10: when status becomes 'confirmed', create a catering.events record
 * so the converted lead has an operational anchor.
 */
async function updateLeadStatus(tenantId, leadId, { status, notes }, staffId) {
  const VALID_STATUSES = ['new', 'contacted', 'proposal_sent', 'negotiating', 'confirmed', 'lost', 'on_hold'];
  if (status && !VALID_STATUSES.includes(status)) {
    return { error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}`, httpStatus: 400 };
  }

  const sets   = [];
  const params = [leadId, tenantId];

  if (status !== undefined) { params.push(status); sets.push(`status = $${params.length}`); }
  if (notes  !== undefined) { params.push(notes);  sets.push(`notes  = $${params.length}`); }
  sets.push(`updated_at = NOW()`);

  const result = await query(
    `UPDATE catering.leads
     SET ${sets.join(', ')}
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING id, status, notes, custom_fields, preferred_date_from, preferred_date_to, updated_at`,
    params
  );

  if (!result.rows.length) return { error: 'Lead not found', httpStatus: 404 };

  const lead = result.rows[0];

  if (status) {
    events.emit('lead.status_updated', { tenantId, leadId, status, actorId: staffId });

    // F10: operational handoff — create event record when lead converts
    if (status === 'confirmed') {
      await createCateringEventFromLead(tenantId, lead);
    }
  }

  return { lead: { id: lead.id, status: lead.status, notes: lead.notes, updated_at: lead.updated_at } };
}

/**
 * Create a catering.events record linked to the converted lead.
 * This is the F10 operational handoff — the sale now has a scheduled event.
 */
async function createCateringEventFromLead(tenantId, lead) {
  try {
    const customFields = lead.custom_fields || {};

    // Avoid duplicate event if lead was confirmed more than once (re-run safe)
    const existing = await query(
      `SELECT id FROM catering.events WHERE lead_id = $1 LIMIT 1`,
      [lead.id]
    );
    if (existing.rows.length) return;

    await query(
      `INSERT INTO catering.events (
         tenant_id, lead_id, status,
         event_date_from, event_date_to,
         notes, created_at, updated_at
       ) VALUES ($1, $2, 'confirmed', $3, $4, $5, NOW(), NOW())`,
      [
        tenantId, lead.id, 'confirmed',
        lead.preferred_date_from || null,
        lead.preferred_date_to   || null,
        customFields.company ? `Client: ${customFields.company}` : null,
      ]
    );

    events.emit('lead.converted', { tenantId, leadId: lead.id });
  } catch (err) {
    // Non-fatal — lead status update already committed. Log and continue.
    console.error(JSON.stringify({ level: 'error', event: 'catering.event_create_failed',
      tenantId, leadId: lead.id, message: err.message }));
  }
}

async function listLeads(tenantId, { page = 1, limit = 25, status = null } = {}) {
  const offset  = (page - 1) * limit;
  const params  = [tenantId];
  const filters = ['tenant_id = $1', 'deleted_at IS NULL'];

  if (status) { params.push(status); filters.push(`status = $${params.length}`); }

  const where = `WHERE ${filters.join(' AND ')}`;
  const [listRes, countRes] = await Promise.all([
    query(
      `SELECT id, contact_name, contact_email, contact_phone,
              event_type, preferred_date_from, preferred_date_to,
              notes, source, status, custom_fields, created_at, updated_at
       FROM catering.leads ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*) AS total FROM catering.leads ${where}`, params),
  ]);
  return {
    leads: listRes.rows,
    total: parseInt(countRes.rows[0].total, 10),
  };
}

module.exports = { createLead, updateLeadStatus, listLeads };
