'use strict';

/**
 * migrate-all.js — run by the Docker migrate service on first boot.
 * Applies the v20 canonical schema then runs each incremental migration
 * as a child process (each migration calls process.exit internally).
 * Every step is idempotent — safe to re-run.
 *
 * Usage: node db/migrate-all.js
 */

const { execFileSync } = require('child_process');
const path = require('path');

const MIGRATIONS = [
  'db/migrate.js',
  'db/migrations/v20-foundation.js',
  'db/migrations/v21-indexes.js',
  'db/migrations/v22-seed-roles.js',
  'db/migrations/v22-session-billing.js',
  'db/migrations/v23-order-idempotency.js',
];

for (const script of MIGRATIONS) {
  console.log(`\n[migrate-all] → ${script}`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', script)], {
      stdio: 'inherit',
      env: process.env,
    });
  } catch (err) {
    console.error(`[migrate-all] FAILED: ${script}`);
    process.exit(1);
  }
}

console.log('\n[migrate-all] All migrations complete.');
