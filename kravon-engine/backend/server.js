/**
 * KRAVON PLATFORM — server.js
 * Entry point. Mounts middleware and routes, then starts the HTTP server.
 *
 * Architecture:
 *   1. Security headers (helmet)
 *   2. Dynamic CORS (per-restaurant origin whitelist)
 *   3. Rate limiting
 *   4. Body parsing (raw for Razorpay webhook, JSON for everything else)
 *   5. Public routes (no tenant context: health, webhooks, admin)
 *   6. Restaurant-scoped routes:
 *        resolveRestaurant → req.tenant
 *        requireFeature(flag) → 403 if product not enabled
 *        route handler → thin, delegates to service layer
 *
 * Tenant resolution:
 *   All routes under /v1/restaurants/:slug first pass through resolveRestaurant,
 *   which loads the tenant from DB (or cache) and attaches req.tenant.
 *   See api/middleware/tenant.js for resolution logic (slug / domain / subdomain).
 *
 * Feature flags:
 *   Each product route is gated by requireFeature(). If a restaurant hasn't
 *   purchased a product, the API rejects the request before any logic runs.
 *   has_presence is NOT gated — Presence is static and has no API routes.
 *   /config is NOT gated — all products need it to boot.
 */

'use strict';

require('dotenv').config();

/* ── Startup env validation ────────────────────────────────────────────────── */
// Fail fast on boot rather than crashing on the first live request.
// RAZORPAY_WEBHOOK_SECRET is optional at startup (only needed if payments are live).
(function validateEnv() {
  const REQUIRED = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY', 'ADMIN_API_KEY'];
  const missing  = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
    console.error('[startup] Set them in .env or your deployment environment and restart.');
    process.exit(1);
  }
  if (process.env.ENCRYPTION_KEY.length !== 64) {
    console.error('[startup] ENCRYPTION_KEY must be a 64-char hex string (32 bytes).');
    process.exit(1);
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.warn('[startup] RAZORPAY_WEBHOOK_SECRET is not set — Razorpay webhooks will be rejected at runtime.');
  }
})();

const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const { corsOptions }       = require('./api/middleware/cors');
const { resolveRestaurant } = require('./api/middleware/tenant');
const { requireFeature }    = require('./api/middleware/feature');
const { errorHandler }      = require('./api/middleware/error');

const configRoutes  = require('./api/routes/config');
const orderRoutes   = require('./api/routes/orders');
const leadRoutes    = require('./api/routes/leads');
const reviewRoutes  = require('./api/routes/reviews');
const insightRoutes = require('./api/routes/insights');
const dineInRoutes  = require('./api/routes/dine-in');
const webhookRoutes = require('./api/routes/webhooks');
const adminRoutes   = require('./api/routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Security headers ──────────────────────────────────────────────────────── */
app.use(helmet());

/* ── CORS — per-restaurant origin whitelist ────────────────────────────────── */
app.use(cors(corsOptions));

/* ── Rate limiting ─────────────────────────────────────────────────────────── */
app.use('/v1', rateLimit({
  windowMs:        60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests. Please slow down.' },
}));

/* ── Body parsing ──────────────────────────────────────────────────────────── */
// Raw body required for Razorpay webhook HMAC signature verification.
// Must be mounted BEFORE express.json() for this path.
app.use('/v1/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '256kb' }));

/* ── Health check ──────────────────────────────────────────────────────────── */
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

/* ── Public routes (no restaurant context) ─────────────────────────────────── */
app.use('/v1/webhooks', webhookRoutes);
app.use('/v1/admin',    adminRoutes);

/* ── Restaurant-scoped routes ──────────────────────────────────────────────── */
// Step 1: resolveRestaurant resolves slug/domain/subdomain → req.tenant
// Step 2: requireFeature() enforces product availability
// Step 3: route handler delegates to service layer (no business logic in routes)

// /config — always public, no feature gate (all products boot from here)
app.use('/v1/restaurants/:slug/config',
  resolveRestaurant,
  configRoutes
);

// /menu — for item details, public
app.use('/v1/restaurants/:slug/menu',
  resolveRestaurant,
  configRoutes
);

// Tables: reviews only (orders shared with delivery via discriminated union)
app.use('/v1/restaurants/:slug/reviews',
  resolveRestaurant,
  requireFeature('has_tables'),
  reviewRoutes
);

// Orders + Tables share one endpoint — discriminated by order_surface in body
app.use('/v1/restaurants/:slug/orders',
  resolveRestaurant,
  requireFeature('has_orders'),
  orderRoutes
);

// Catering leads
app.use('/v1/restaurants/:slug/leads',
  resolveRestaurant,
  requireFeature('has_catering'),
  leadRoutes
);

// Insights dashboard (admin JWT required inside route)
app.use('/v1/restaurants/:slug/insights',
  resolveRestaurant,
  requireFeature('has_insights'),
  insightRoutes
);

// Dine-in: session management, QR ordering, kitchen view, bill
// has_tables gates the module; /session/status and /order are public inside the router
app.use('/v1/restaurants/:slug/dine-in',
  resolveRestaurant,
  requireFeature('has_tables'),
  dineInRoutes
);

/* ── 404 ───────────────────────────────────────────────────────────────────── */
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

/* ── Global error handler ──────────────────────────────────────────────────── */
app.use(errorHandler);

/* ── Start ─────────────────────────────────────────────────────────────────── */
app.listen(PORT, () => {
  console.log(`kravon-platform listening on :${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = app;
