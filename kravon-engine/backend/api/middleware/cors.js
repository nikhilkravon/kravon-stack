/**
 * MIDDLEWARE — cors.js
 * Dynamic CORS policy. Allowed origins are derived from tenant custom domains
 * stored in tenant.restaurants.settings->>'domain' (v12 canonical schema).
 * Cache refreshed every 5 minutes.
 */

'use strict';

const { query } = require('../../db/pool');

let _originCache  = null;
let _cacheBuiltAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getAllowedOrigins() {
  if (_originCache && Date.now() - _cacheBuiltAt < CACHE_TTL_MS) {
    return _originCache;
  }
  const res = await query(
    `SELECT settings->>'domain' AS domain
     FROM tenant.restaurants
     WHERE settings->>'domain' IS NOT NULL
       AND deleted_at IS NULL`
  );
  const set = new Set();
  for (const row of res.rows) {
    if (row.domain) {
      set.add(`https://${row.domain}`);
      set.add(`http://${row.domain}`);
    }
  }
  // Always allow local development
  set.add('http://localhost:3000');
  set.add('http://localhost:5173');
  _originCache  = set;
  _cacheBuiltAt = Date.now();
  return set;
}

const KRAVON_DOMAIN  = (process.env.KRAVON_DOMAIN || 'kravon.in').toLowerCase();
// Matches any subdomain of kravon.in: https://spice-of-india.kravon.in
// Use global replace so multi-dot domains (e.g. kravon.co.in) escape correctly.
const KRAVON_SUBDOMAIN_RE = new RegExp(`^https?://[a-z0-9-]+\\.${KRAVON_DOMAIN.replace(/\./g, '\\.')}$`);

// Extra origins allowed via env var — comma-separated, e.g. Railway preview URLs
const EXTRA_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
);

const corsOptions = {
  origin: async (origin, callback) => {
    if (!origin) return callback(null, true);
    // Allow all kravon.in subdomains (restaurant frontends + dashboard).
    if (KRAVON_SUBDOMAIN_RE.test(origin)) return callback(null, true);
    // Allow explicitly whitelisted origins (e.g. Railway deployment URLs).
    if (EXTRA_ORIGINS.has(origin)) return callback(null, true);
    // Allow localhost in development.
    if (/^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    try {
      const allowed = await getAllowedOrigins();
      if (allowed.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    } catch (err) {
      callback(err);
    }
  },
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Idempotency-Key'],
  exposedHeaders: ['X-Request-ID'],
  credentials:    true,
};

module.exports = { corsOptions };
