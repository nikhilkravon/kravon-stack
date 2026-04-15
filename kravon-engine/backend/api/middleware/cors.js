/**
 * MIDDLEWARE — cors.js
 * Dynamic CORS policy. Each restaurant registers an allowed_origin
 * in the DB. The middleware loads the origin list once and caches it.
 * Only registered origins receive CORS headers.
 */

'use strict';

const { query } = require('../../db/pool');

// Cache origin → restaurant_id mapping, refreshed every 5 minutes
let _originCache  = null;
let _cacheBuiltAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getAllowedOrigins() {
  if (_originCache && Date.now() - _cacheBuiltAt < CACHE_TTL_MS) {
    return _originCache;
  }
  const res  = await query('SELECT allowed_origin FROM restaurants WHERE allowed_origin IS NOT NULL');
  const set  = new Set(res.rows.map(r => r.allowed_origin).filter(Boolean));
  // Always allow local development
  set.add('http://localhost:3000');
  set.add('http://localhost:5173');
  _originCache  = set;
  _cacheBuiltAt = Date.now();
  return set;
}

const corsOptions = {
  origin: async (origin, callback) => {
    // Non-browser requests (curl, server-to-server, health checks) have no origin
    if (!origin) return callback(null, true);
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
  methods:     ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

module.exports = { corsOptions };
