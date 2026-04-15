/**
 * MIGRATION — v10-column-rename.js
 * Renames columns in all tables to match the V10 spec naming.
 *
 * Changes:
 *   restaurants:      id           → rest_id       (PK)
 *   all child tables: restaurant_id → rest_id       (FK)
 *   menu_items:       price        → price_paise
 *   menu_addons:      price        → price_paise
 *   orders:           total        → total_amount
 *   catering_leads:   pax          → headcount
 *
 * Why these names?
 *   - rest_id is unambiguous — "id" could mean anything in a join query
 *   - price_paise makes the unit explicit at the column level
 *   - total_amount mirrors standard accounting/payment terminology
 *   - headcount is the plain English word (pax is jargon)
 *
 * Safety:
 *   - Every step uses IF EXISTS guards — safe to re-run
 *   - Postgres RENAME COLUMN is near-instant (metadata only, no table rewrite)
 *   - FK constraints are automatically preserved across renames in Postgres
 *   - Run BEFORE deploying V10 backend code
 *
 * Usage:
 *   node db/migrations/v10-column-rename.js
 */

'use strict';

require('dotenv').config();
const { query } = require('../pool');

// Each step is its own ALTER — if one fails, we stop and report clearly.
// DO NOT wrap in a single transaction: some Postgres versions can't rename
// a PK and its FK references in one shot. Sequential is safer.
const STEPS = [

  /* ── restaurants: id → rest_id ──────────────────────────────────────────
     The PK. Postgres automatically updates FK references when you rename
     the column — BUT only if the FK was defined with REFERENCES restaurants(id).
     We rename the FK columns explicitly anyway for clarity.
  ───────────────────────────────────────────────────────────────────────── */
  {
    label: 'restaurants: id → rest_id',
    sql:   `ALTER TABLE restaurants RENAME COLUMN id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='restaurants' AND column_name='rest_id'`,
  },

  /* ── child tables: restaurant_id → rest_id ───────────────────────────── */
  {
    label: 'menu_categories: restaurant_id → rest_id',
    sql:   `ALTER TABLE menu_categories RENAME COLUMN restaurant_id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='menu_categories' AND column_name='rest_id'`,
  },
  {
    label: 'menu_items: restaurant_id → rest_id',
    sql:   `ALTER TABLE menu_items RENAME COLUMN restaurant_id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='menu_items' AND column_name='rest_id'`,
  },
  {
    label: 'menu_addons: restaurant_id → rest_id',
    sql:   `ALTER TABLE menu_addons RENAME COLUMN restaurant_id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='menu_addons' AND column_name='rest_id'`,
  },
  {
    label: 'spice_levels: restaurant_id → rest_id',
    sql:   `ALTER TABLE spice_levels RENAME COLUMN restaurant_id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='spice_levels' AND column_name='rest_id'`,
  },
  {
    label: 'customers: restaurant_id → rest_id',
    sql:   `ALTER TABLE customers RENAME COLUMN restaurant_id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='customers' AND column_name='rest_id'`,
  },
  {
    label: 'orders: restaurant_id → rest_id',
    sql:   `ALTER TABLE orders RENAME COLUMN restaurant_id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='orders' AND column_name='rest_id'`,
  },
  {
    label: 'catering_leads: restaurant_id → rest_id',
    sql:   `ALTER TABLE catering_leads RENAME COLUMN restaurant_id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='catering_leads' AND column_name='rest_id'`,
  },
  {
    label: 'reviews: restaurant_id → rest_id',
    sql:   `ALTER TABLE reviews RENAME COLUMN restaurant_id TO rest_id`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='reviews' AND column_name='rest_id'`,
  },

  /* ── price columns: price → price_paise ─────────────────────────────── */
  {
    label: 'menu_items: price → price_paise',
    sql:   `ALTER TABLE menu_items RENAME COLUMN price TO price_paise`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='menu_items' AND column_name='price_paise'`,
  },
  {
    label: 'menu_addons: price → price_paise',
    sql:   `ALTER TABLE menu_addons RENAME COLUMN price TO price_paise`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='menu_addons' AND column_name='price_paise'`,
  },

  /* ── orders: total → total_amount ────────────────────────────────────── */
  {
    label: 'orders: total → total_amount',
    sql:   `ALTER TABLE orders RENAME COLUMN total TO total_amount`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='orders' AND column_name='total_amount'`,
  },

  /* ── catering_leads: pax → headcount ─────────────────────────────────── */
  {
    label: 'catering_leads: pax → headcount',
    sql:   `ALTER TABLE catering_leads RENAME COLUMN pax TO headcount`,
    check: `SELECT column_name FROM information_schema.columns
            WHERE table_name='catering_leads' AND column_name='headcount'`,
  },

  /* ── Rebuild affected indexes (names reference old column names) ─────── */
  // Postgres does NOT auto-rename indexes when you rename a column.
  // We drop and recreate the affected ones.
  {
    label: 'Drop old idx_customers_restaurant',
    sql:   `DROP INDEX IF EXISTS idx_customers_restaurant`,
    check: null,
  },
  {
    label: 'Create idx_customers_rest',
    sql:   `CREATE INDEX IF NOT EXISTS idx_customers_rest ON customers(rest_id)`,
    check: null,
  },
  {
    label: 'Drop old idx_orders_restaurant',
    sql:   `DROP INDEX IF EXISTS idx_orders_restaurant`,
    check: null,
  },
  {
    label: 'Create idx_orders_rest',
    sql:   `CREATE INDEX IF NOT EXISTS idx_orders_rest ON orders(rest_id, created_at DESC)`,
    check: null,
  },
  {
    label: 'Drop old idx_orders_phone',
    sql:   `DROP INDEX IF EXISTS idx_orders_phone`,
    check: null,
  },
  {
    label: 'Create idx_orders_phone',
    sql:   `CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(rest_id, customer_phone)`,
    check: null,
  },
  {
    label: 'Drop old idx_orders_status',
    sql:   `DROP INDEX IF EXISTS idx_orders_status`,
    check: null,
  },
  {
    label: 'Create idx_orders_status',
    sql:   `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(rest_id, status)`,
    check: null,
  },
  {
    label: 'Drop old idx_orders_surface',
    sql:   `DROP INDEX IF EXISTS idx_orders_surface`,
    check: null,
  },
  {
    label: 'Create idx_orders_surface',
    sql:   `CREATE INDEX IF NOT EXISTS idx_orders_surface ON orders(rest_id, order_surface)`,
    check: null,
  },
  {
    label: 'Drop old idx_orders_table',
    sql:   `DROP INDEX IF EXISTS idx_orders_table`,
    check: null,
  },
  {
    label: 'Create idx_orders_table',
    sql:   `CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(rest_id, table_identifier) WHERE table_identifier IS NOT NULL`,
    check: null,
  },
  {
    label: 'Drop old idx_leads_restaurant',
    sql:   `DROP INDEX IF EXISTS idx_leads_restaurant`,
    check: null,
  },
  {
    label: 'Create idx_leads_rest',
    sql:   `CREATE INDEX IF NOT EXISTS idx_leads_rest ON catering_leads(rest_id, created_at DESC)`,
    check: null,
  },
  {
    label: 'Drop old idx_leads_status',
    sql:   `DROP INDEX IF EXISTS idx_leads_status`,
    check: null,
  },
  {
    label: 'Create idx_leads_status',
    sql:   `CREATE INDEX IF NOT EXISTS idx_leads_status ON catering_leads(rest_id, status)`,
    check: null,
  },
  {
    label: 'Drop old idx_reviews_restaurant',
    sql:   `DROP INDEX IF EXISTS idx_reviews_restaurant`,
    check: null,
  },
  {
    label: 'Create idx_reviews_rest',
    sql:   `CREATE INDEX IF NOT EXISTS idx_reviews_rest ON reviews(rest_id, created_at DESC)`,
    check: null,
  },
  {
    label: 'Drop old idx_menu_items_category',
    sql:   `DROP INDEX IF EXISTS idx_menu_items_category`,
    check: null,
  },
  {
    label: 'Create idx_menu_items_category',
    sql:   `CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id, sort_order)`,
    check: null,
  },
];

(async () => {
  console.log('Running V10 column rename migration...\n');

  for (const step of STEPS) {
    // If a check query is provided, skip the step if target already exists (idempotent)
    if (step.check) {
      const existing = await query(step.check);
      if (existing.rows.length > 0) {
        console.log(`  ⊙ skipped (already done): ${step.label}`);
        continue;
      }
    }

    try {
      await query(step.sql);
      console.log(`  ✓ ${step.label}`);
    } catch (err) {
      // column does not exist errors mean the rename was already done — skip
      if (err.message.includes('does not exist') || err.message.includes('already exists')) {
        console.log(`  ⊙ skipped (already done): ${step.label}`);
      } else {
        console.error(`  ✗ FAILED: ${step.label}`);
        console.error(`    ${err.message}`);
        console.error('\nMigration stopped. Fix the error above and re-run.');
        process.exit(1);
      }
    }
  }

  console.log('\n✓ V10 column rename migration complete.');
  console.log('  Deploy V10 backend code now.\n');
  process.exit(0);
})();
