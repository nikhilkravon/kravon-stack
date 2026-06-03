/**
 * MIGRATE — migrate.js
 * Applies the v20 canonical schema to a fresh database.
 * Safe to re-run (all statements use IF NOT EXISTS / CREATE OR REPLACE).
 *
 * For existing production databases use the incremental migration instead:
 *   node db/migrations/v20-foundation.js
 *
 * Usage: node db/migrate.js
 */

'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { query } = require('./pool');

const V20_SQL = fs.readFileSync(
  path.join(__dirname, 'kravon_schema_v20.sql'),
  'utf8'
);

(async () => {
  console.log('Applying kravon_schema_v20.sql...');
  try {
    await query(V20_SQL);
    console.log('Migration complete.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
})();
