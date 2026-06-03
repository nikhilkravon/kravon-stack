/**
 * MIGRATION — v13-dine-in.js
 * Prepares the public orders table for dine-in session linking.
 *
 * The dining schema (dining.tables, dining.sessions) already exists in the DB.
 * This migration only touches the public schema:
 *   - orders.session_id UUID  → links an order to an open dining session
 *   - orders.deleted_at       → soft-delete support
 *   - drops NOT NULL on customer_name/phone → dine-in QR orders have no customer identity
 *
 * Wrapped in BEGIN/COMMIT. Safe to re-run (IF NOT EXISTS + DROP NOT NULL is idempotent).
 * Usage: node db/migrations/v13-dine-in.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [
  ['Add session_id (UUID) to orders — links public order to dining.sessions',
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES dining.sessions(id)`],

  ['Add deleted_at to orders — soft-delete support',
    `ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`],

  ['Index orders(session_id)',
    `CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id) WHERE session_id IS NOT NULL`],

  ['Allow NULL customer_name — dine-in orders have no customer identity at order time',
    `ALTER TABLE orders ALTER COLUMN customer_name DROP NOT NULL`],

  ['Allow NULL customer_phone',
    `ALTER TABLE orders ALTER COLUMN customer_phone DROP NOT NULL`],
];

(async () => {
  console.log('Running V13 migration (dine-in session linking on public orders)...\n');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [label, sql] of STEPS) {
      await client.query(sql);
      console.log(`  ✓ ${label}`);
    }
    await client.query('COMMIT');
    console.log('\nV13 migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\n  ✗ V13 migration failed: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
})();
