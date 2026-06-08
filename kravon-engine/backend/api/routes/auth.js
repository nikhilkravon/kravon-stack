/**
 * ROUTE — auth.js
 * POST /v1/auth/login           — email + password + slug → access token + refresh token
 * POST /v1/auth/refresh         — refresh token → new access token
 * POST /v1/auth/logout          — revoke refresh sessions for the authenticated staff member
 * POST /v1/auth/change-password — change own password (access token required)
 * POST /v1/auth/forgot-password — initiate password reset (always 200)
 * POST /v1/auth/reset-password  — consume reset token and set new password
 *
 * Access token:  JWT, 15 min, carries { staffId, tenantId, slug, roles }
 * Refresh token: random 32-byte hex returned to client, SHA-256 hash stored in
 *                tenant.staff_sessions. Long-lived (30 days).
 */

'use strict';

const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const { z }     = require('zod');
const rateLimit = require('express-rate-limit');
const authRepo  = require('../../domains/identity/auth-repository');
const email     = require('../../utils/email');

const router = express.Router();

const JWT_SECRET      = () => process.env.JWT_SECRET;
const ACCESS_TTL_SEC  = 15 * 60;
const REFRESH_TTL_MS  = 30 * 24 * 3600 * 1000;

const COOKIE_NAME = 'krv_rt';
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge:   REFRESH_TTL_MS,
  path:     '/v1/auth',
};

const authLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many login attempts. Please wait a minute.' },
});

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

/* ── Validation schemas ─────────────────────────────────────────────────── */
const LoginSchema = z.object({
  slug:     z.string().min(1).max(80),
  email:    z.string().email().max(120),
  password: z.string().min(1).max(200),
});

const ChangePasswordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password:     z.string().min(8).max(200),
});

const ForgotSchema = z.object({
  slug:  z.string().min(1).max(80),
  email: z.string().email().max(120),
});

const ResetSchema = z.object({
  token:        z.string().length(64),
  new_password: z.string().min(8).max(200),
});

/* ── POST /v1/auth/login ────────────────────────────────────────────────── */
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { slug, email: staffEmail, password } = parsed.data;

    const tenant = await authRepo.findTenantBySlug(slug);
    if (!tenant) return res.status(401).json({ error: 'Invalid credentials.' });

    const staff = await authRepo.findStaffForLogin(tenant.id, staffEmail);

    // Constant-time rejection: run bcrypt even when no user found
    const hashToCheck = staff?.password_hash || '$2b$12$invalidhashpaddingtoensureconstanttimexxx';
    const match = staff?.password_hash
      ? await bcrypt.compare(password, hashToCheck)
      : (await bcrypt.compare(password, hashToCheck), false);

    if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

    const roles       = staff.roles || [];
    const accessToken = issueAccessToken(staff, tenant.id, slug, roles);

    const rawToken    = crypto.randomBytes(32).toString('hex');
    const hashedToken = sha256(rawToken);
    const expiresAt   = new Date(Date.now() + REFRESH_TTL_MS);
    await authRepo.createSession(tenant.id, staff.id, hashedToken, {
      ip: req.ip, userAgent: req.headers['user-agent'] || null,
    }, expiresAt);

    authRepo.touchLastLogin(staff.id);

    res.cookie(COOKIE_NAME, rawToken, COOKIE_OPTS);
    res.json({
      accessToken,
      expiresIn: ACCESS_TTL_SEC,
      staff: { id: staff.id, name: staff.name, email: staff.email, roles },
    });
  } catch (err) { next(err); }
});

/* ── POST /v1/auth/refresh ──────────────────────────────────────────────── */
router.post('/refresh', async (req, res, next) => {
  try {
    const rawToken = req.cookies?.[COOKIE_NAME] || req.body?.refreshToken;
    if (!rawToken || typeof rawToken !== 'string' || rawToken.length !== 64) {
      return res.status(400).json({ error: 'Invalid request.' });
    }

    const session = await authRepo.findSessionByToken(sha256(rawToken));
    if (!session) return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    if (!session.is_active || session.deleted_at) {
      return res.status(401).json({ error: 'Account is inactive.' });
    }

    const staff       = { id: session.staff_id, name: session.name, email: session.email };
    const roles       = session.roles || [];
    const accessToken = issueAccessToken(staff, session.tenant_id, session.slug, roles);

    res.cookie(COOKIE_NAME, rawToken, COOKIE_OPTS);
    res.json({ accessToken, expiresIn: ACCESS_TTL_SEC });
  } catch (err) { next(err); }
});

/* ── POST /v1/auth/change-password ─────────────────────────────────────── */
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
    const staff = await authRepo.findStaffById(payload.staffId);
    if (!staff) return res.status(404).json({ error: 'Account not found.' });

    const match = await bcrypt.compare(current_password, staff.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    await authRepo.updatePassword(staff.id, await bcrypt.hash(new_password, 12));
    await authRepo.revokeAllSessions(staff.id);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── POST /v1/auth/forgot-password ─────────────────────────────────────── */
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const parsed = ForgotSchema.safeParse(req.body);
    if (!parsed.success) return res.json({ ok: true });

    const { slug, email: staffEmail } = parsed.data;

    const tenant = await authRepo.findTenantBySlug(slug);
    if (!tenant) return res.json({ ok: true });

    const staffRes = await authRepo.findStaffForLogin(tenant.id, staffEmail);
    if (!staffRes) return res.json({ ok: true });

    const rawToken    = crypto.randomBytes(32).toString('hex');
    const hashedToken = sha256(rawToken);
    const expiresAt   = new Date(Date.now() + 60 * 60 * 1000);

    await authRepo.revokePasswordResetSessions(staffRes.id);
    await authRepo.createPasswordResetSession(tenant.id, staffRes.id, hashedToken, expiresAt);

    email.sendPasswordReset({
      to:    staffRes.email,
      name:  staffRes.name,
      token: rawToken,
      slug,
    }).catch(err => {
      console.error(JSON.stringify({ level: 'error', event: 'password_reset.email_failed',
        staffId: staffRes.id, message: err.message }));
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── POST /v1/auth/reset-password ──────────────────────────────────────── */
router.post('/reset-password', authLimiter, async (req, res, next) => {
  try {
    const parsed = ResetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request.', details: parsed.error.flatten() });
    }

    const { token, new_password } = parsed.data;
    const session = await authRepo.findPasswordResetSession(sha256(token));
    if (!session) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
    }

    await authRepo.updatePassword(session.staff_id, await bcrypt.hash(new_password, 12));
    await authRepo.revokeSession(session.id);
    await authRepo.revokeLoginSessions(session.staff_id);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── POST /v1/auth/logout ───────────────────────────────────────────────── */
// Revokes only the specific refresh token used — or all sessions if logoutAll=true.
router.post('/logout', async (req, res, next) => {
  try {
    const rawToken   = req.cookies?.[COOKIE_NAME] || req.body?.refreshToken;
    const logoutAll  = req.body?.logoutAll === true;

    if (rawToken && typeof rawToken === 'string' && rawToken.length === 64) {
      if (logoutAll) {
        // Verify the refresh token belongs to a real session before revoking all
        const session = await authRepo.findSessionByToken(sha256(rawToken));
        if (session) await authRepo.revokeAllSessions(session.staff_id);
      } else {
        await authRepo.revokeSessionByToken(sha256(rawToken));
      }
    }

    res.clearCookie(COOKIE_NAME, { path: '/v1/auth' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
