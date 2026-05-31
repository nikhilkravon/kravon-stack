/**
 * ROUTE — leads.js
 * POST   /v1/restaurants/:slug/leads
 * GET    /v1/restaurants/:slug/leads         (admin)
 * PATCH  /v1/restaurants/:slug/leads/:id     (admin)
 */

'use strict';

const express  = require('express');
const { z }    = require('zod');
const { query } = require('../../db/pool');
const leadService = require('../../services/lead.service');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

const CreateLeadSchema = z.object({
  name:       z.string().min(1).max(120),
  company:    z.string().min(1).max(150),
  email:      z.string().email().max(120),
  phone:      z.string().min(10).max(20),
  budget:     z.string().max(30).optional(),
  headcount:  z.string().max(20).optional(),
  event_type: z.string().max(50).optional(),
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  date_end:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes:      z.string().max(2000).optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = CreateLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const result = await leadService.createLead(req.tenant, parsed.data);

    res.status(201).json({
      ok:   true,
      lead: { ref: result.ref, tier: result.tier },
    });
  } catch (err) {
    next(err);
  }
});

/* ── GET /leads (admin — paginated list) ─────────────────────────────────── */
router.get('/', requireRestaurantAuth, async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const page     = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit    = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset   = (page - 1) * limit;
    const status   = req.query.status || null;

    const params  = [tenantId];
    const filters = ['tenant_id = $1', 'deleted_at IS NULL'];

    if (status) {
      params.push(status);
      filters.push(`status = $${params.length}`);
    }

    const where = `WHERE ${filters.join(' AND ')}`;

    const [listRes, countRes] = await Promise.all([
      query(
        `SELECT
           id, contact_name, contact_email, contact_phone,
           event_type, preferred_date_from, preferred_date_to,
           notes, source, status, custom_fields, created_at, updated_at
         FROM catering.leads
         ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) AS total FROM catering.leads ${where}`, params),
    ]);

    const total = parseInt(countRes.rows[0].total, 10);
    res.json({
      ok:    true,
      leads: listRes.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

/* ── PATCH /leads/:id (admin — update status / notes) ───────────────────── */
const VALID_STATUSES = ['new', 'contacted', 'proposal_sent', 'negotiating', 'confirmed', 'lost', 'on_hold'];

const UpdateLeadSchema = z.object({
  status: z.enum(VALID_STATUSES).optional(),
  notes:  z.string().max(2000).optional(),
});

router.patch('/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const parsed = UpdateLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { status, notes } = parsed.data;
    if (!status && notes === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const sets   = [];
    const params = [req.params.id, req.tenant.tenant_id];

    if (status !== undefined) { params.push(status); sets.push(`status = $${params.length}`); }
    if (notes  !== undefined) { params.push(notes);  sets.push(`notes  = $${params.length}`); }
    sets.push(`updated_at = NOW()`);

    const result = await query(
      `UPDATE catering.leads
       SET ${sets.join(', ')}
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id, status, notes, updated_at`,
      params
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Lead not found' });
    res.json({ ok: true, lead: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
