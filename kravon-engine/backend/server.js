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
    process.exit(1);
  }
  if (process.env.ENCRYPTION_KEY.length !== 64) {
    console.error('[startup] ENCRYPTION_KEY must be a 64-char hex string (32 bytes).');
    process.exit(1);
  }
  // JWT_SECRET needs at least 32 chars of entropy to resist brute-force.
  if (process.env.JWT_SECRET.length < 32) {
    console.error('[startup] JWT_SECRET must be at least 32 characters.');
    process.exit(1);
  }
  // ADMIN_API_KEY needs at least 32 chars — single-key protection for all admin routes.
  if (process.env.ADMIN_API_KEY.length < 32) {
    console.error('[startup] ADMIN_API_KEY must be at least 32 characters.');
    process.exit(1);
  }
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.warn('[startup] RAZORPAY_WEBHOOK_SECRET is not set — Razorpay webhooks will be rejected at runtime.');
  }
})();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const crypto       = require('crypto');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');

const { corsOptions }       = require('./api/middleware/cors');
const { resolveRestaurant } = require('./api/middleware/tenant');
const { requireFeature }    = require('./api/middleware/feature');
const { errorHandler }      = require('./api/middleware/error');

const configRoutes    = require('./api/routes/config');
const presenceRoutes  = require('./api/routes/presence');
const menuRoutes      = require('./api/routes/menu');
const orderRoutes     = require('./api/routes/orders');
const leadRoutes      = require('./api/routes/leads');
const reviewRoutes    = require('./api/routes/reviews');
const insightRoutes   = require('./api/routes/insights');
const dineInRoutes    = require('./api/routes/dine-in');
const tablesRoutes    = require('./api/routes/tables');
const staffRoutes     = require('./api/routes/staff');
const customersRoutes      = require('./api/routes/customers');
const settingsRoutes       = require('./api/routes/settings');
const notificationsRoutes  = require('./api/routes/notifications');
const auditLogRoutes       = require('./api/routes/audit-log');
const settlementRoutes     = require('./api/routes/settlement');
const webhookRoutes        = require('./api/routes/webhooks');
const adminRoutes     = require('./api/routes/admin');
const authRoutes      = require('./api/routes/auth');
const mediaRoutes     = require('./api/routes/media');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Trust Railway / Heroku / Render proxy ─────────────────────────────────── */
// Railway terminates TLS and forwards requests via a reverse proxy.
// Without this, req.ip is always the proxy IP, breaking rate limiting and
// IP-based features. '1' means trust one hop (the Railway load balancer).
app.set('trust proxy', 1);

/* ── Request ID — attach to every request for log correlation ──────────────── */
app.use((req, _res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  next();
});

/* ── Request logger ────────────────────────────────────────────────────────── */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms  = Date.now() - start;
    const log = {
      level:    'info',
      event:    'request',
      reqId:    req.id,
      tenantId: req.tenant?.tenant_id || null,
      slug:     req.tenant?.slug      || null,
      method:   req.method,
      path:     req.path,
      status:   res.statusCode,
      ms,
    };
    if (process.env.NODE_ENV === 'production') {
      console.log(JSON.stringify(log));
    } else if (res.statusCode >= 400) {
      const tenant = req.tenant?.slug ? ` [${req.tenant.slug}]` : '';
      console.log(`[req] ${req.method} ${req.path}${tenant} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

/* ── Cookie parser ─────────────────────────────────────────────────────────── */
app.use(cookieParser());

/* ── Media proxy — mount BEFORE helmet/cors so no conflicting headers are set ── */
// Images are public. Respond with wildcard CORS and no credentials header.
// helmet and the per-tenant cors() middleware must NOT run for these routes.
app.use('/v1/media', cors({ origin: '*', credentials: false }), mediaRoutes);

/* ── Security headers ──────────────────────────────────────────────────────── */
app.use(helmet());

/* ── CORS — per-restaurant origin whitelist ────────────────────────────────── */
// Must be before rate limiting so OPTIONS preflight requests are answered
// immediately without consuming rate limit budget.
// Chrome Private Network Access — must run BEFORE cors() so the header is
// present on preflight responses (cors() ends the response for OPTIONS).
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' && req.headers['access-control-request-private-network']) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* ── Rate limiting ─────────────────────────────────────────────────────────── */
app.use('/v1', rateLimit({
  windowMs:        60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  // Railway proxies set X-Forwarded-For; trust proxy (set above) makes req.ip correct.
  keyGenerator:    (req) => req.ip,
  message: { error: 'Too many requests. Please slow down.' },
}));

/* ── Body parsing ──────────────────────────────────────────────────────────── */
// Raw body required for Razorpay webhook HMAC signature verification.
// Must be mounted BEFORE express.json() for this path.
app.use('/v1/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '256kb' }));

/* ── Health check ──────────────────────────────────────────────────────────── */
app.get('/health', async (_req, res) => {
  try {
    const { query } = require('./db/pool');
    await query('SELECT 1');
    res.json({ status: 'ok', ts: Date.now() });
  } catch {
    res.status(503).json({ status: 'error', reason: 'db_unreachable', ts: Date.now() });
  }
});

/* ── Public routes (no restaurant context) ─────────────────────────────────── */
app.use('/v1/webhooks', webhookRoutes);
app.use('/v1/admin',    adminRoutes);
app.use('/v1/auth',     authRoutes);

/* ── Restaurant-scoped routes ──────────────────────────────────────────────── */
// Step 1: resolveRestaurant resolves slug/domain/subdomain → req.tenant
// Step 2: requireFeature() enforces product availability
// Step 3: route handler delegates to service layer (no business logic in routes)

// /config — always public, no feature gate (all products boot from here)
app.use('/v1/restaurants/:slug/config',
  resolveRestaurant,
  configRoutes
);

// /presence — Presence content editor (admin GET + PATCH)
app.use('/v1/restaurants/:slug/presence',
  resolveRestaurant,
  presenceRoutes
);

// /menu — public GET, admin-gated writes
app.use('/v1/restaurants/:slug/menu',
  resolveRestaurant,
  menuRoutes
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

// Tables: CRUD for dining.tables (admin dashboard)
app.use('/v1/restaurants/:slug/tables',
  resolveRestaurant,
  requireFeature('has_tables'),
  tablesRoutes
);

// Staff: list + manage restaurant staff members
app.use('/v1/restaurants/:slug/staff',
  resolveRestaurant,
  staffRoutes
);

// Customers: CRM list + order history + governance endpoints
app.use('/v1/restaurants/:slug/customers',
  resolveRestaurant,
  customersRoutes
);

// Settings: tenant data export (owner/admin only)
app.use('/v1/restaurants/:slug/settings',
  resolveRestaurant,
  settingsRoutes
);

// Notifications: in-app bell feed
app.use('/v1/restaurants/:slug/notifications',
  resolveRestaurant,
  notificationsRoutes
);

// Audit log: staff action history
app.use('/v1/restaurants/:slug/audit-log',
  resolveRestaurant,
  requireFeature('has_insights'),
  auditLogRoutes
);

// Settlement engine: financial layer between orders and invoices
app.use('/v1/restaurants/:slug/settlements',
  resolveRestaurant,
  requireFeature('has_tables'),
  settlementRoutes
);

/* ── 404 ───────────────────────────────────────────────────────────────────── */
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

/* ── Global error handler ──────────────────────────────────────────────────── */
app.use(errorHandler);

/* ── Platform event listeners ──────────────────────────────────────────────── */
require('./services/notification.listeners').registerAll();

/* ── Outbox poller — durable event delivery ────────────────────────────────── */
require('./services/outbox.poller').start();

/* ── Intelligence aggregation job ──────────────────────────────────────────── */
require('./jobs/aggregate-daily-metrics').schedule();

/* ── Start ─────────────────────────────────────────────────────────────────── */
const server = app.listen(PORT, () => {
  console.log(`kravon-platform listening on :${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

function shutdown(signal) {
  console.log(JSON.stringify({ level: 'info', event: 'shutdown', signal }));
  // Stop accepting new connections; wait up to 10 s for in-flight requests to drain.
  server.close(() => {
    console.log(JSON.stringify({ level: 'info', event: 'shutdown_complete' }));
    process.exit(0);
  });
  setTimeout(() => {
    console.error(JSON.stringify({ level: 'error', event: 'shutdown_timeout' }));
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
