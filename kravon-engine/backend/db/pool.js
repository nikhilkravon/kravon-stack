/**
 * DB POOL — pool.js
 * Single shared pg connection pool for the entire process.
 * All queries go through this module — nothing imports pg directly.
 */

'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max:            10,
  idleTimeoutMillis:    30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected pg pool error:', err.message);
});

/**
 * query(text, params) → pg QueryResult
 * Thin wrapper so callers never touch pool directly.
 */
async function query(text, params) {
  const start  = Date.now();
  const result = await pool.query(text, params);
  const ms     = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[db] ${ms}ms — ${text.slice(0, 80)}`);
  }
  return result;
}

/**
 * getClient() → pg Client
 * For transactions. Caller must call client.release() in finally.
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient };
