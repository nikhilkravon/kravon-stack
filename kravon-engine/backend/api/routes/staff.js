/**
 * ROUTE — staff.js
 * GET    /v1/restaurants/:slug/staff           — list staff
 * POST   /v1/restaurants/:slug/staff           — create staff member
 * PATCH  /v1/restaurants/:slug/staff/:id       — update (name, phone, is_active, password)
 * DELETE /v1/restaurants/:slug/staff/:id       — soft delete (deactivate)
 *
 * Authorization:
 *   GET    — owner, manager
 *   POST   — owner only
 *   PATCH  — owner only
 *   DELETE — owner only
 */

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const { z }    = require('zod');
const { query } = require('../../db/pool');
const { requireRestaurantAuth, requireRole } = require('../middleware/auth');
const audit    = require('../../utils/audit');

const router = express.Router();
router.use(requireRestaurantAuth);

/* ── GET /staff ──────────────────────────────────────────────────────────── */
router.get('/', requireRole('owner', 'manager'), async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const result   = await query(
      `SELECT
         s.id, s.name, s.email, s.phone, s.is_active,
         s.last_login_at, s.created_at,
         COALESCE(
           json_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
           '[]'::json
         ) AS roles
       FROM tenant.staff s
       LEFT JOIN tenant.staff_roles sr ON sr.staff_id = s.id
       LEFT JOIN tenant.roles r        ON r.id = sr.role_id
       WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
       GROUP BY s.id
       ORDER BY s.created_at`,
      [tenantId]
    );
    res.json({ ok: true, staff: result.rows });
  } catch (err) { next(err); }
});

/* ── POST /staff ─────────────────────────────────────────────────────────── */
const CreateStaffSchema = z.object({
  name:     z.string().min(1).max(120),
  email:    z.string().email().max(120),
  password: z.string().min(8).max(200),
  phone:    z.string().max(30).optional(),
  role:     z.enum(['manager', 'staff', 'kitchen']).default('staff'),
});

router.post('/', requireRole('owner'), async (req, res, next) => {
  try {
    const parsed = CreateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const tenantId = req.tenant.tenant_id;
    const { name, email, password, phone, role } = parsed.data;

    const passwordHash = await bcrypt.hash(password, 12);

    const staffRes = await query(
      `INSERT INTO tenant.staff (tenant_id, name, email, phone, password_hash, auth_provider, is_active)
       VALUES ($1, $2, $3, $4, $5, 'email', TRUE)
       RETURNING id, name, email, phone, is_active, created_at`,
      [tenantId, name, email, phone ?? null, passwordHash]
    );

    const staffId = staffRes.rows[0].id;

    // Assign role if a matching role exists for this tenant
    const roleRes = await query(
      `SELECT id FROM tenant.roles WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, role]
    );
    if (roleRes.rows.length) {
      await query(
        `INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id, assigned_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (staff_id, role_id) DO NOTHING`,
        [tenantId, staffId, roleRes.rows[0].id, req.auth?.staffId ?? null]
      );
    }

    audit.log(null, {
      tenantId,
      actorId:    req.auth?.staffId,
      actorType:  'staff',
      action:     'staff.create',
      entityType: 'tenant.staff',
      entityId:   staffId,
      newValue:   { name, email, phone, role },
      req,
    });

    res.status(201).json({ ok: true, staff: { ...staffRes.rows[0], roles: [role] } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A staff member with this email already exists.' });
    next(err);
  }
});

/* ── PATCH /staff/:id ────────────────────────────────────────────────────── */
const UpdateStaffSchema = z.object({
  name:      z.string().min(1).max(120).optional(),
  phone:     z.string().max(30).optional(),
  is_active: z.boolean().optional(),
  password:  z.string().min(8).max(200).optional(),
});

router.patch('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    const parsed = UpdateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const d        = parsed.data;
    const tenantId = req.tenant.tenant_id;
    const sets     = [];
    const values   = [];
    let   idx      = 1;

    if (d.name      !== undefined) { sets.push(`name = $${idx++}`);      values.push(d.name); }
    if (d.phone     !== undefined) { sets.push(`phone = $${idx++}`);     values.push(d.phone); }
    if (d.is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(d.is_active); }
    if (d.password  !== undefined) {
      const hash = await bcrypt.hash(d.password, 12);
      sets.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    // Prevent deactivating yourself
    if (d.is_active === false && req.params.id === req.auth?.staffId) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }

    sets.push('updated_at = NOW()');
    values.push(req.params.id, tenantId);

    const result = await query(
      `UPDATE tenant.staff SET ${sets.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING id, name, email, phone, is_active, updated_at`,
      values
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Staff member not found' });

    audit.log(null, {
      tenantId,
      actorId:    req.auth?.staffId,
      actorType:  'staff',
      action:     'staff.update',
      entityType: 'tenant.staff',
      entityId:   req.params.id,
      newValue:   { ...d, password: d.password ? '[redacted]' : undefined },
      req,
    });

    res.json({ ok: true, staff: result.rows[0] });
  } catch (err) { next(err); }
});

/* ── DELETE /staff/:id ───────────────────────────────────────────────────── */
router.delete('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;

    if (req.params.id === req.auth?.staffId) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    // Revoke all active sessions first
    await query(
      `UPDATE tenant.staff_sessions SET revoked_at = NOW()
       WHERE staff_id = $1 AND revoked_at IS NULL`,
      [req.params.id]
    );

    const result = await query(
      `UPDATE tenant.staff SET deleted_at = NOW(), is_active = FALSE
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id, name, email`,
      [req.params.id, tenantId]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Staff member not found' });

    audit.log(null, {
      tenantId,
      actorId:    req.auth?.staffId,
      actorType:  'staff',
      action:     'staff.delete',
      entityType: 'tenant.staff',
      entityId:   req.params.id,
      oldValue:   result.rows[0],
      req,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
