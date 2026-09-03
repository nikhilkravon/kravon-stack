'use strict';

const bcrypt = require('bcryptjs');

/**
 * SEED — cafe-bodhi-tree.js
 *
 * Full presence seed for Café Bodhi Tree.
 * Images are served from http://localhost:8000/seed-assets/cafe-bodhi-tree/
 * Copy (or symlink) backend/db/seeds/assets/ → frontend/seed-assets/ before running.
 *
 * Run:  node backend/db/seeds/cafe-bodhi-tree.js
 *       (from kravon-engine/backend/)
 *
 * Idempotent — safe to re-run. Uses ON CONFLICT for the restaurant row,
 * and DELETE + INSERT for all brand.* rows.
 *
 * NOTE: pre-launch tenant (opening 05.09.2026). Several operational settings
 * (delivery_zone, email, map_url, google_review_url, review_threshold,
 * delivery_fee, free_delivery_above) are intentionally left unset — fill in
 * via dashboard Settings once known. Logo + gallery/hero images are
 * placeholders — swap in real files under assets/cafe-bodhi-tree/ and re-run.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const { getClient } = require('../pool');

// ─── Base image URL ───────────────────────────────────────────────────────────

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';
const ASSETS_DIR   = path.join(__dirname, 'assets', 'cafe-bodhi-tree');

const IMG = (folder, file) => `${FRONTEND_URL}/seed-assets/cafe-bodhi-tree/${folder}/${file}`;

// Read all files from a seed-assets subfolder, return as URLs (sorted)
const IMGS = folder => {
  const dir = path.join(ASSETS_DIR, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(jpe?g|png|webp|gif|svg)$/i.test(f))
    .sort()
    .map(f => IMG(folder, f));
};

// ─── Restaurant ───────────────────────────────────────────────────────────────

const RESTAURANT = {
  slug:    'cafe-bodhi-tree',
  name:    'Café Bodhi Tree',
  plan:    'pro',

  has_presence: true,
  has_orders:   true,
  has_tables:   true,
  has_catering: true,
  has_insights: true,

  // settings JSONB
  settings: {
    tagline:       'Food for the Body. Moments for the Mind.',
    city:          'Dombivli',
    hours_display: 'Opening: 05.09.2026 | 8 PM onwards',
    presence: {
      story: {
        headline: 'A Place to Eat, Meet & Pause',
        body: [
          'Café Bodhi Tree is built around a simple idea: a café should be more than a place to eat. It should be a place where people pause, meet, talk, laugh, work, celebrate, or simply spend a little time with themselves. Inspired by the Bodhi Tree as a symbol of growth, life, nourishment and awakening, the café brings that spirit into a contemporary lifestyle experience.',
          'As a pure vegetarian café, Café Bodhi Tree brings together a wide variety of tastes and occasions under one roof — from South Indian breakfast and Indian street food to café favourites, Mexican, Indo-Asian, Italian and Indian cuisine, complemented by desserts, wellness beverages, smoothies and more. Every meal is a moment, every conversation a memory, and every guest becomes part of the tree.',
        ],
      },
      signature_dishes: [
        {
          name:        'Burrata Mozzarella Pizza with Basil Pesto',
          description: 'Creamy burrata mozzarella, basil pesto and a fresh Italian-inspired pizza base.',
          image:       IMG('signature-dishes', 'signature-dishes-001.jpg'),
        },
        {
          name:        'Paneer Tikka',
          description: 'Indian-style cottage cheese marinated with aromatic spices and grilled to perfection.',
          image:       IMG('signature-dishes', 'signature-dishes-002.jpg'),
        },
        {
          name:        'Pizza Al Funghi with Truffle Oil',
          description: 'A rich mushroom pizza finished with fragrant truffle oil.',
          image:       IMG('signature-dishes', 'signature-dishes-003.jpg'),
        },
        {
          name:        'Dal Khichadi / Palak Dal Khichadi',
          description: 'Comforting lentil and rice preparation, with an optional spinach-rich variation.',
          image:       IMG('signature-dishes', 'signature-dishes-004.jpg'),
        },
      ],
      timeline: [],
    },
  },
};

// ─── Location ─────────────────────────────────────────────────────────────────

const LOCATION = {
  phone:   '+91 85519 94202',
  address: 'R Clubhouse, 10th Floor, Runwal Gardens City',
  city:    'Dombivli',
};

// ─── Brand assets ─────────────────────────────────────────────────────────────

const ASSETS = {
  // Uploaded via POST /v1/restaurants/cafe-bodhi-tree/presence/images (S3-backed, real prod URL).
  // Local assets/cafe-bodhi-tree/logo/ is not served in production — see media.js.
  logo:    'https://kravon-backend-production.up.railway.app/v1/media/restaurants/1abc383c-ea6e-4cc7-a4b8-abb94eccfbc5/cafe-bodhi-tree/images/1788467023141-cafe_bodhi_tree_logo.png',
  banners: IMGS('hero'),
  story:   IMGS('story')[0] || null,
  gallery: {
    food:     IMGS('gallery-food'),
    ambience: IMGS('gallery-ambience'),
    people:   IMGS('gallery-people'),
  },
};

// ─── Social / contact links ───────────────────────────────────────────────────

const CONTACT_LINKS = [
  { platform: 'whatsapp', url: 'https://wa.me/918551994202', label: 'WhatsApp', position: 10 },
];

// ─── Featured promos ──────────────────────────────────────────────────────────

const FEATURED = [];

// ─── Staff ────────────────────────────────────────────────────────────────────

const STAFF = {
  name:     'admin',
  email:    'admin@cbt.in',
  password: 'CafeBodhiTree@2026',
  role:     'owner',
};

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // ── 1. Upsert restaurant ───────────────────────────────────────────────
    const rRes = await client.query(
      `INSERT INTO tenant.restaurants
         (slug, name, plan, has_presence, has_orders, has_tables, has_catering, has_insights, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT (slug) DO UPDATE SET
         name         = EXCLUDED.name,
         plan         = EXCLUDED.plan,
         has_presence = EXCLUDED.has_presence,
         has_orders   = EXCLUDED.has_orders,
         has_tables   = EXCLUDED.has_tables,
         has_catering = EXCLUDED.has_catering,
         has_insights = EXCLUDED.has_insights,
         settings     = EXCLUDED.settings,
         updated_at   = NOW()
       RETURNING id`,
      [
        RESTAURANT.slug,
        RESTAURANT.name,
        RESTAURANT.plan,
        RESTAURANT.has_presence,
        RESTAURANT.has_orders,
        RESTAURANT.has_tables,
        RESTAURANT.has_catering,
        RESTAURANT.has_insights,
        JSON.stringify(RESTAURANT.settings),
      ]
    );

    const tenantId = rRes.rows[0].id;
    console.log(`[cafe-bodhi-tree] tenant_id: ${tenantId}`);

    // ── 2. Upsert location ────────────────────────────────────────────────
    const locRes = await client.query(
      `SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1`,
      [tenantId]
    );

    if (locRes.rows.length) {
      await client.query(
        `UPDATE tenant.locations SET phone = $1, address = $2, city = $3, updated_at = NOW()
         WHERE id = $4`,
        [LOCATION.phone, LOCATION.address, LOCATION.city, locRes.rows[0].id]
      );
    } else {
      await client.query(
        `INSERT INTO tenant.locations (id, tenant_id, phone, address, city, is_active)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, TRUE)`,
        [tenantId, LOCATION.phone, LOCATION.address, LOCATION.city]
      );
    }
    console.log('[cafe-bodhi-tree] location upserted');

    // ── 3. Brand assets — logo + banner ───────────────────────────────────
    await client.query(
      `UPDATE brand.assets SET deleted_at = NOW()
       WHERE tenant_id = $1 AND type IN ('logo', 'banner', 'story', 'gallery') AND deleted_at IS NULL`,
      [tenantId]
    );

    if (ASSETS.logo) {
      await client.query(
        `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
         VALUES (gen_random_uuid(), $1, 'logo', $2, 'Café Bodhi Tree logo', '{}')`,
        [tenantId, ASSETS.logo]
      );
    }

    for (let i = 0; i < ASSETS.banners.length; i++) {
      await client.query(
        `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
         VALUES (gen_random_uuid(), $1, 'banner', $2, 'Café Bodhi Tree hero image', $3::jsonb)`,
        [tenantId, ASSETS.banners[i], JSON.stringify({ order: i })]
      );
    }

    if (ASSETS.story) {
      await client.query(
        `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
         VALUES (gen_random_uuid(), $1, 'story', $2, 'Café Bodhi Tree story image', '{}')`,
        [tenantId, ASSETS.story]
      );
    }

    // ── 4. Gallery ────────────────────────────────────────────────────────
    for (const cat of ['food', 'ambience', 'people']) {
      for (const url of ASSETS.gallery[cat]) {
        await client.query(
          `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
           VALUES (gen_random_uuid(), $1, 'gallery', $2, '', $3::jsonb)`,
          [tenantId, url, JSON.stringify({ category: cat })]
        );
      }
    }
    console.log('[cafe-bodhi-tree] brand.assets seeded (logo, banner, gallery)');

    // ── 5. Contact links ──────────────────────────────────────────────────
    await client.query(
      `DELETE FROM brand.contact_links WHERE tenant_id = $1`,
      [tenantId]
    );

    for (const link of CONTACT_LINKS) {
      await client.query(
        `INSERT INTO brand.contact_links (id, tenant_id, platform, url, display_label, position)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [tenantId, link.platform, link.url, link.label, link.position]
      );
    }
    console.log(`[cafe-bodhi-tree] brand.contact_links seeded (${CONTACT_LINKS.length} platform(s))`);

    // ── 6. Featured promos ────────────────────────────────────────────────
    await client.query(
      `UPDATE brand.announcements SET deleted_at = NOW()
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );

    for (const f of FEATURED) {
      await client.query(
        `INSERT INTO brand.announcements
           (id, tenant_id, title, body, image_url, cta_label, cta_url, is_active, starts_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())`,
        [tenantId, f.title, f.description, f.image, f.ctaLabel, f.ctaUrl, f.active]
      );
    }
    console.log(`[cafe-bodhi-tree] brand.announcements seeded (${FEATURED.length} promos)`);

    // ── 7. Staff account ──────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(STAFF.password, 10);
    await client.query(
      `DELETE FROM tenant.staff WHERE tenant_id = $1 AND email = $2`,
      [tenantId, STAFF.email]
    );
    const staffRes = await client.query(
      `INSERT INTO tenant.staff (tenant_id, name, email, password_hash, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [tenantId, STAFF.name, STAFF.email, passwordHash]
    );
    const staffId = staffRes.rows[0].id;

    const roleRes = await client.query(
      `SELECT id FROM tenant.roles WHERE name = $1 LIMIT 1`,
      [STAFF.role]
    );
    if (roleRes.rows.length) {
      await client.query(
        `INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id)
         VALUES ($1, $2, $3) ON CONFLICT (staff_id, role_id) DO NOTHING`,
        [tenantId, staffId, roleRes.rows[0].id]
      );
    }
    console.log(`[cafe-bodhi-tree] staff seeded (${STAFF.email})`);

    await client.query('COMMIT');
    console.log('[cafe-bodhi-tree] seed complete.');

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = seed;

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(e => { console.error('[cafe-bodhi-tree] failed:', e.message); process.exit(1); });
}
