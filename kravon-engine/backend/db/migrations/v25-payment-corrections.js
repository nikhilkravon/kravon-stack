/**
 * MIGRATION — v25-payment-corrections.js
 * Distinguishes "correcting a mistake" from "refunding a guest" on billing.payments.
 *
 * Previously a refund was recorded as a negative-amount payment row, but
 * amount_paise has a CHECK (amount_paise > 0) constraint from v24 — so the
 * refund path in the settlement route was actually unreachable (DB rejects it).
 * This migration replaces that design: every payment row stays positive.
 * A refund is its own row (kind='refund'). A correction to a mis-entered
 * payment soft-voids the original row (voided_at/voided_by/void_reason) instead
 * of deleting it, so the ledger stays append-only and legible after the fact.
 *
 * Changes:
 *   billing.payments — adds kind ('payment' | 'refund'), reason,
 *                      voided_at, voided_by, void_reason
 *
 * All steps are idempotent — safe to re-run.
 * Usage: node db/migrations/v25-payment-corrections.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [

  ['payments: add kind (payment | refund)',
    `ALTER TABLE billing.payments
     ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'payment'
     CHECK (kind IN ('payment', 'refund'))`],

  ['payments: add reason',
    `ALTER TABLE billing.payments
     ADD COLUMN IF NOT EXISTS reason TEXT`],

  ['payments: add voided_at',
    `ALTER TABLE billing.payments
     ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ`],

  ['payments: add voided_by',
    `ALTER TABLE billing.payments
     ADD COLUMN IF NOT EXISTS voided_by UUID`],

  ['payments: add void_reason',
    `ALTER TABLE billing.payments
     ADD COLUMN IF NOT EXISTS void_reason TEXT`],

  ['payments: index for excluding voided rows from sums',
    `CREATE INDEX IF NOT EXISTS idx_payments_settlement_active
     ON billing.payments(settlement_id)
     WHERE voided_at IS NULL`],

];

(async () => {
  console.log('Running V25 migration (payment corrections)...\n');

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
    console.error('\nV25 migration FAILED — rolled back.');
    console.error(err.message);
    client.release();
    process.exit(1);
  }

  try {
    await client.query(
      `INSERT INTO platform.schema_migrations (version, name)
       VALUES ('v25', 'payment-corrections')
       ON CONFLICT (version) DO NOTHING`
    );
    console.log('  ✓ Recorded in platform.schema_migrations');
  } catch (err) {
    console.warn('  ! Could not record in schema_migrations:', err.message);
  }

  client.release();
  console.log('\nV25 complete.');
  process.exit(0);
})();
