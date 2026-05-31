/**
 * SERVICE — lead.service.js
 * Catering lead creation, scoring, and notification dispatch.
 *
 * Scoring mirrors the V7 frontend logic but runs server-side.
 * The frontend score is advisory — server always recomputes.
 *
 * Score → tier:
 *   >= 8 → hot
 *   >= 5 → warm
 *   < 5  → cool
 *
 * V10: fires outbound webhook after every lead (via notify.service.js)
 *
 * Example call:
 *   const result = await createLead(req.tenant, req.body);
 *   // result = { ref: "DFC-1A2B3C", tier: "hot" }
 */

'use strict';

const { query }     = require('../db/pool');
const notifyService = require('./notify.service');

/* ── Scoring weights ──────────────────────────────────────────────────────── */
const BUDGET_SCORES = { '5L+': 4, '2.5-5L': 3, '1-2.5L': 2, 'below-1L': 0 };
const PAX_SCORES    = { '500+': 3, '300-500': 2, '150-300': 2, '50-150': 1 };
const TYPE_SCORES   = {
  'corporate-offsite': 3,
  'product-launch':    3,
  'conference':        2,
  'daily-office':      2,
  'other':             1,
};

function scoreLead(budget, headcount, type) {
  return (BUDGET_SCORES[budget] || 0) +
         (PAX_SCORES[headcount]       || 0) +
         (TYPE_SCORES[type]     || 0);
}

function scoreTier(score) {
  if (score >= 8) return 'hot';
  if (score >= 5) return 'warm';
  return 'cool';
}

function generateRef(tenantName) {
  const prefix = (tenantName || 'K')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * createLead(tenant, data)
 *
 * @param {object} tenant - req.tenant
 * @param {object} data   - validated lead body from Zod schema in leads route
 * @returns {{ ref: string, tier: string }}
 */
async function createLead(tenant, data) {
  const score = scoreLead(data.budget, data.headcount, data.event_type);
  const tier  = scoreTier(score);
  const ref   = generateRef(tenant.name);

  // v12: catering.leads uses contact_name/contact_phone/contact_email, no company/ref/score/tier
  // Store extra fields (company, ref, score, tier) in custom_fields JSONB
  const result = await query(`
    INSERT INTO catering.leads (
      tenant_id,
      contact_name, contact_phone, contact_email,
      event_type,
      preferred_date_from, preferred_date_to,
      notes,
      source,
      status,
      custom_fields
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'web','new',$9)
    RETURNING id
  `, [
    tenant.tenant_id,
    data.name, data.phone, data.email,
    data.event_type  || null,
    data.date_start  || null,
    data.date_end    || null,
    data.notes       || null,
    JSON.stringify({
      company:   data.company   || null,
      budget:    data.budget    || null,
      headcount: data.headcount || null,
      ref,
      score,
      tier,
    }),
  ]);

  const lead = result.rows[0];

  notifyService.leadReceived(tenant, { ...data, id: lead.id, ref, tier, score }).catch(err =>
    console.error(JSON.stringify({ level: 'error', event: 'lead.notify_failed',
      tenantId: tenant.tenant_id, leadId: lead.id, message: err.message }))
  );

  return { ref, tier };
}

module.exports = { createLead };
