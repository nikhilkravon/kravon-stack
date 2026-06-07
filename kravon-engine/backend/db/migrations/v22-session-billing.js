/**
 * MIGRATION — v22-session-billing.js
 * Adds session billing identity and state machine fields.
 *
 * Changes:
 *   dining.sessions — adds bill_owner_name, bill_owner_phone,
 *                     bill_requested_at, bill_requested_by,
 *                     session_status (open | bill_requested | closed | paid)
 *
 * All steps are idempotent — safe to re-run.
 * Usage: node db/migrations/v22-session-billing.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [

  ['sessions: add bill_owner_name',
    `ALTER TABLE dining.sessions
     ADD COLUMN IF NOT EXISTS bill_owner_name TEXT`],

  ['sessions: add bill_owner_phone',
    `ALTER TABLE dining.sessions
     ADD COLUMN IF NOT EXISTS bill_owner_phone TEXT`],

  ['sessions: add bill_requested_at',
    `ALTER TABLE dining.sessions
     ADD COLUMN IF NOT EXISTS bill_requested_at TIMESTAMPTZ`],

  ['sessions: add bill_requested_by',
    `ALTER TABLE dining.sessions
     ADD COLUMN IF NOT EXISTS bill_requested_by TEXT`],

  ['sessions: add session_status with default open',
    `ALTER TABLE dining.sessions
     ADD COLUMN IF NOT EXISTS session_status TEXT NOT NULL DEFAULT 'open'
     CHECK (session_status IN ('open', 'bill_requested', 'closed', 'paid'))`],

  ['sessions: index on bill_requested for dashboard polling',
    `CREATE INDEX IF NOT EXISTS idx_sessions_bill_requested
     ON dining.sessions(tenant_id, bill_requested_at)
     WHERE bill_requested_at IS NOT NULL AND closed_at IS NULL AND deleted_at IS NULL`],

];

(async () => {
  console.log('Running V22 migration (session billing)...\n');

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
    console.error('\nV22 migration FAILED — rolled back.');
    console.error(err.message);
    client.release();
    process.exit(1);
  }

  // Record in schema_migrations
  try {
    await client.query(
      `INSERT INTO platform.schema_migrations (version, name)
       VALUES ('v22', 'session-billing')
       ON CONFLICT (version) DO NOTHING`
    );
    console.log('  ✓ Recorded in platform.schema_migrations');
  } catch (err) {
    console.warn('  ! Could not record in schema_migrations:', err.message);
  }

  client.release();
  console.log('\nV22 complete.');
  process.exit(0);
})();
