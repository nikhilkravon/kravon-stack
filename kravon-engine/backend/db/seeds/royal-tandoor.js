'use strict';

const bcrypt = require('bcryptjs');

/**
 * SEED — royal-tandoor.js
 *
 * Full presence seed for Royal Tandoor restaurant.
 * Images are served from http://localhost:8000/seed-assets/royal-tandoor/
 * Copy (or symlink) backend/db/seeds/assets/ → frontend/seed-assets/ before running.
 *
 * Run:  node backend/db/seeds/royal-tandoor.js
 *       (from kravon-engine/backend/)
 *
 * Idempotent — safe to re-run. Uses ON CONFLICT for the restaurant row,
 * and DELETE + INSERT for all brand.* rows.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const { getClient } = require('../pool');

// ─── Base image URL ───────────────────────────────────────────────────────────

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';
const ASSETS_DIR   = path.join(__dirname, 'assets', 'royal-tandoor');

const IMG = (folder, file) => `${FRONTEND_URL}/seed-assets/royal-tandoor/${folder}/${file}`;

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
  slug:    'royal-tandoor',
  name:    'Royal Tandoor',
  plan:    'pro',

  has_presence: true,
  has_orders:   true,
  has_tables:   true,
  has_catering: true,
  has_insights: true,

  // settings JSONB
  settings: {
    tagline:            'Where Ancient Flames Meet Modern Flavour',
    city:               'Mumbai',
    hours_display:      'Monday – Sunday | 12:00 PM – 11:30 PM',
    open_until:         '11:30 PM',
    delivery_zone:      'Within 12 km of Bandra West',
    email:              'reservations@royaltandoor.in',
    map_url:            'https://maps.google.com/?q=Royal+Tandoor+Bandra+West+Mumbai',
    google_review_url:  'https://g.page/r/royal-tandoor/review',
    review_threshold:   4,
    delivery_fee:       4900,       // ₹49
    free_delivery_above: 59900,     // free above ₹599
    presence: {
      story: {
        headline: 'A Legacy of Fire & Flavour',
        body: [
          'At Royal Tandoor, every dish begins with a tradition that spans generations. Inspired by the royal kitchens of North India, our chefs combine time-honoured recipes with carefully sourced ingredients to create a dining experience rooted in authenticity and elevated by craftsmanship.',
          'The heart of our kitchen is the tandoor—a symbol of warmth, celebration, and culinary artistry. From hand-marinated kebabs to slow-cooked curries and freshly baked breads, each plate reflects the depth of India\'s diverse food heritage while embracing contemporary presentation.',
          'Whether you\'re gathering with family, celebrating a special occasion, or simply craving unforgettable flavours, Royal Tandoor offers a welcoming space where hospitality, fire, and flavour come together.',
        ],
      },
      signature_dishes: [
        {
          name:        'Royal Dum Biryani',
          description: 'Fragrant basmati rice layered with saffron, spices, and slow-cooked tender meat.',
          image:       IMG('signature-dishes', 'signature-dishes-001.jpg'),
        },
        {
          name:        'Tandoori Maharaja Platter',
          description: 'A grand assortment of kebabs, grills, and tandoor specialties served sizzling hot.',
          image:       IMG('signature-dishes', 'signature-dishes-002.jpg'),
        },
        {
          name:        'Shahi Butter Chicken',
          description: 'Char-grilled chicken simmered in a rich tomato, butter, and cashew gravy.',
          image:       IMG('signature-dishes', 'signature-dishes-003.jpg'),
        },
      ],
      timeline: [],
    },
  },
};

// ─── Location ─────────────────────────────────────────────────────────────────

const LOCATION = {
  phone:   '+91 22 4892 7800',
  address: 'Ground Floor, Imperial Courtyard, Linking Road, Bandra West, Mumbai, Maharashtra 400050',
  city:    'Mumbai',
};

// ─── Brand assets ─────────────────────────────────────────────────────────────

const ASSETS = {
  logo:    IMGS('logo')[0],
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
  { platform: 'whatsapp',   url: 'https://wa.me/919876543210',                          label: 'WhatsApp',   position: 10 },
  { platform: 'instagram',  url: 'https://instagram.com/royaltandoorindia',              label: 'Instagram',  position: 20 },
  { platform: 'facebook',   url: 'https://facebook.com/royaltandoorindia',               label: 'Facebook',   position: 30 },
  { platform: 'google',     url: 'https://g.page/r/royal-tandoor/review',               label: 'Google',     position: 40 },
  { platform: 'zomato',     url: 'https://www.zomato.com/mumbai/royal-tandoor',          label: 'Zomato',     position: 50 },
  { platform: 'swiggy',     url: 'https://www.swiggy.com/restaurants/royal-tandoor',     label: 'Swiggy',     position: 60 },
];

// ─── Featured promos ──────────────────────────────────────────────────────────

const FEATURED = [
  {
    title:       'Royal Weekend Feast',
    description: 'Enjoy 20% off on signature grills, biryanis, and family platters every weekend.',
    image:       IMG('promo', 'promo-001.jpg'),
    ctaLabel:    'Reserve Your Table',
    ctaUrl:      '/presence/reservation.html',
    active:      true,
  },
];

// ─── Staff ────────────────────────────────────────────────────────────────────

const STAFF = {
  name:     'Royal Tandoor Admin',
  email:    'admin@royaltandoor.in',
  password: 'RoyalT@2026',
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
    console.log(`[royal-tandoor] tenant_id: ${tenantId}`);

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
    console.log('[royal-tandoor] location upserted');

    // ── 3. Brand assets — logo + banner ───────────────────────────────────
    await client.query(
      `UPDATE brand.assets SET deleted_at = NOW()
       WHERE tenant_id = $1 AND type IN ('logo', 'banner', 'story', 'gallery') AND deleted_at IS NULL`,
      [tenantId]
    );

    await client.query(
      `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
       VALUES (gen_random_uuid(), $1, 'logo', $2, 'Royal Tandoor logo', '{}')`,
      [tenantId, ASSETS.logo]
    );

    for (let i = 0; i < ASSETS.banners.length; i++) {
      await client.query(
        `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
         VALUES (gen_random_uuid(), $1, 'banner', $2, 'Royal Tandoor hero image', $3::jsonb)`,
        [tenantId, ASSETS.banners[i], JSON.stringify({ order: i })]
      );
    }

    if (ASSETS.story) {
      await client.query(
        `INSERT INTO brand.assets (id, tenant_id, type, url, alt_text, metadata)
         VALUES (gen_random_uuid(), $1, 'story', $2, 'Royal Tandoor story image', '{}')`,
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
    console.log('[royal-tandoor] brand.assets seeded (logo, banner, gallery)');

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
    console.log('[royal-tandoor] brand.contact_links seeded (6 platforms)');

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
    console.log('[royal-tandoor] brand.announcements seeded (1 promo)');

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
    console.log(`[royal-tandoor] staff seeded (${STAFF.email})`);

    await client.query('COMMIT');
    console.log('[royal-tandoor] seed complete.');

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
    .catch(e => { console.error('[royal-tandoor] failed:', e.message); process.exit(1); });
}
