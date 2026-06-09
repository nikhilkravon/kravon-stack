'use strict';

const express         = require('express');
const { z }           = require('zod');
const cateringService = require('../../domains/catering/service');
const { requireRestaurantAuth } = require('../middleware/auth');
const events = require('../../utils/events');

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

const UpdateLeadSchema = z.object({
  status: z.enum(['new','contacted','proposal_sent','negotiating','confirmed','lost','on_hold']).optional(),
  notes:  z.string().max(2000).optional(),
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = CreateLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

    const result = await cateringService.createLead(req.tenant, parsed.data);
    events.emit('lead.created', { tenantId: req.tenant.tenant_id, leadId: result.id,
      contactName: parsed.data.name, eventType: parsed.data.event_type ?? null });
    res.status(201).json({ ok: true, lead: { ref: result.ref } });
  } catch (err) { next(err); }
});

router.get('/', requireRestaurantAuth, async (req, res, next) => {
  try {
    const page  = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit = Math.min(100,   Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { leads, total } = await cateringService.listLeads(req.tenant.tenant_id, {
      page, limit, status: req.query.status || null,
    });
    res.json({ ok: true, leads, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

router.patch('/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const parsed = UpdateLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    if (!parsed.data.status && parsed.data.notes === undefined) return res.status(400).json({ error: 'Nothing to update' });

    const result = await cateringService.updateLeadStatus(
      req.tenant.tenant_id, req.params.id, parsed.data, req.auth?.staffId
    );
    if (result.error) return res.status(result.httpStatus || 500).json({ error: result.error });
    res.json({ ok: true, lead: result.lead });
  } catch (err) { next(err); }
});

module.exports = router;
