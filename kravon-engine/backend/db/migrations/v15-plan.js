/**
 * MIGRATION — v15-plan.js
 * Adds a plan column to tenant.restaurants to support the Kravon
 * subscription tier model: starter / growth / pro / enterprise.
 *
 * The plan column drives the capabilities block in config.js,
 * replacing the fragmented has_presence/has_orders/has_tables product
 * model with a unified capability-based architecture.
 *
 * Existing tenants default to 'starter'. Update individual rows to
 * reflect their current subscription after running this migration.
 *
 * Safe to re-run — guarded by IF NOT EXISTS.
 * Usage: node db/migrations/v15-plan.js
 */

'use strict';

require('dotenv').config();
const { query } = require('../pool');

const STEPS = [
  // Add plan column — defaults existing rows to 'starter'
  `ALTER TABLE tenant.restaurants
   ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'starter'`,

  // Add check constraint separately so it can be re-run safely
  // (Postgres ignores ADD CONSTRAINT IF NOT EXISTS for check constraints in older versions,
  //  so we wrap in a DO block)
  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'restaurants_plan_check'
         AND conrelid = 'tenant.restaurants'::regclass
     ) THEN
       ALTER TABLE tenant.restaurants
       ADD CONSTRAINT restaurants_plan_check
       CHECK (plan IN ('starter', 'growth', 'pro', 'enterprise'));
     END IF;
   END
   $$`,

  // Index for future queries filtering by plan tier
  `CREATE INDEX IF NOT EXISTS idx_restaurants_plan ON tenant.restaurants(plan)`,
];

(async () => {
  console.log('Running V15 migration (plan column)...\n');
  for (const sql of STEPS) {
    const label = sql.trim().split('\n')[0].slice(0, 80);
    try {
      await query(sql);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      console.error(`  ✗ ${label}`);
      console.error(`    ${err.message}`);
      process.exit(1);
    }
  }
  console.log('\nV15 migration complete.');
  console.log('Remember to UPDATE tenant.restaurants SET plan = \'growth\' WHERE has_orders = TRUE;');
  console.log('         UPDATE tenant.restaurants SET plan = \'pro\'    WHERE has_tables = TRUE;');
  process.exit(0);
})();
