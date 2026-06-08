'use strict';

const { query } = require('../../db/pool');

async function findTenantBySlug(slug) {
  const res = await query(
    'SELECT id FROM tenant.restaurants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1',
    [slug]
  );
  return res.rows[0] || null;
}

async function findStaffForLogin(tenantId, email) {
  const res = await query(
    `SELECT s.id, s.name, s.email, s.password_hash,
            COALESCE(
              json_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
              '[]'::json
            ) AS roles
     FROM tenant.staff s
     LEFT JOIN tenant.staff_roles sr ON sr.staff_id = s.id
     LEFT JOIN tenant.roles       r  ON r.id = sr.role_id
     WHERE s.tenant_id = $1
       AND s.email = $2
       AND s.is_active = true
       AND s.deleted_at IS NULL
     GROUP BY s.id`,
    [tenantId, email]
  );
  return res.rows[0] || null;
}

async function createSession(tenantId, staffId, hashedToken, deviceInfo, expiresAt) {
  await query(
    `INSERT INTO tenant.staff_sessions (tenant_id, staff_id, session_token, device_info, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, staffId, hashedToken, JSON.stringify(deviceInfo), expiresAt]
  );
}

async function touchLastLogin(staffId) {
  return query('UPDATE tenant.staff SET last_login_at = NOW() WHERE id = $1', [staffId])
    .catch(() => {});
}

async function findSessionByToken(hashedToken) {
  const res = await query(
    `SELECT ss.staff_id, ss.tenant_id,
            s.name, s.email, s.is_active, s.deleted_at,
            tr.slug,
            COALESCE(
              json_agg(r.name) FILTER (WHERE r.name IS NOT NULL),
              '[]'::json
            ) AS roles
     FROM tenant.staff_sessions ss
     JOIN tenant.staff       s   ON s.id  = ss.staff_id
     JOIN tenant.restaurants tr  ON tr.id = ss.tenant_id
     LEFT JOIN tenant.staff_roles sr ON sr.staff_id = s.id
     LEFT JOIN tenant.roles       r  ON r.id = sr.role_id
     WHERE ss.session_token = $1
       AND ss.revoked_at IS NULL
       AND ss.expires_at  > NOW()
     GROUP BY ss.staff_id, ss.tenant_id, s.name, s.email, s.is_active, s.deleted_at, tr.slug`,
    [hashedToken]
  );
  return res.rows[0] || null;
}

async function findStaffById(staffId) {
  const res = await query(
    `SELECT id, password_hash FROM tenant.staff
     WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
    [staffId]
  );
  return res.rows[0] || null;
}

async function updatePassword(staffId, newHash) {
  await query(
    `UPDATE tenant.staff SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [newHash, staffId]
  );
}

async function revokeAllSessions(staffId) {
  await query(
    `UPDATE tenant.staff_sessions SET revoked_at = NOW()
     WHERE staff_id = $1 AND revoked_at IS NULL`,
    [staffId]
  );
}

async function revokeSession(sessionId) {
  await query(
    `UPDATE tenant.staff_sessions SET revoked_at = NOW() WHERE id = $1`,
    [sessionId]
  );
}

async function revokeSessionByToken(hashedToken) {
  await query(
    `UPDATE tenant.staff_sessions SET revoked_at = NOW()
     WHERE session_token = $1 AND revoked_at IS NULL`,
    [hashedToken]
  );
}

async function revokeLoginSessions(staffId) {
  await query(
    `UPDATE tenant.staff_sessions SET revoked_at = NOW()
     WHERE staff_id = $1 AND revoked_at IS NULL
       AND device_info->>'type' IS DISTINCT FROM 'password_reset'`,
    [staffId]
  );
}

async function revokePasswordResetSessions(staffId) {
  await query(
    `UPDATE tenant.staff_sessions SET revoked_at = NOW()
     WHERE staff_id = $1 AND device_info->>'type' = 'password_reset' AND revoked_at IS NULL`,
    [staffId]
  );
}

async function createPasswordResetSession(tenantId, staffId, hashedToken, expiresAt) {
  await query(
    `INSERT INTO tenant.staff_sessions (tenant_id, staff_id, session_token, device_info, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, staffId, hashedToken, JSON.stringify({ type: 'password_reset' }), expiresAt]
  );
}

async function findPasswordResetSession(hashedToken) {
  const res = await query(
    `SELECT ss.id, ss.staff_id, ss.tenant_id,
            s.name, s.email
     FROM tenant.staff_sessions ss
     JOIN tenant.staff s ON s.id = ss.staff_id
     WHERE ss.session_token = $1
       AND ss.device_info->>'type' = 'password_reset'
       AND ss.revoked_at IS NULL
       AND ss.expires_at > NOW()
     LIMIT 1`,
    [hashedToken]
  );
  return res.rows[0] || null;
}

module.exports = {
  findTenantBySlug,
  findStaffForLogin,
  createSession,
  touchLastLogin,
  findSessionByToken,
  findStaffById,
  updatePassword,
  revokeAllSessions,
  revokeSession,
  revokeSessionByToken,
  revokeLoginSessions,
  revokePasswordResetSessions,
  createPasswordResetSession,
  findPasswordResetSession,
};
