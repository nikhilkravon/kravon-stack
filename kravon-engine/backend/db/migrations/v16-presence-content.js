/**
 * MIGRATION — v16-presence-content.js
 *
 * Wires Presence marketing content through the existing brand schema
 * instead of a redundant presence_content blob column.
 *
 * Changes:
 *   1. Drop presence_content column added in an earlier draft (if it exists).
 *   2. Add image_url TEXT to brand.announcements so featured items can carry
 *      an image — the only column the existing schema was missing.
 *
 * Everything else (gallery, hero image, story, contact, timeline,
 * signature_dishes) maps to brand.assets, brand.announcements,
 * tenant.locations, brand.contact_links, and tenant.restaurants.settings
 * respectively — no further DDL needed.
 *
 * Safe to re-run — all steps guarded by IF NOT EXISTS / DO-blocks.
 * Reversible — pass --rollback to undo.
 * Usage: node db/migrations/v16-presence-content.js [--rollback]
 */

'use strict';

require('dotenv').config();
const { query } = require('../pool');

const UP = [
  // 1. Remove the presence_content blob column if it was added by an earlier draft
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'tenant'
         AND table_name   = 'restaurants'
         AND column_name  = 'presence_content'
     ) THEN
       ALTER TABLE tenant.restaurants DROP COLUMN presence_content;
     END IF;
   END $$`,

  // 2. Drop the GIN index created alongside it, if present
  `DROP INDEX IF EXISTS idx_restaurants_presence_content`,

  // 3. Add image_url to brand.announcements (the only missing column for featured items)
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
   END $$`,
];

const DOWN = [
  // Reverse: remove image_url, restore presence_content blob
  `ALTER TABLE brand.announcements DROP COLUMN IF EXISTS image_url`,

  `DO $$
   BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'tenant'
         AND table_name   = 'restaurants'
         AND column_name  = 'presence_content'
     ) THEN
       ALTER TABLE tenant.restaurants
         ADD COLUMN presence_content JSONB NOT NULL DEFAULT '{}';
     END IF;
   END $$`,
];

(async () => {
  const rollback = process.argv.includes('--rollback');
  const steps    = rollback ? DOWN : UP;
  const tag      = rollback ? 'V16 ROLLBACK' : 'V16';

  console.log(`Running ${tag} migration (brand schema wiring)...\n`);
  for (const sql of steps) {
    const preview = sql.trim().split('\n')[0].slice(0, 80);
    try {
      await query(sql);
      console.log(`  ✓ ${preview}`);
    } catch (err) {
      console.error(`  ✗ ${preview}\n    ${err.message}`);
      process.exit(1);
    }
  }
  console.log(`\n${tag} complete.`);
  process.exit(0);
})();
