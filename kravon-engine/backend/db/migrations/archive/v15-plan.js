/**
 * MIGRATION — v15-plan.js
 * Migrates tenant.restaurants.plan from the old restaurant_plan enum
 * ('presence'|'orders'|'catering'|'insights'|'full') to the new
 * subscription tier model VARCHAR(20): starter | growth | pro | enterprise.
 *
 * Plan is derived from the existing capability booleans:
 *   has_tables = TRUE            → pro
 *   has_orders = TRUE            → growth
 *   otherwise                    → starter
 *
 * Safe to re-run — each step is guarded by IF NOT EXISTS / DO-blocks.
 * Usage: node db/migrations/v15-plan.js
 */

'use strict';

require('dotenv').config();
const { query } = require('../pool');

const STEPS = [
  // 1. Convert column from restaurant_plan enum to VARCHAR(20).
  //    USING plan::text casts the enum label to its text representation.
  //    This is a no-op if the column is already VARCHAR.
  `DO $$
   BEGIN
     IF (SELECT data_type FROM information_schema.columns
         WHERE table_schema='tenant' AND table_name='restaurants' AND column_name='plan')
        != 'character varying' THEN
       ALTER TABLE tenant.restaurants
         ALTER COLUMN plan TYPE VARCHAR(20) USING plan::text;
     END IF;
   END $$`,

  // 2. Change the default to 'starter' (was 'presence').
  `ALTER TABLE tenant.restaurants
   ALTER COLUMN plan SET DEFAULT 'starter'`,

  // 3. Seed plan from capability booleans — overrides the old enum values.
  `UPDATE tenant.restaurants SET plan = CASE
     WHEN has_tables = TRUE THEN 'pro'
     WHEN has_orders = TRUE THEN 'growth'
     ELSE 'starter'
   END`,

  // 4. Add check constraint for the new tier set (idempotent DO-block).
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
   END $$`,

  // 5. Index for plan-tier queries.
  `CREATE INDEX IF NOT EXISTS idx_restaurants_plan ON tenant.restaurants(plan)`,
];

(async () => {
  console.log('Running V15 migration (plan column: enum → varchar + tier seed)...\n');
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
  process.exit(0);
})();
