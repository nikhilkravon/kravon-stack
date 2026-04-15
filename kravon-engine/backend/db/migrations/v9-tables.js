/**
 * MIGRATION — v9-tables.js
 * Idempotent ALTER TABLE statements for live databases upgrading from V8 to V9.
 * Safe to re-run. Each statement uses IF NOT EXISTS / IF EXISTS guards.
 *
 * Usage: node db/migrations/v9-tables.js
 */

'use strict';

require('dotenv').config();
const { query } = require('../pool');

const STEPS = [
  // ── restaurants: new columns ─────────────────────────────────────────────
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS has_tables          BOOLEAN DEFAULT FALSE`,
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS review_threshold    SMALLINT DEFAULT 4`,
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS google_review_url   VARCHAR(300)`,
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS webhook_url         VARCHAR(300)`,
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS delivery_fee        INT DEFAULT 4900`,
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS free_delivery_above INT DEFAULT 49900`,

  // ── orders: new columns ──────────────────────────────────────────────────
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_surface     VARCHAR(20)`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS table_identifier  VARCHAR(20)`,
  // delivery_address was NOT NULL — relax constraint for Tables orders
  `ALTER TABLE orders ALTER COLUMN delivery_address DROP NOT NULL`,

  // ── reviews table ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reviews (
    id               SERIAL PRIMARY KEY,
    restaurant_id    INT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    order_id         INT REFERENCES orders(id),
    stars            SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
    feedback         TEXT,
    order_surface    VARCHAR(20),
    table_identifier VARCHAR(20),
    created_at       TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── new indexes ──────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_orders_surface     ON orders(restaurant_id, order_surface)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_table       ON orders(restaurant_id, table_identifier) WHERE table_identifier IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_restaurant ON reviews(restaurant_id, created_at DESC)`,
];

(async () => {
  console.log('Running V9 migration...\n');
  for (const sql of STEPS) {
    const label = sql.trim().split('\n')[0].slice(0, 72);
    try {
      await query(sql);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      console.error(`  ✗ ${label}`);
      console.error(`    ${err.message}`);
      process.exit(1);
    }
  }
  console.log('\nV9 migration complete.');
  process.exit(0);
})();
