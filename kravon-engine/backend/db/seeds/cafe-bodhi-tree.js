'use strict';

const bcrypt = require('bcryptjs');

/**
 * SEED — cafe-bodhi-tree.js
 *
 * Full tenant seed for Café Bodhi Tree (Dombivli) — pure-veg café.
 * Seeds in one transaction:
 *   tenant.restaurants     — pro plan, all feature flags on
 *   tenant.locations       — R Clubhouse, Runwal Gardens City
 *   brand.contact_links    — WhatsApp
 *   tenant.staff           — owner account
 *   dining.tables          — 10 tables (only if tenant has none, so re-runs
 *                            never orphan live sessions)
 *   menu.*                 — 12 categories, 68 items, variants, customizations
 *
 * ⚠ ALL PRICES ARE PLACEHOLDERS — the source menu had no prices.
 *   Update via the dashboard or edit this file and re-run before go-live.
 *
 * Run:  node db/seeds/cafe-bodhi-tree.js
 *       (from kravon-engine/backend/)
 *
 * Idempotent — safe to re-run. Restaurant/location/staff are upserted,
 * contact links replaced, menu soft-deleted + reinserted, tables inserted
 * only when the tenant has zero active tables.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

// ─── Restaurant ───────────────────────────────────────────────────────────────

const RESTAURANT = {
  slug: 'cafe-bodhi-tree',
  name: 'Café Bodhi Tree',
  plan: 'pro',

  has_presence: true,
  has_orders:   true,
  has_tables:   true,
  has_catering: true,
  has_insights: true,

  // settings JSONB
  settings: {
    tagline:             'Food for the Body. Moments for the Mind.',
    city:                'Dombivli',
    hours_display:       'Monday – Sunday | 8:00 AM – 11:00 PM',   // default — not in source
    open_until:          '11:00 PM',                               // default — not in source
    delivery_zone:       'Runwal Gardens & nearby Dombivli',       // default — not in source
    email:               'hello@cafebodhitree.in',                 // default — not in source
    map_url:             'https://maps.google.com/?q=R+Clubhouse+Runwal+Gardens+City+Dombivli',
    review_threshold:    4,
    delivery_fee:        4000,    // ₹40 — default, not in source
    free_delivery_above: 49900,   // free above ₹499 — default, not in source
    presence: {
      story: {
        headline: 'Eat. Meet. Pause. Awaken.',
        body: [
          'A contemporary pure-vegetarian café designed as a place to eat, meet, work, celebrate, or simply pause.',
        ],
      },
      signature_dishes: [],
      timeline: [],
    },
  },
};

// ─── Location ─────────────────────────────────────────────────────────────────

const LOCATION = {
  phone:   '+91 85519 94202',   // secondary: +91 96074 79551 (in metadata)
  address: 'R Clubhouse, 10th Floor, Runwal Gardens City',
  city:    'Dombivli',
  metadata: { alt_phone: '+91 96074 79551' },
};

// ─── Contact links ────────────────────────────────────────────────────────────

const CONTACT_LINKS = [
  { platform: 'whatsapp', url: 'https://wa.me/918551994202', label: 'WhatsApp', position: 10 },
];

// ─── Staff ────────────────────────────────────────────────────────────────────
// Defaults — owner name/email/password were not provided.

const STAFF = {
  name:     'Café Bodhi Tree Admin',
  email:    'admin@cafebodhitree.in',
  password: 'BodhiTree@2026',
  role:     'owner',
};

// ─── Tables ───────────────────────────────────────────────────────────────────
// Default layout — count/capacities were not provided.

const TABLES = [
  { name: 'T1',  capacity: 2 },
  { name: 'T2',  capacity: 2 },
  { name: 'T3',  capacity: 2 },
  { name: 'T4',  capacity: 4 },
  { name: 'T5',  capacity: 4 },
  { name: 'T6',  capacity: 4 },
  { name: 'T7',  capacity: 4 },
  { name: 'T8',  capacity: 6 },
  { name: 'T9',  capacity: 6 },
  { name: 'T10', capacity: 8 },
].map(t => ({ ...t, floor: 'Clubhouse' }));

// ─── Customization group templates ───────────────────────────────────────────

const CUST_GROUPS = {
  'Spice Level': {
    group_type:  'radio',
    is_required: false,
    options: [
      { name: 'Mild',   price_modifier: 0, sort_order: 0 },
      { name: 'Medium', price_modifier: 0, sort_order: 1 },
      { name: 'Spicy',  price_modifier: 0, sort_order: 2 },
    ],
  },
  'Extras': {
    group_type:  'checkbox',
    is_required: false,
    options: [
      { name: 'Extra Cheese',  price_modifier: 50, sort_order: 0 },
      { name: 'Extra Paneer',  price_modifier: 60, sort_order: 1 },
      { name: 'Extra Veggies', price_modifier: 40, sort_order: 2 },
    ],
  },
  'Pasta Sauce': {
    group_type:  'radio',
    is_required: true,
    options: [
      { name: 'Arrabbiata (Red)',    price_modifier: 0,  sort_order: 0 },
      { name: 'Alfredo (White)',     price_modifier: 20, sort_order: 1 },
      { name: 'Basil Pesto',         price_modifier: 30, sort_order: 2 },
      { name: 'Aglio e Olio',        price_modifier: 0,  sort_order: 3 },
    ],
  },
};

// ─── Menu ─────────────────────────────────────────────────────────────────────
// ⚠ Every price below is a PLACEHOLDER (₹) — source menu had none.
// price: null when variants carry the pricing.
// Items listed as "X / Y" in the source menu are modelled as one item with variants.

const MENU = [
  {
    name: 'Breakfast',
    description: 'South Indian classics & morning staples',
    position: 0,
    items: [
      {
        name: 'Idli', price: null, food_type: 'veg',
        variants: [{ name: 'Ghee', price: 80 }, { name: 'Podi', price: 90 }],
      },
      {
        name: 'Dosa', price: null, food_type: 'veg',
        variants: [
          { name: 'Plain', price: 90 }, { name: 'Masala', price: 120 },
          { name: 'Mysore', price: 130 }, { name: 'Set Dosa', price: 110 },
        ],
      },
      { name: 'Uttapam',        price: 120, food_type: 'veg' },
      { name: 'Ghee Podi Dosa', price: 130, food_type: 'veg' },
      { name: 'Sheera',         price: 90,  food_type: 'veg' },
      { name: 'Ban Maska',      price: 70,  food_type: 'veg' },
    ],
  },

  {
    name: 'Soups',
    position: 1,
    items: [
      { name: 'Tomato Basil Soup',    price: 140, food_type: 'veg' },
      { name: 'Broccoli Almond Soup', price: 160, food_type: 'veg' },
      { name: 'Hot & Sour Soup',      price: 130, food_type: 'veg', customizations: ['Spice Level'] },
    ],
  },

  {
    name: 'Starters',
    position: 2,
    items: [
      { name: 'Paneer Tikka',            price: 220, food_type: 'veg', customizations: ['Spice Level'] },
      { name: 'Jhara Bhara Kebab',       price: 190, food_type: 'veg' },
      { name: 'Masala Cheese Corn Ball', price: 180, food_type: 'veg' },
      {
        name: 'French Fries', price: null, food_type: 'veg',
        variants: [
          { name: 'Peri Peri', price: 140 },
          { name: 'Truffle & Parmesan', price: 190 },
        ],
      },
      { name: 'Spicy Vegetable Tacos',           price: 180, food_type: 'veg' },
      { name: 'Spicy Cottage Cheese Tacos',      price: 200, food_type: 'veg' },
      { name: 'Loaded Nachos',                   price: 220, food_type: 'veg' },
      { name: 'Honey Chilli Potato Spring Roll', price: 180, food_type: 'veg' },
      { name: 'Tangra Chilli Paneer',            price: 220, food_type: 'veg', customizations: ['Spice Level'] },
      { name: 'Crispy Corn',                     price: 170, food_type: 'veg' },
      { name: 'Chips & Dip',                     price: 160, food_type: 'veg' },
    ],
  },

  {
    name: 'Toasties',
    position: 3,
    items: [
      { name: 'Garlic Bread',                    price: 120, food_type: 'veg' },
      { name: 'Cheese Chilli Garlic Toast',      price: 150, food_type: 'veg' },
      { name: 'Avocado & Feta Cheese Crostini',  price: 220, food_type: 'veg' },
      { name: 'Truffle Mushroom Crostini',       price: 210, food_type: 'veg' },
    ],
  },

  {
    name: 'Chaat Platter',
    position: 4,
    items: [
      { name: 'Pani Puri',  price: 90,  food_type: 'veg' },
      { name: 'Shev Puri',  price: 90,  food_type: 'veg' },
      { name: 'Dahi Puri',  price: 110, food_type: 'veg' },
      { name: 'Ragda Puri', price: 100, food_type: 'veg' },
    ],
  },

  {
    name: 'Pizza',
    position: 5,
    items: [
      { name: 'Margherita Pizza',                            price: 220, food_type: 'veg', customizations: ['Extras'] },
      { name: 'Farmhouse Veggie Supreme Pizza',              price: 280, food_type: 'veg', customizations: ['Extras'] },
      { name: 'Burrata Mozzarella Pizza with Basil Pesto',   price: 340, food_type: 'veg' },
      { name: 'Pizza Al Funghi with Truffle Oil',            price: 330, food_type: 'veg' },
    ],
  },

  {
    name: 'Pasta',
    position: 6,
    items: [
      { name: 'Make Your Own Pasta', price: 260, food_type: 'veg', customizations: ['Pasta Sauce', 'Extras'] },
      { name: 'Arrabbiata',          price: 240, food_type: 'veg', customizations: ['Extras'] },
      { name: 'Alfredo',             price: 260, food_type: 'veg', customizations: ['Extras'] },
      { name: 'Basil Pesto',         price: 270, food_type: 'veg', customizations: ['Extras'] },
    ],
  },

  {
    name: 'Asian Mains',
    position: 7,
    items: [
      { name: 'Stir-Fried Asian Vegetables in Black Pepper Sauce', price: 240, food_type: 'veg' },
      { name: 'Vegetables in Hot Garlic Sauce',                    price: 230, food_type: 'veg', customizations: ['Spice Level'] },
      {
        name: 'Vegetable Hakka Noodles / Rice', price: null, food_type: 'veg',
        variants: [{ name: 'Noodles', price: 180 }, { name: 'Rice', price: 190 }],
      },
      {
        name: 'Szechwan Vegetable Noodles / Rice', price: null, food_type: 'veg',
        customizations: ['Spice Level'],
        variants: [{ name: 'Noodles', price: 190 }, { name: 'Rice', price: 200 }],
      },
      {
        name: 'Chilli Garlic Noodles / Rice', price: null, food_type: 'veg',
        customizations: ['Spice Level'],
        variants: [{ name: 'Noodles', price: 190 }, { name: 'Rice', price: 200 }],
      },
    ],
  },

  {
    name: 'Indian Main Course',
    position: 8,
    items: [
      { name: 'Paneer Tikka Masala', price: 260, food_type: 'veg' },
      { name: 'Matar Paneer',        price: 240, food_type: 'veg' },
      { name: 'Paneer Khurchan',     price: 260, food_type: 'veg' },
      { name: 'Subz Miloni',         price: 230, food_type: 'veg' },
      { name: 'Bharwa Bhendi',       price: 210, food_type: 'veg' },
      { name: 'Jeera Aloo',          price: 180, food_type: 'veg' },
      { name: 'Aloo Matar',          price: 190, food_type: 'veg' },
      { name: 'Mushroom Masala',     price: 230, food_type: 'veg' },
      { name: 'Dal Makhani',         price: 220, food_type: 'veg' },
      { name: 'Dal Fry',             price: 170, food_type: 'veg' },
      { name: 'Dal Tadka',           price: 180, food_type: 'veg' },
    ],
  },

  {
    name: 'Rice',
    position: 9,
    items: [
      { name: 'Steamed Rice',     price: 120, food_type: 'veg' },
      { name: 'Jeera Rice',       price: 140, food_type: 'veg' },
      { name: 'Green Peas Pulao', price: 170, food_type: 'veg' },
      { name: 'Veg Pulao',        price: 180, food_type: 'veg' },
      {
        name: 'Veg Biryani / Paneer Biryani', price: null, food_type: 'veg',
        variants: [{ name: 'Veg', price: 220 }, { name: 'Paneer', price: 250 }],
      },
      {
        name: 'Dal Khichadi / Palak Dal Khichadi', price: null, food_type: 'veg',
        variants: [{ name: 'Dal', price: 180 }, { name: 'Palak Dal', price: 190 }],
      },
      { name: 'Curd Rice', price: 150, food_type: 'veg' },
    ],
  },

  {
    name: 'Indian Breads',
    position: 10,
    items: [
      { name: 'Roti',                      price: 30, food_type: 'veg' },
      { name: 'Naan',                      price: 50, food_type: 'veg' },
      { name: 'Garlic Naan',               price: 70, food_type: 'veg' },
      { name: 'Cheese Chilli Garlic Naan', price: 90, food_type: 'veg' },
      { name: 'Laccha Paratha',            price: 60, food_type: 'veg' },
      {
        name: 'Kulcha', price: null, food_type: 'veg',
        variants: [
          { name: 'Plain', price: 60 }, { name: 'Aloo', price: 90 },
          { name: 'Paneer', price: 110 }, { name: 'Mushroom', price: 110 },
          { name: 'Masala', price: 90 },
        ],
      },
    ],
  },

  {
    name: 'Desserts',
    position: 11,
    items: [
      { name: 'Gulab Jamun',               price: 100, food_type: 'veg' },
      { name: 'Classic Chocolate Brownie', price: 160, food_type: 'veg' },
      { name: 'Tres Leches',               price: 220, food_type: 'veg' },
      {
        name: 'Choice of Ice Cream', price: null, food_type: 'veg',
        variants: [
          { name: 'Vanilla', price: 80 },
          { name: 'Chocolate', price: 90 },
          { name: 'Butterscotch', price: 90 },
        ],
      },
    ],
  },
];

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

    let locationId;
    if (locRes.rows.length) {
      locationId = locRes.rows[0].id;
      await client.query(
        `UPDATE tenant.locations
         SET phone = $1, address = $2, city = $3, metadata = $4::jsonb, updated_at = NOW()
         WHERE id = $5`,
        [LOCATION.phone, LOCATION.address, LOCATION.city, JSON.stringify(LOCATION.metadata), locationId]
      );
    } else {
      const created = await client.query(
        `INSERT INTO tenant.locations (id, tenant_id, name, phone, address, city, is_active, metadata)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, TRUE, $6::jsonb)
         RETURNING id`,
        [tenantId, RESTAURANT.name, LOCATION.phone, LOCATION.address, LOCATION.city, JSON.stringify(LOCATION.metadata)]
      );
      locationId = created.rows[0].id;
    }
    console.log('[cafe-bodhi-tree] location upserted');

    // ── 3. Contact links ──────────────────────────────────────────────────
    await client.query(`DELETE FROM brand.contact_links WHERE tenant_id = $1`, [tenantId]);

    for (const link of CONTACT_LINKS) {
      await client.query(
        `INSERT INTO brand.contact_links (id, tenant_id, platform, url, display_label, position)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
        [tenantId, link.platform, link.url, link.label, link.position]
      );
    }
    console.log(`[cafe-bodhi-tree] brand.contact_links seeded (${CONTACT_LINKS.length})`);

    // ── 4. Staff account ──────────────────────────────────────────────────
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

    const roleRes = await client.query(
      `SELECT id FROM tenant.roles WHERE name = $1 LIMIT 1`,
      [STAFF.role]
    );
    if (roleRes.rows.length) {
      await client.query(
        `INSERT INTO tenant.staff_roles (tenant_id, staff_id, role_id)
         VALUES ($1, $2, $3) ON CONFLICT (staff_id, role_id) DO NOTHING`,
        [tenantId, staffRes.rows[0].id, roleRes.rows[0].id]
      );
    }
    console.log(`[cafe-bodhi-tree] staff seeded (${STAFF.email})`);

    // ── 5. Tables — only when the tenant has none (protects live sessions) ─
    const tblRes = await client.query(
      `SELECT COUNT(*)::int AS n FROM dining.tables
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );

    if (tblRes.rows[0].n === 0) {
      for (const t of TABLES) {
        await client.query(
          `INSERT INTO dining.tables
             (id, tenant_id, location_id, name, capacity, floor, status, qr_code, is_active)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'available', gen_random_uuid()::TEXT, TRUE)`,
          [tenantId, locationId, t.name, t.capacity, t.floor]
        );
      }
      console.log(`[cafe-bodhi-tree] dining.tables seeded (${TABLES.length} tables)`);
    } else {
      console.log(`[cafe-bodhi-tree] dining.tables skipped — ${tblRes.rows[0].n} tables already exist`);
    }

    // ── 6. Menu — soft-delete existing, reinsert ──────────────────────────
    const menuRes = await client.query(
      `SELECT id FROM menu.menus WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      [tenantId]
    );
    let menuId;
    if (menuRes.rows.length) {
      menuId = menuRes.rows[0].id;
    } else {
      const created = await client.query(
        `INSERT INTO menu.menus (tenant_id, name, menu_type) VALUES ($1, 'Main Menu', 'main') RETURNING id`,
        [tenantId]
      );
      menuId = created.rows[0].id;
    }

    for (const table of ['customization_options', 'customization_groups', 'item_variants', 'menu_items', 'categories']) {
      await client.query(
        `UPDATE menu.${table} SET deleted_at = NOW() WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId]
      );
    }
    console.log('[cafe-bodhi-tree] existing menu cleared');

    let totalItems = 0;

    for (const cat of MENU) {
      const catRes = await client.query(
        `INSERT INTO menu.categories (tenant_id, menu_id, name, description, position)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [tenantId, menuId, cat.name, cat.description ?? null, cat.position]
      );
      const catId = catRes.rows[0].id;

      for (let i = 0; i < cat.items.length; i++) {
        const item = cat.items[i];

        const itemRes = await client.query(
          `INSERT INTO menu.menu_items
             (tenant_id, category_id, name, description, price,
              food_type, is_customizable, is_available, sort_order, tags)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING id`,
          [
            tenantId,
            catId,
            item.name,
            item.description ?? null,
            item.price ?? 0,
            item.food_type ?? 'veg',
            !!(item.customizations?.length || item.variants?.length),
            true,
            i,
            item.tags ?? [],
          ]
        );
        const itemId = itemRes.rows[0].id;
        totalItems++;

        if (item.variants?.length) {
          for (let j = 0; j < item.variants.length; j++) {
            const v = item.variants[j];
            await client.query(
              `INSERT INTO menu.item_variants (tenant_id, menu_item_id, name, price, sort_order)
               VALUES ($1,$2,$3,$4,$5)`,
              [tenantId, itemId, v.name, v.price, j]
            );
          }
        }

        if (item.customizations?.length) {
          for (let g = 0; g < item.customizations.length; g++) {
            const groupName = item.customizations[g];
            const groupDef  = CUST_GROUPS[groupName];
            if (!groupDef) continue;

            const groupRes = await client.query(
              `INSERT INTO menu.customization_groups
                 (tenant_id, menu_item_id, name, group_type, is_required, position)
               VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
              [tenantId, itemId, groupName, groupDef.group_type, groupDef.is_required, g]
            );

            for (let o = 0; o < groupDef.options.length; o++) {
              const opt = groupDef.options[o];
              await client.query(
                `INSERT INTO menu.customization_options
                   (tenant_id, group_id, name, price_modifier, sort_order)
                 VALUES ($1,$2,$3,$4,$5)`,
                [tenantId, groupRes.rows[0].id, opt.name, opt.price_modifier, opt.sort_order]
              );
            }
          }
        }
      }

      console.log(`[cafe-bodhi-tree] ✓ ${cat.name} — ${cat.items.length} items`);
    }

    await client.query('COMMIT');
    console.log(`\n[cafe-bodhi-tree] seed complete — ${MENU.length} categories, ${totalItems} items.`);
    console.log('[cafe-bodhi-tree] ⚠ All prices are placeholders — update before go-live.');

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
