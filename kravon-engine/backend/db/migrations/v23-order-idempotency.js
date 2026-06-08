/**
 * MIGRATION — v23-order-idempotency.js
 *
 * Adds idempotency_key to orders.orders and a unique index so the DB
 * enforces exactly-once order creation even under concurrent retries.
 *
 * Also adds the event_outbox table for durable event delivery.
 *
 * All steps are idempotent — safe to re-run.
 * Usage: node db/migrations/v23-order-idempotency.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [

  ['orders: add idempotency_key column',
    `ALTER TABLE orders.orders
     ADD COLUMN IF NOT EXISTS idempotency_key TEXT`],

  ['orders: unique index on (tenant_id, idempotency_key) — partial, excludes NULLs',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
     ON orders.orders (tenant_id, idempotency_key)
     WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL`],

  ['platform: create event_outbox table',
    `CREATE TABLE IF NOT EXISTS platform.event_outbox (
       id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id    UUID,
       event_type   TEXT         NOT NULL,
       payload      JSONB        NOT NULL DEFAULT '{}',
       status       TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
       attempts     INT          NOT NULL DEFAULT 0,
       last_error   TEXT,
       created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
       delivered_at TIMESTAMPTZ,
       next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`],

  ['platform: index on event_outbox for poller',
    `CREATE INDEX IF NOT EXISTS idx_event_outbox_poll
     ON platform.event_outbox (next_attempt_at, status)
     WHERE status IN ('pending', 'failed')`],

];

(async () => {
  console.log('Running V23 migration (order idempotency + event outbox)...\n');

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
    console.log('\n  ✓ All steps applied.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nV23 migration FAILED — rolled back.');
    console.error(err.message);
    client.release();
    process.exit(1);
  }

  try {
    await client.query(
      `INSERT INTO platform.schema_migrations (version, name)
       VALUES ('v23', 'order-idempotency')
       ON CONFLICT (version) DO NOTHING`
    );
    console.log('  ✓ Recorded in platform.schema_migrations');
  } catch (err) {
    console.warn('  ! Could not record in schema_migrations:', err.message);
  }

  client.release();
  console.log('\nV23 complete.');
  process.exit(0);
})();
