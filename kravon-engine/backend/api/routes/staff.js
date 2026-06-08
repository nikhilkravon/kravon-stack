'use strict';

const express  = require('express');
const { z }    = require('zod');
const identityService = require('../../domains/identity/service');
const { requireRestaurantAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRestaurantAuth);

const CreateStaffSchema = z.object({
  name:     z.string().min(1).max(120),
  email:    z.string().email().max(120),
  password: z.string().min(8).max(200),
  phone:    z.string().max(30).optional(),
  role:     z.enum(['manager', 'staff', 'kitchen']).default('staff'),
});

const UpdateStaffSchema = z.object({
  name:      z.string().min(1).max(120).optional(),
  phone:     z.string().max(30).optional(),
  is_active: z.boolean().optional(),
  password:  z.string().min(8).max(200).optional(),
});

router.get('/', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const staff = await identityService.listStaff(req.tenant.tenant_id);
    res.json({ ok: true, staff });
  } catch (err) { next(err); }
});

router.post('/', requireRole('owner'), async (req, res, next) => {
  try {
    const parsed = CreateStaffSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

    const staff = await identityService.createStaff(req.tenant.tenant_id, parsed.data, req.auth?.staffId, req);
    res.status(201).json({ ok: true, staff });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A staff member with this email already exists.' });
    next(err);
  }
});

router.patch('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    const parsed = UpdateStaffSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    if (!Object.keys(parsed.data).length) return res.status(400).json({ error: 'Nothing to update' });

    if (parsed.data.is_active === false && req.params.id === req.auth?.staffId) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    const staff = await identityService.updateStaff(req.tenant.tenant_id, req.params.id, parsed.data, req.auth?.staffId, req);
    if (!staff) return res.status(404).json({ error: 'Staff member not found' });
    res.json({ ok: true, staff });
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    if (req.params.id === req.auth?.staffId) return res.status(400).json({ error: 'You cannot delete your own account.' });

    const row = await identityService.deleteStaff(req.tenant.tenant_id, req.params.id, req.auth?.staffId, req);
    if (!row) return res.status(404).json({ error: 'Staff member not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
