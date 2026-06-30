'use strict';

const express  = require('express');
const { z }    = require('zod');
const identityService = require('../../domains/identity/service');
const { requireRestaurantAuth, requireRole } = require('../middleware/auth');
const { query, getClient } = require('../../db/pool');
const audit = require('../../utils/audit');

const router = express.Router();
router.use(requireRestaurantAuth);

const CreateStaffSchema = z.object({
  name:     z.string().min(1).max(120),
  email:    z.string().email().max(120),
  password: z.string().min(8).max(200),
  phone:    z.string().max(30).optional(),
  role:     z.enum(['manager', 'staff', 'kitchen']).default('staff'),
});

const STAFF_ROLES = ['staff', 'manager', 'kitchen', 'cashier', 'host', 'catering'];

const UpdateStaffSchema = z.object({
  name:      z.string().min(1).max(120).optional(),
  phone:     z.string().max(30).optional(),
  is_active: z.boolean().optional(),
  password:  z.string().min(8).max(200).optional(),
  role:      z.enum(STAFF_ROLES).optional(),
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

    const { role, password, ...fields } = parsed.data;
    const tenantId = req.tenant.tenant_id;
    const staffId  = req.params.id;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Role change
      if (role) {
        const roleRow = await client.query(
          `SELECT id FROM tenant.roles WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
          [tenantId, role]
        );
        if (!roleRow.rows.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Role '${role}' not found for this restaurant.` });
        }
        const roleId = roleRow.rows[0].id;
        await client.query(`DELETE FROM tenant.staff_roles WHERE staff_id = $1 AND tenant_id = $2`, [staffId, tenantId]);
        await client.query(
          `INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id, assigned_by) VALUES ($1, $2, $3, $4)`,
          [tenantId, staffId, roleId, req.auth?.staffId ?? null]
        );
        await audit.log(client, {
          tenantId, actorId: req.auth?.staffId ?? null, actorType: 'staff',
          action: 'staff.role_changed', entityType: 'tenant.staff', entityId: staffId,
          newValue: { role },
        });
      }

      // Field update (name, phone, is_active, password) — same transaction
      const sets = []; const values = []; let idx = 1;
      if (fields.name      !== undefined) { sets.push(`name = $${idx++}`);      values.push(fields.name); }
      if (fields.phone     !== undefined) { sets.push(`phone = $${idx++}`);     values.push(fields.phone); }
      if (fields.is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(fields.is_active); }
      if (password         !== undefined) {
        const bcrypt = require('bcryptjs');
        sets.push(`password_hash = $${idx++}`);
        values.push(await bcrypt.hash(password, 12));
      }

      let staffRow;
      if (sets.length) {
        sets.push('updated_at = NOW()');
        values.push(staffId, tenantId);
        const res2 = await client.query(
          `UPDATE tenant.staff SET ${sets.join(', ')}
           WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
           RETURNING id, name, email, phone, is_active, updated_at`,
          values
        );
        staffRow = res2.rows[0] || null;
      } else {
        const res2 = await client.query(
          `SELECT id, name, email, phone, is_active, updated_at FROM tenant.staff
           WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL LIMIT 1`,
          [staffId, tenantId]
        );
        staffRow = res2.rows[0] || null;
      }

      if (!staffRow) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Staff member not found' }); }

      await client.query('COMMIT');
      res.json({ ok: true, staff: staffRow });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
