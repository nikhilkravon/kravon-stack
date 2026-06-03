/**
 * MIGRATION — v14-staff-password.js
 * Adds password_hash to tenant.staff for email+password login.
 *
 * The existing `pin` column is a bcrypt-hashed POS PIN (4-6 digits) — not suitable
 * for web authentication. This adds a separate column for full passwords.
 *
 * Usage: node db/migrations/v14-staff-password.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [
  ['Add password_hash to tenant.staff',
    `ALTER TABLE tenant.staff ADD COLUMN IF NOT EXISTS password_hash TEXT`],

  ['Index tenant.staff(tenant_id, email) for login lookups — already exists as partial unique, no action needed',
    `SELECT 1`],
];

(async () => {
  console.log('Running V14 migration (staff password_hash)...\n');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [desc, sql] of STEPS) {
      console.log(`  • ${desc}`);
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log('\nV14 migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nV14 migration FAILED — rolled back.');
    console.error(err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
})();
