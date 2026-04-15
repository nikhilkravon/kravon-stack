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

  const result = await query(`
    INSERT INTO catering_leads (
      rest_id, ref, name, company, email, phone,
      budget, headcount, event_type, date_start, date_end, notes,
      score, tier, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'new')
    RETURNING id, ref, tier
  `, [
    tenant.rest_id, ref,
    data.name, data.company, data.email, data.phone,
    data.budget      || null,
    data.headcount   || null,
    data.event_type  || null,
    data.date_start  || null,
    data.date_end    || null,
    data.notes       || null,
    score, tier,
  ]);

  const lead = result.rows[0];

  // Fire notifications async — never block the API response
  notifyService.leadReceived(tenant, { ...data, id: lead.id, ref, tier, score }).catch(err =>
    console.error('[lead.service] notify failed:', err.message)
  );

  return { ref: lead.ref, tier: lead.tier };
}

module.exports = { createLead };
