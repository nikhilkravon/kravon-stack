'use strict';

/**
 * Uploads all Royal Tandoor seed assets to Railway S3, then updates
 * menu_items.image_url to point at the new S3 URLs.
 *
 * For menu items, distributes the gallery-food images across all items
 * (cycles through them since we have more items than food photos).
 *
 * Usage:
 *   node scripts/migrate-images-to-s3.js [--dry-run]
 */

require('dotenv').config();

const fs    = require('fs');
const path  = require('path');
const { query } = require('../db/pool');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const DRY_RUN    = process.argv.includes('--dry-run');
const SLUG       = 'royal-tandoor';
const ASSETS_DIR = path.join(__dirname, '../db/seeds/assets/royal-tandoor');

const endpointHost = (process.env.ENDPOINT || '').replace(/\/$/, '');
const s3 = new S3Client({
  region: process.env.REGION || 'auto',
  ...(endpointHost && { endpoint: endpointHost }),
  forcePathStyle: true,
  credentials: {
    accessKeyId:     process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/jpeg';
}

async function uploadFile(localPath, key) {
  const buffer = fs.readFileSync(localPath);
  await s3.send(new PutObjectCommand({
    Bucket:      process.env.BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType(localPath),
    ACL:         'public-read',
  }));
  const endpointBase = (process.env.ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${endpointBase}/${process.env.BUCKET}/${key}`;
}

function walkDir(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else if (/\.(jpg|jpeg|png|webp)$/i.test(entry.name)) results.push(full);
  }
  return results;
}

async function main() {
  if (DRY_RUN) console.log('[dry-run] No S3 uploads or DB writes.\n');

  const { rows: [tenant] } = await query(
    `SELECT id, slug FROM tenant.restaurants WHERE slug = $1`, [SLUG]
  );
  if (!tenant) throw new Error(`Tenant '${SLUG}' not found`);

  const tenantPrefix = `restaurants/${tenant.id}/${tenant.slug}`;
  const allFiles     = walkDir(ASSETS_DIR);

  // ── Step 1: upload every local asset, build a localPath → S3 URL map ──
  console.log(`\nUploading ${allFiles.length} seed assets…\n`);
  const s3UrlByLocal = {};
  let uploadCount = 0, uploadFailed = 0;

  for (const localPath of allFiles) {
    const rel = path.relative(ASSETS_DIR, localPath).replace(/\\/g, '/');
    const key = `${tenantPrefix}/${rel}`;
    process.stdout.write(`  ${rel.padEnd(60)}`);

    if (DRY_RUN) {
      const endpointBase = (process.env.ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
      s3UrlByLocal[localPath] = `https://${endpointBase}/${process.env.BUCKET}/${key}`;
      console.log('[dry-run]');
      uploadCount++;
      continue;
    }

    try {
      s3UrlByLocal[localPath] = await uploadFile(localPath, key);
      console.log('✓');
      uploadCount++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      uploadFailed++;
    }
  }

  console.log(`\nAssets: uploaded=${uploadCount} failed=${uploadFailed}`);

  // ── Step 2: assign gallery-food images to menu items ──
  const foodPhotos = allFiles
    .filter(f => f.includes('gallery-food'))
    .sort()
    .map(f => s3UrlByLocal[f])
    .filter(Boolean);

  if (!foodPhotos.length) {
    console.log('\nNo gallery-food images found — skipping menu item updates.');
    process.exit(uploadFailed > 0 ? 1 : 0);
  }

  const { rows: items } = await query(
    `SELECT id, name FROM menu.menu_items WHERE tenant_id = $1 ORDER BY name`,
    [tenant.id]
  );

  console.log(`\nUpdating ${items.length} menu items across ${foodPhotos.length} food photos…\n`);
  let dbUpdated = 0, dbFailed = 0;

  for (let i = 0; i < items.length; i++) {
    const item    = items[i];
    const imgUrl  = foodPhotos[i % foodPhotos.length];
    process.stdout.write(`  ${item.name.padEnd(38)}`);

    if (DRY_RUN) {
      console.log(`[dry-run] → ${imgUrl.split('/').slice(-1)[0]}`);
      dbUpdated++;
      continue;
    }

    try {
      await query(`UPDATE menu.menu_items SET image_url = $1 WHERE id = $2`, [imgUrl, item.id]);
      console.log(`→ ${imgUrl.split('/').slice(-1)[0]}`);
      dbUpdated++;
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      dbFailed++;
    }
  }

  console.log(`\nMenu items updated=${dbUpdated} failed=${dbFailed}`);
  console.log(`\nAll done.`);
  process.exit((uploadFailed + dbFailed) > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
