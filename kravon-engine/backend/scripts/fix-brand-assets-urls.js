'use strict';

/**
 * Fixes brand.assets URLs for royal-tandoor:
 *   - Replaces broken GitHub raw URLs with correct S3 URLs
 *   - Fixes the malformed logo URL (double https:// bug from old s3.js)
 *
 * Usage: node scripts/fix-brand-assets-urls.js [--dry-run]
 */

require('dotenv').config();
const { query } = require('../db/pool');

const DRY  = process.argv.includes('--dry-run');
const SLUG = 'royal-tandoor';

const _endpointBase = (process.env.ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const BASE = `https://${_endpointBase}/${process.env.BUCKET}`;

// Maps the tail of a GitHub URL → correct S3 path segment
function githubToS3(url, tenantId) {
  // e.g. .../seed-assets/royal-tandoor/gallery-food/gallery-food-001.jpg
  const match = url.match(/seed-assets\/royal-tandoor\/(.+)$/);
  if (!match) return null;
  return `${BASE}/restaurants/${tenantId}/royal-tandoor/${match[1]}`;
}

// Fix the malformed logo URL (double scheme)
function fixMalformedUrl(url) {
  // https://kravon-...9obvtt.https://t3.storageapi.dev/...
  return url.replace(
    /^https:\/\/(kravon-restaurant-images-9obvtt)\.https:\/\/t3\.storageapi\.dev\//,
    `https://$1.t3.storageapi.dev/`
  );
}

async function main() {
  if (DRY) console.log('[dry-run] No DB writes.\n');

  const { rows: [tenant] } = await query(
    `SELECT id FROM tenant.restaurants WHERE slug = $1`, [SLUG]
  );
  if (!tenant) throw new Error(`Tenant '${SLUG}' not found`);
  const tenantId = tenant.id;

  const { rows: assets } = await query(
    `SELECT id, type, url FROM brand.assets WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenantId]
  );

  let fixed = 0, skipped = 0;

  for (const asset of assets) {
    let newUrl = null;

    if (asset.url.includes('raw.githubusercontent.com')) {
      newUrl = githubToS3(asset.url, tenantId);
      if (!newUrl) { console.log(`  SKIP  [${asset.type}] can't map: ${asset.url}`); skipped++; continue; }
    } else if (asset.url.includes('.https://')) {
      newUrl = fixMalformedUrl(asset.url);
    }

    if (!newUrl || newUrl === asset.url) { skipped++; continue; }

    console.log(`  FIX   [${asset.type}]\n        ${asset.url}\n     -> ${newUrl}`);
    if (!DRY) {
      await query(`UPDATE brand.assets SET url = $1 WHERE id = $2`, [newUrl, asset.id]);
    }
    fixed++;
  }

  console.log(`\nDone. fixed=${fixed} skipped=${skipped}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
