/**
 * MIGRATE — migrate.js
 * Runs the schema SQL against the connected Postgres instance.
 * Safe to re-run (all statements use IF NOT EXISTS).
 * Usage: node db/migrate.js
 */

'use strict';

require('dotenv').config();

const { query } = require('./pool');
const SCHEMA    = require('./schema');

(async () => {
  console.log('Running migrations...');
  try {
    await query(SCHEMA);
    console.log('Migrations complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
})();
