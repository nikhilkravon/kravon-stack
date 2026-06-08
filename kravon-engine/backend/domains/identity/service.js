'use strict';

const bcrypt        = require('bcryptjs');
const { query }     = require('../../db/pool');
const audit         = require('../../utils/audit');

async function listStaff(tenantId) {
  const res = await query(
    `SELECT
       s.id, s.name, s.email, s.phone, s.is_active,
       s.last_login_at, s.created_at,
       COALESCE(json_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '[]'::json) AS roles
     FROM tenant.staff s
     LEFT JOIN tenant.staff_roles sr ON sr.staff_id = s.id
     LEFT JOIN tenant.roles r        ON r.id = sr.role_id
     WHERE s.tenant_id = $1 AND s.deleted_at IS NULL
     GROUP BY s.id
     ORDER BY s.created_at`,
    [tenantId]
  );
  return res.rows;
}

async function createStaff(tenantId, { name, email, password, phone, role }, actorId, req) {
  const passwordHash = await bcrypt.hash(password, 12);

  const staffRes = await query(
    `INSERT INTO tenant.staff (tenant_id, name, email, phone, password_hash, auth_provider, is_active)
     VALUES ($1, $2, $3, $4, $5, 'email', TRUE)
     RETURNING id, name, email, phone, is_active, created_at`,
    [tenantId, name, email, phone ?? null, passwordHash]
  );
  const staffId = staffRes.rows[0].id;

  const roleRes = await query(
    `SELECT id FROM tenant.roles WHERE tenant_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
    [tenantId, role]
  );
  if (roleRes.rows.length) {
    await query(
      `INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id, assigned_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT (staff_id, role_id) DO NOTHING`,
      [tenantId, staffId, roleRes.rows[0].id, actorId ?? null]
    );
  }

  audit.log(null, { tenantId, actorId, actorType: 'staff', action: 'staff.create',
    entityType: 'tenant.staff', entityId: staffId, newValue: { name, email, phone, role }, req });

  return { ...staffRes.rows[0], roles: [role] };
}

async function updateStaff(tenantId, staffId, data, actorId, req) {
  const sets = []; const values = []; let idx = 1;

  if (data.name      !== undefined) { sets.push(`name = $${idx++}`);      values.push(data.name); }
  if (data.phone     !== undefined) { sets.push(`phone = $${idx++}`);     values.push(data.phone); }
  if (data.is_active !== undefined) { sets.push(`is_active = $${idx++}`); values.push(data.is_active); }
  if (data.password  !== undefined) {
    sets.push(`password_hash = $${idx++}`);
    values.push(await bcrypt.hash(data.password, 12));
  }
  if (!sets.length) return null;

  sets.push('updated_at = NOW()');
  values.push(staffId, tenantId);

  const res = await query(
    `UPDATE tenant.staff SET ${sets.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING id, name, email, phone, is_active, updated_at`,
    values
  );
  if (!res.rows.length) return null;

  audit.log(null, { tenantId, actorId, actorType: 'staff', action: 'staff.update',
    entityType: 'tenant.staff', entityId: staffId,
    newValue: { ...data, password: data.password ? '[redacted]' : undefined }, req });

  return res.rows[0];
}

async function deleteStaff(tenantId, staffId, actorId, req) {
  await query(
    `UPDATE tenant.staff_sessions SET revoked_at = NOW() WHERE staff_id = $1 AND revoked_at IS NULL`,
    [staffId]
  );
  const res = await query(
    `UPDATE tenant.staff SET deleted_at = NOW(), is_active = FALSE
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING id, name, email`,
    [staffId, tenantId]
  );
  if (!res.rows.length) return null;

  audit.log(null, { tenantId, actorId, actorType: 'staff', action: 'staff.delete',
    entityType: 'tenant.staff', entityId: staffId, oldValue: res.rows[0], req });

  return res.rows[0];
}

module.exports = { listStaff, createStaff, updateStaff, deleteStaff };
