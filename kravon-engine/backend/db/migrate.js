/**
 * MIGRATE — migrate.js
 * Runs the v12 canonical schema SQL against the connected Postgres instance.
 * Safe to re-run (all statements use IF NOT EXISTS / CREATE OR REPLACE).
 * Usage: node db/migrate.js
 */

'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { query } = require('./pool');

const V12_SQL = fs.readFileSync(
  path.join(__dirname, 'schema', 'kravon_schema_v12.sql'),
  'utf8'
);

(async () => {
  console.log('Running v12 schema migration...');
  try {
    await query(V12_SQL);
    console.log('Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
})();
