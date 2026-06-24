'use strict';

/**
 * fix-brand-assets-urls-v2.js
 *
 * Rewrites all stored image URLs to the backend proxy format.
 *
 * Rule A — S3 virtual-hosted (already-fixed format from v1 script):
 *   FROM: https://kravon-restaurant-images-9obvtt.t3.storageapi.dev/<key>
 *   TO:   <MEDIA_BASE_URL>/v1/media/<key>
 *
 * Rule B — S3 path-style (original broken format):
 *   FROM: https://t3.storageapi.dev/kravon-restaurant-images-9obvtt/<key>
 *   TO:   <MEDIA_BASE_URL>/v1/media/<key>
 *
 * Rule C — Double-scheme corruption (from earlier buggy s3.js):
 *   FROM: https://kravon-*.https://t3.storageapi.dev/<key>
 *   TO:   <MEDIA_BASE_URL>/v1/media/<key>
 *
 * Rule D — Already correct proxy URLs: skip.
 * Rule E — Non-S3 URLs (github, localhost, cdn.kravon.in): delete the row
 *           for brand.announcements; null out for menu items / brand assets.
 * Rule F — NULL values: skip.
 *
 * Usage:
 *   node scripts/fix-brand-assets-urls-v2.js --dry-run   # preview only
 *   node scripts/fix-brand-assets-urls-v2.js              # apply
 */

require('dotenv').config();
const { query } = require('../db/pool');

const DRY = process.argv.includes('--dry-run');

const BUCKET        = process.env.BUCKET || process.env.AWS_S3_BUCKET_NAME;
const MEDIA_BASE    = (process.env.MEDIA_BASE_URL || '').replace(/\/$/, '');
const ENDPOINT_HOST = 't3.storageapi.dev';

if (!MEDIA_BASE) {
  console.error('MEDIA_BASE_URL is not set. Aborting.');
  process.exit(1);
}
if (!BUCKET) {
  console.error('BUCKET is not set. Aborting.');
  process.exit(1);
}

console.log(`[config] MEDIA_BASE=${MEDIA_BASE}  BUCKET=${BUCKET}  dry=${DRY}\n`);

// ── URL classifiers ───────────────────────────────────────────────────────────

function extractKey(url) {
  // Rule A: virtual-hosted  https://<bucket>.t3.storageapi.dev/<key>
  const vhMatch = url.match(new RegExp(`^https://${BUCKET}\\.${ENDPOINT_HOST}/(.+)$`));
  if (vhMatch) return vhMatch[1];

  // Rule B: path-style  https://t3.storageapi.dev/<bucket>/<key>
  const psMatch = url.match(new RegExp(`^https://${ENDPOINT_HOST}/${BUCKET}/(.+)$`));
  if (psMatch) return psMatch[1];

  // Rule C: double-scheme  https://<bucket>.https://t3.storageapi.dev/<key>
  const dsMatch = url.match(new RegExp(`^https://${BUCKET}\\.https://${ENDPOINT_HOST}/(.+)$`));
  if (dsMatch) return dsMatch[1];

  return null;
}

function classify(url) {
  if (!url)                              return 'null';
  if (url.startsWith(`${MEDIA_BASE}/v1/media/`)) return 'correct';
  const key = extractKey(url);
  if (key)                               return 's3';
  return 'foreign'; // github, localhost, cdn.kravon.in, etc.
}

function toProxyUrl(url) {
  const key = extractKey(url);
  if (!key) return null;
  return `${MEDIA_BASE}/v1/media/${key}`;
}

// ── Migration runner ──────────────────────────────────────────────────────────

async function migrateTable({ table, idCol, urlCol, deleteOnForeign }) {
  const { rows } = await query(`SELECT ${idCol}, ${urlCol} FROM ${table} WHERE deleted_at IS NULL`);

  let correct = 0, fixed = 0, nulled = 0, deleted = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    const url  = row[urlCol];
    const id   = row[idCol];
    const cls  = classify(url);

    if (cls === 'null' || cls === 'correct') { skipped++; continue; }

    if (cls === 's3') {
      const newUrl = toProxyUrl(url);
      if (!newUrl) { console.error(`  ERROR  [${table}] could not extract key from: ${url}`); errors++; continue; }

      // Sanity: output must start with MEDIA_BASE and contain /v1/media/
      if (!newUrl.startsWith(`${MEDIA_BASE}/v1/media/`)) {
        console.error(`  MALFORMED OUTPUT  ${newUrl}`);
        errors++;
        continue;
      }

      console.log(`  FIX    [${table}] ${id}\n         ${url}\n      -> ${newUrl}`);
      if (!DRY) {
        await query(`UPDATE ${table} SET ${urlCol} = $1 WHERE ${idCol} = $2`, [newUrl, id]);
      }
      fixed++;
      continue;
    }

    // cls === 'foreign'
    if (deleteOnForeign) {
      console.log(`  DELETE [${table}] ${id}  (foreign URL: ${url})`);
      if (!DRY) {
        await query(`DELETE FROM ${table} WHERE ${idCol} = $1`, [id]);
      }
      deleted++;
    } else {
      console.log(`  NULL   [${table}] ${id}  (foreign URL: ${url})`);
      if (!DRY) {
        await query(`UPDATE ${table} SET ${urlCol} = NULL WHERE ${idCol} = $1`, [id]);
      }
      nulled++;
    }
  }

  console.log(`\n  [${table}] total=${rows.length} fixed=${fixed} correct=${skipped} deleted=${deleted} nulled=${nulled} errors=${errors}\n`);
  return { fixed, deleted, nulled, errors };
}

async function main() {
  if (DRY) console.log('=== DRY RUN — no writes ===\n');

  let totalErrors = 0;

  // brand.assets — url column is NOT NULL, so delete rows with foreign URLs.
  // All foreign rows are seed data for demo tenants (cdn.kravon.in).
  const r1 = await migrateTable({
    table:           'brand.assets',
    idCol:           'id',
    urlCol:          'url',
    deleteOnForeign: true,
  });
  totalErrors += r1.errors;

  // brand.announcements — delete rows with foreign URLs (they're seed data)
  const r2 = await migrateTable({
    table:           'brand.announcements',
    idCol:           'id',
    urlCol:          'image_url',
    deleteOnForeign: true,
  });
  totalErrors += r2.errors;

  // menu.menu_items — null out foreign URLs
  const r3 = await migrateTable({
    table:           'menu.menu_items',
    idCol:           'id',
    urlCol:          'image_url',
    deleteOnForeign: false,
  });
  totalErrors += r3.errors;

  if (totalErrors > 0) {
    console.error(`\nFAIL — ${totalErrors} error(s) detected. No further action.`);
    process.exit(1);
  }

  console.log(DRY ? '\n=== DRY RUN COMPLETE — 0 errors ===' : '\n=== MIGRATION COMPLETE — 0 errors ===');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
