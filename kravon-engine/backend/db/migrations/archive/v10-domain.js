/**
 * MIGRATION — v10-domain.js
 * Adds the domain column to restaurants for custom domain resolution.
 *
 * V10 tenant middleware can resolve a restaurant from:
 *   1. URL slug parameter (e.g. /v1/restaurants/burgerhouse/...)
 *   2. Custom domain (e.g. Host: burgerhouse.in → domain column)
 *   3. Kravon subdomain (e.g. Host: burgerhouse.kravon.in → parsed slug)
 *
 * Usage: node db/migrations/v10-domain.js
 * Safe to re-run — all statements use IF NOT EXISTS guards.
 */

'use strict';

require('dotenv').config();
const { query } = require('../pool');

const STEPS = [
  // Add domain column — stores the restaurant's custom domain (e.g. "burgerhouse.in")
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS domain VARCHAR(200)`,

  // Unique index — one domain maps to exactly one restaurant
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_domain ON restaurants(domain) WHERE domain IS NOT NULL`,
];

(async () => {
  console.log('Running V10 migration (domain resolution)...\n');
  for (const sql of STEPS) {
    const label = sql.trim().slice(0, 72);
    try {
      await query(sql);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      console.error(`  ✗ ${label}\n    ${err.message}`);
      process.exit(1);
    }
  }
  console.log('\nV10 migration complete.');
  process.exit(0);
})();
