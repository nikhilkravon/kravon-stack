/**
 * ROUTE — auth.js
 * POST /v1/auth/login    — email + password + slug → access token + refresh token
 * POST /v1/auth/refresh  — refresh token → new access token
 * POST /v1/auth/logout   — revoke refresh sessions for the authenticated staff member
 *
 * Access token:  JWT, 15 min, carries { staffId, tenantId, slug, roles }
 * Refresh token: random 32-byte hex returned to client, SHA-256 hash stored in
 *                tenant.staff_sessions. Long-lived (30 days).
 *
 * Login is rate-limited to 10 req/min per IP to slow brute-force attempts.
 */

'use strict';

const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const crypto     = require('crypto');
const { z }      = require('zod');
const rateLimit  = require('express-rate-limit');
const { query }  = require('../../db/pool');

const router = express.Router();

const JWT_SECRET      = () => process.env.JWT_SECRET;
const ACCESS_TTL_SEC  = 15 * 60;          // 15 minutes
const REFRESH_TTL_MS  = 30 * 24 * 3600 * 1000; // 30 days

const COOKIE_NAME = 'krv_rt';
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  // 'strict' blocks the cookie on cross-origin requests.
  // In dev the dashboard (port 8000) calls the API (port 3000) cross-origin,
  // so we need 'lax' in dev. In production they share a domain, so 'strict' is safe.
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge:   REFRESH_TTL_MS,
  path:     '/v1/auth',
};

/* ── Tighter rate limit for auth endpoints ─────────────────────────────── */
const authLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many login attempts. Please wait a minute.' },
});

/* ── Helpers ───────────────────────────────────────────────────────────── */
function sha256(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function issueAccessToken(staff, tenantId, slug, roles) {
  return jwt.sign(
    { staffId: staff.id, tenantId, slug, roles },
    JWT_SECRET(),
    { expiresIn: ACCESS_TTL_SEC }
  );
}

async function createSession(tenantId, staffId, deviceInfo = {}) {
  const rawToken     = crypto.randomBytes(32).toString('hex');
  const hashedToken  = sha256(rawToken);
  const expiresAt    = new Date(Date.now() + REFRESH_TTL_MS);

  await query(
    `INSERT INTO tenant.staff_sessions (tenant_id, staff_id, session_token, device_info, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, staffId, hashedToken, JSON.stringify(deviceInfo), expiresAt]
  );

  return rawToken;
}

/* ── Validation schemas ────────────────────────────────────────────────── */
const LoginSchema = z.object({
  slug:     z.string().min(1).max(80),
  email:    z.string().email().max(120),
  password: z.string().min(1).max(200),
});

const RefreshSchema = z.object({
  refreshToken: z.string().length(64), // 32 bytes → 64 hex chars
});

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password:     z.string().min(8).max(200),
});

/* ── POST /v1/auth/login ───────────────────────────────────────────────── */
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { slug, email, password } = parsed.data;

    // Resolve tenant UUID from slug
    const tenantResult = await query(
      'SELECT id FROM tenant.restaurants WHERE slug = $1 LIMIT 1',
      [slug]
    );
    if (!tenantResult.rows.length) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const tenantId = tenantResult.rows[0].id;

    // Load staff — include password_hash and roles
    const staffResult = await query(
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

    const staff = staffResult.rows[0];

    // Constant-time rejection: run bcrypt even when no user found to prevent timing attacks
    const hashToCheck = staff?.password_hash || '$2b$12$invalidhashpaddingtoensureconstanttimexxx';
    const match = staff?.password_hash
      ? await bcrypt.compare(password, hashToCheck)
      : (await bcrypt.compare(password, hashToCheck), false);

    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const roles        = staff.roles || [];
    const accessToken  = issueAccessToken(staff, tenantId, slug, roles);
    const refreshToken = await createSession(tenantId, staff.id, {
      ip:        req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    // Update last_login_at (fire and forget — non-critical)
    query(
      'UPDATE tenant.staff SET last_login_at = NOW() WHERE id = $1',
      [staff.id]
    ).catch(() => {});

    // Refresh token goes in an HttpOnly cookie — not in the JSON body.
    // The JSON body still includes it for backward-compat with any existing clients
    // reading it, but frontend should migrate to cookie-only.
    res.cookie(COOKIE_NAME, refreshToken, COOKIE_OPTS);
    res.json({
      accessToken,
      expiresIn: ACCESS_TTL_SEC,
      staff: { id: staff.id, name: staff.name, email: staff.email, roles },
    });
  } catch (err) { next(err); }
});

/* ── POST /v1/auth/refresh ─────────────────────────────────────────────── */
router.post('/refresh', async (req, res, next) => {
  try {
    // Accept RT from HttpOnly cookie (preferred) or request body (legacy fallback).
    const rawToken = req.cookies?.[COOKIE_NAME] || req.body?.refreshToken;
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length !== 64) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    const hashed = sha256(rawToken);

    const sessionResult = await query(
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
      [hashed]
    );

    if (!sessionResult.rows.length) {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    const row = sessionResult.rows[0];

    if (!row.is_active || row.deleted_at) {
      return res.status(401).json({ error: 'Account is inactive.' });
    }

    const staff = { id: row.staff_id, name: row.name, email: row.email };
    const roles = row.roles || [];
    const accessToken = issueAccessToken(staff, row.tenant_id, row.slug, roles);

    // Re-issue the cookie to refresh its maxAge.
    res.cookie(COOKIE_NAME, rawToken, COOKIE_OPTS);
    res.json({ accessToken, expiresIn: ACCESS_TTL_SEC });
  } catch (err) { next(err); }
});

/* ── POST /v1/auth/change-password ────────────────────────────────────── */
router.post('/change-password', async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });

    let payload;
    try { payload = jwt.verify(token, JWT_SECRET()); }
    catch { return res.status(401).json({ error: 'Invalid or expired token.' }); }

    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { current_password, new_password } = parsed.data;

    const staffRes = await query(
      `SELECT id, password_hash FROM tenant.staff WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [payload.staffId]
    );
    if (!staffRes.rows.length) return res.status(404).json({ error: 'Account not found.' });

    const staff = staffRes.rows[0];
    const match = await bcrypt.compare(current_password, staff.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(new_password, 12);
    await query(
      `UPDATE tenant.staff SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, staff.id]
    );

    // Revoke all other sessions so existing logins are invalidated
    await query(
      `UPDATE tenant.staff_sessions SET revoked_at = NOW()
       WHERE staff_id = $1 AND revoked_at IS NULL`,
      [staff.id]
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── POST /v1/auth/logout ──────────────────────────────────────────────── */
router.post('/logout', async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Unauthorized.' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET());
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    // Revoke all active sessions for this staff member
    await query(
      `UPDATE tenant.staff_sessions
       SET revoked_at = NOW()
       WHERE staff_id = $1 AND revoked_at IS NULL`,
      [payload.staffId]
    );

    res.clearCookie(COOKIE_NAME, { path: '/v1/auth' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
