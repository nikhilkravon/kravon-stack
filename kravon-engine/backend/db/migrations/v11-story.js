'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { query } = require('../pool');

const STEPS = [
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS story_headline TEXT`,
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS story_body     JSONB DEFAULT '[]'::jsonb`,
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS story_facts    JSONB DEFAULT '[]'::jsonb`,
  `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS map_url        VARCHAR(500)`,
];

(async () => {
  console.log('Running V11 migration (story + map_url)...\n');
  for (const sql of STEPS) {
    const label = sql.trim().slice(0, 80);
    try {
      await query(sql);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      console.error(`  ✗ ${label}\n    ${err.message}`);
      process.exit(1);
    }
  }
  console.log('\nV11 migration complete.');
  process.exit(0);
})();
