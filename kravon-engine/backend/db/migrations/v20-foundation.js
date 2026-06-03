/**
 * MIGRATION — v20-foundation.js
 * KRAVON Foundation Consolidation — V20 production upgrade.
 *
 * This migration brings any existing production database (at v13–v19 state) to
 * full parity with kravon_schema_v20.sql. It is safe to run against a database
 * that is already at v19 or partially at v20.
 *
 * What this does:
 *   1. Add tenant.staff.password_hash if missing (v14)
 *   2. Add brand.announcements.image_url if missing (v16)
 *   3. Convert tenant.restaurants.plan from ENUM to VARCHAR(20) if still an enum (v15)
 *   4. Add restaurants_plan_check constraint if missing (v15)
 *   5. Add idx_restaurants_plan if missing (v15)
 *   6. Add Razorpay idempotency indexes if missing (v17)
 *   7. Create governance tables if missing (v18)
 *   8. Create notifications schema and tables if missing (v19)
 *   9. Create tenant.notification_preferences if missing (v19)
 *  10. Create platform.schema_migrations tracking table (v20 NEW)
 *  11. Seed migration records v1–v20 (ON CONFLICT DO NOTHING)
 *
 * Safety guarantees:
 *   - All DDL is wrapped in a single transaction — any failure rolls back completely
 *   - Every step is idempotent (IF NOT EXISTS / DO-blocks with existence checks)
 *   - Nothing is dropped — this migration is purely additive
 *   - Safe to re-run
 *
 * Usage: node db/migrations/v20-foundation.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [

  // ── 1. tenant.staff.password_hash ──────────────────────────────────────────
  ['[v14] Add password_hash to tenant.staff if missing',
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'tenant'
           AND table_name   = 'staff'
           AND column_name  = 'password_hash'
       ) THEN
         ALTER TABLE tenant.staff ADD COLUMN password_hash TEXT;
       END IF;
     END $$`],

  // ── 2. brand.announcements.image_url ───────────────────────────────────────
  ['[v16] Add image_url to brand.announcements if missing',
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'brand'
           AND table_name   = 'announcements'
           AND column_name  = 'image_url'
       ) THEN
         ALTER TABLE brand.announcements ADD COLUMN image_url TEXT;
       END IF;
     END $$`],

  // ── 3. Convert plan column from ENUM to VARCHAR(20) ────────────────────────
  ['[v15] Convert tenant.restaurants.plan from ENUM to VARCHAR(20) if needed',
    `DO $$
     BEGIN
       IF (
         SELECT data_type
         FROM information_schema.columns
         WHERE table_schema = 'tenant'
           AND table_name   = 'restaurants'
           AND column_name  = 'plan'
       ) != 'character varying' THEN
         ALTER TABLE tenant.restaurants
           ALTER COLUMN plan TYPE VARCHAR(20) USING plan::text;
       END IF;
     END $$`],

  ['[v15] Set plan column default to starter',
    `ALTER TABLE tenant.restaurants
     ALTER COLUMN plan SET DEFAULT 'starter'`],

  ['[v15] Seed plan values from capability booleans for any old enum values',
    `UPDATE tenant.restaurants
     SET plan = CASE
       WHEN has_tables = TRUE THEN 'pro'
       WHEN has_orders = TRUE THEN 'growth'
       ELSE 'starter'
     END
     WHERE plan NOT IN ('starter', 'growth', 'pro', 'enterprise')`],

  // ── 4. Plan CHECK constraint ────────────────────────────────────────────────
  ['[v15] Add restaurants_plan_check constraint if missing',
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
     END $$`],

  // ── 5. Plan index ───────────────────────────────────────────────────────────
  ['[v15] Add idx_restaurants_plan if missing',
    `CREATE INDEX IF NOT EXISTS idx_restaurants_plan
     ON tenant.restaurants(plan)`],

  // ── 6. Razorpay idempotency indexes ────────────────────────────────────────
  ['[v17] Add Razorpay order_id unique index if missing',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_order_id
     ON orders.orders ((metadata->>\'razorpay_order_id\'))
     WHERE metadata->>\'razorpay_order_id\' IS NOT NULL`],

  ['[v17] Add Razorpay payment_id index if missing',
    `CREATE INDEX IF NOT EXISTS idx_orders_razorpay_payment_id
     ON orders.orders ((metadata->>\'razorpay_payment_id\'))
     WHERE metadata->>\'razorpay_payment_id\' IS NOT NULL`],

  // ── 7. Governance tables (v18) ──────────────────────────────────────────────
  ['[v18] Create customer.consent_history if missing',
    `CREATE TABLE IF NOT EXISTS customer.consent_history (
       id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       customer_id  UUID        NOT NULL REFERENCES customer.customers(id),
       tenant_id    UUID        NOT NULL REFERENCES tenant.restaurants(id),
       consent_type TEXT        NOT NULL,
       granted      BOOLEAN     NOT NULL,
       source       TEXT        NOT NULL,
       ip_address   TEXT,
       user_agent   TEXT,
       created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['[v18] Add idx_consent_history_customer if missing',
    `CREATE INDEX IF NOT EXISTS idx_consent_history_customer
     ON customer.consent_history(customer_id, created_at DESC)`],

  ['[v18] Add idx_consent_history_tenant if missing',
    `CREATE INDEX IF NOT EXISTS idx_consent_history_tenant
     ON customer.consent_history(tenant_id, created_at DESC)`],

  ['[v18] Create platform.export_jobs if missing',
    `CREATE TABLE IF NOT EXISTS platform.export_jobs (
       id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id    UUID        NOT NULL REFERENCES tenant.restaurants(id),
       export_type  TEXT        NOT NULL DEFAULT 'full',
       status       TEXT        NOT NULL DEFAULT 'pending',
       storage_path TEXT,
       requested_by UUID,
       requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       completed_at TIMESTAMPTZ
     )`],

  ['[v18] Add idx_export_jobs_tenant if missing',
    `CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant
     ON platform.export_jobs(tenant_id, requested_at DESC)`],

  ['[v18] Create platform.customer_data_requests if missing',
    `CREATE TABLE IF NOT EXISTS platform.customer_data_requests (
       id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       customer_id   UUID        NOT NULL REFERENCES customer.customers(id),
       tenant_id     UUID        NOT NULL REFERENCES tenant.restaurants(id),
       request_type  TEXT        NOT NULL,
       status        TEXT        NOT NULL DEFAULT 'pending',
       requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       completed_at  TIMESTAMPTZ
     )`],

  ['[v18] Add idx_cdr_customer if missing',
    `CREATE INDEX IF NOT EXISTS idx_cdr_customer
     ON platform.customer_data_requests(customer_id, requested_at DESC)`],

  ['[v18] Add idx_cdr_tenant if missing',
    `CREATE INDEX IF NOT EXISTS idx_cdr_tenant
     ON platform.customer_data_requests(tenant_id, requested_at DESC)`],

  ['[v18] Create platform.benchmarks if missing',
    `CREATE TABLE IF NOT EXISTS platform.benchmarks (
       id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       metric_name  TEXT        NOT NULL,
       dimension    TEXT        NOT NULL,
       value        NUMERIC     NOT NULL,
       sample_count INTEGER     NOT NULL,
       period_start DATE        NOT NULL,
       period_end   DATE        NOT NULL,
       computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['[v18] Add idx_benchmarks_metric if missing',
    `CREATE INDEX IF NOT EXISTS idx_benchmarks_metric
     ON platform.benchmarks(metric_name, dimension, period_end DESC)`],

  // ── 8. Notifications schema and table (v19) ─────────────────────────────────
  ['[v19] Create notifications schema if missing',
    `CREATE SCHEMA IF NOT EXISTS notifications`],

  ['[v19] Create notifications.notifications table if missing',
    `CREATE TABLE IF NOT EXISTS notifications.notifications (
       id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id   UUID        NOT NULL REFERENCES tenant.restaurants(id),
       type        TEXT        NOT NULL,
       priority    TEXT        NOT NULL DEFAULT 'INFO',
       title       TEXT        NOT NULL,
       body        TEXT,
       entity_type TEXT,
       entity_id   UUID,
       actor_type  TEXT,
       actor_id    UUID,
       metadata    JSONB       NOT NULL DEFAULT '{}',
       read_at     TIMESTAMPTZ,
       expires_at  TIMESTAMPTZ,
       created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['[v19] Add idx_notifications_tenant_unread if missing',
    `CREATE INDEX IF NOT EXISTS idx_notifications_tenant_unread
     ON notifications.notifications(tenant_id, created_at DESC)
     WHERE read_at IS NULL`],

  ['[v19] Add idx_notifications_tenant if missing',
    `CREATE INDEX IF NOT EXISTS idx_notifications_tenant
     ON notifications.notifications(tenant_id, created_at DESC)`],

  ['[v19] Add idx_notifications_expires if missing',
    `CREATE INDEX IF NOT EXISTS idx_notifications_expires
     ON notifications.notifications(expires_at)
     WHERE expires_at IS NOT NULL`],

  // ── 9. tenant.notification_preferences (v19) ───────────────────────────────
  ['[v19] Create tenant.notification_preferences if missing',
    `CREATE TABLE IF NOT EXISTS tenant.notification_preferences (
       id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id   UUID        NOT NULL UNIQUE REFERENCES tenant.restaurants(id),
       preferences JSONB       NOT NULL DEFAULT '{}',
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  // ── 10. platform.schema_migrations tracking table (v20 NEW) ─────────────────
  ['[v20] Create platform.schema_migrations tracking table',
    `CREATE TABLE IF NOT EXISTS platform.schema_migrations (
       id         SERIAL      PRIMARY KEY,
       version    TEXT        NOT NULL UNIQUE,
       name       TEXT        NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['[v20] Add index on schema_migrations.version',
    `CREATE INDEX IF NOT EXISTS idx_schema_migrations_version
     ON platform.schema_migrations(version)`],

];

// Migration seed records — inserted after the main transaction commits
// so that schema_migrations itself is guaranteed to exist first.
const MIGRATION_RECORDS = [
  ['v1',  'initial-schema'],
  ['v2',  'core-tables'],
  ['v3',  'brand-schema'],
  ['v4',  'menu-schema'],
  ['v5',  'customer-schema'],
  ['v6',  'orders-schema'],
  ['v7',  'payments-schema'],
  ['v8',  'platform-schema'],
  ['v9',  'tables-reviews-delivery'],
  ['v10', 'column-renames-domain'],
  ['v11', 'schema-unification'],
  ['v12', 'canonical-consolidation'],
  ['v13', 'dine-in-session-link'],
  ['v14', 'staff-password-hash'],
  ['v15', 'plan-varchar-tiers'],
  ['v16', 'presence-content-brand'],
  ['v17', 'razorpay-idempotency'],
  ['v18', 'governance-dpdp'],
  ['v19', 'notifications-schema'],
  ['v20', 'foundation-consolidation'],
];

(async () => {
  console.log('Running V20 migration (Foundation Consolidation)...\n');

  const client = await getClient();

  try {
    await client.query('BEGIN');

    for (const [label, sql] of STEPS) {
      try {
        await client.query(sql);
        console.log(`  ✓ ${label}`);
      } catch (err) {
        console.error(`  ✗ ${label}`);
        console.error(`    ${err.message}`);
        throw err;
      }
    }

    await client.query('COMMIT');
    console.log('\n  ✓ All DDL steps committed.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nV20 migration FAILED — rolled back completely.');
    console.error(err.message);
    client.release();
    process.exit(1);
  }

  // Seed migration records outside the main transaction so schema_migrations
  // is guaranteed to exist. Each insert is idempotent via ON CONFLICT DO NOTHING.
  try {
    console.log('  Seeding schema_migrations records...');
    for (const [version, name] of MIGRATION_RECORDS) {
      await client.query(
        `INSERT INTO platform.schema_migrations (version, name)
         VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING`,
        [version, name]
      );
    }
    console.log(`  ✓ schema_migrations seeded (${MIGRATION_RECORDS.length} records, duplicates skipped).`);
  } catch (err) {
    console.error('  ✗ Failed to seed schema_migrations:', err.message);
    client.release();
    process.exit(1);
  }

  client.release();

  // Post-migration validation queries
  console.log('\n  Running post-migration validation...');
  const { getClient: gc } = require('../pool');
  const vc = await gc();
  try {
    const { rows: migRows } = await vc.query(
      'SELECT COUNT(*) AS cnt FROM platform.schema_migrations'
    );
    console.log(`  ✓ schema_migrations: ${migRows[0].cnt} records`);

    const { rows: schemaRows } = await vc.query(`
      SELECT COUNT(*) AS cnt FROM information_schema.schemata
      WHERE schema_name IN (
        'tenant','brand','menu','customer','orders','payments',
        'dining','catering','insights','platform','inventory','notifications'
      )
    `);
    console.log(`  ✓ schemas present: ${schemaRows[0].cnt}/12`);

    const { rows: phRows } = await vc.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'tenant' AND table_name = 'staff' AND column_name = 'password_hash'
    `);
    console.log(`  ✓ tenant.staff.password_hash: ${phRows.length === 1 ? 'present' : 'MISSING'}`);

    const { rows: iuRows } = await vc.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'brand' AND table_name = 'announcements' AND column_name = 'image_url'
    `);
    console.log(`  ✓ brand.announcements.image_url: ${iuRows.length === 1 ? 'present' : 'MISSING'}`);

    const { rows: notifRows } = await vc.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'notifications' AND table_name = 'notifications'
    `);
    console.log(`  ✓ notifications.notifications: ${notifRows.length === 1 ? 'present' : 'MISSING'}`);

  } catch (err) {
    console.error('  Validation query failed:', err.message);
  } finally {
    vc.release();
  }

  console.log('\nV20 Foundation Consolidation complete.');
  process.exit(0);
})();
