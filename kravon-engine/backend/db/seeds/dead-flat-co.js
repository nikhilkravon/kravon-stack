'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

// ─── Restaurant ───────────────────────────────────────────────────────────────

const RESTAURANT = {
  slug:               'dead-flat-co',
  name:               'Dead Flat Co.',
  tagline:            'Andheri West · Cloud Kitchen',
  year:               '2022',
  phone:              '+91 72084 00844',
  wa_number:          '917208400844',
  email:              'hello@deadflat.in',
  address:            'Andheri West, Mumbai 400053',
  city:               'Andheri West, Mumbai',
  delivery_zone:      'Andheri · Juhu · Versova · Lokhandwala · 4 Bungalows',
  hours_display:      'Mon – Sun: 12:00 PM – 1:00 AM',
  open_until:         '1:00 AM',
  // Story
  story_headline: 'Built in a home kitchen. Still cooking the same way.',
  story_body: [
    'Dead Flat Co. was never meant to be a restaurant. In 2022, two friends in Andheri West started making smash burgers for people they knew. Within three months, they had a cloud kitchen and a waiting list.',
    'Everything we serve comes from the same obsession: the right technique, the right ingredients, no shortcuts. Our patties are smashed to order. Our brioche is baked fresh. Our wings are brined overnight.',
    'We are a small team making food we actually want to eat. That\'s all this has ever been.',
  ],
  story_facts: [
    { icon: '📅', title: 'Est. 2022',          body: 'Started in a home kitchen in Andheri' },
    { icon: '🍔', title: '200+ orders/night',   body: 'Peak nights, all from one kitchen' },
    { icon: '🌙', title: 'Open till 1 AM',      body: 'Because hunger doesn\'t have a curfew' },
    { icon: '🥩', title: 'Fresh-smashed only',  body: 'Never frozen, never pre-pressed' },
  ],
  // Location
  map_url: 'https://maps.google.com/?q=Andheri+West+Mumbai',
  // Products — delivery-only cloud kitchen, no dine-in
  has_presence:       true,
  has_orders:         true,
  has_tables:         false,
  has_catering:       true,
  has_insights:       true,
  // Delivery
  delivery_fee:       3900,         // ₹39
  free_delivery_above: 39900,       // free above ₹399
  allowed_origin:     'https://deadflat.in',
};

// ─── Menu categories ──────────────────────────────────────────────────────────

const CATEGORIES = [
  { name: 'Smash Burgers',  subtitle: 'Fresh-smashed, never frozen',  sort_order: 1 },
  { name: 'Chicken',        subtitle: 'Wings, strips & more',         sort_order: 2 },
  { name: 'Loaded Fries',   subtitle: 'Proper loaded, not just topped', sort_order: 3 },
  { name: 'Sides & Dips',   subtitle: null,                           sort_order: 4 },
  { name: 'Combos',         subtitle: 'Best value',                   sort_order: 5 },
  { name: 'Drinks',         subtitle: null,                           sort_order: 6 },
];

const ITEMS = {
  'Smash Burgers': [
    {
      name: 'Dead Flat Classic',
      price: 299,
      desc: 'Single smash patty. Aged cheddar. Charred onion aioli. Dill pickles. Brioche.',
      image: '🍔', image_bg: 'linear-gradient(135deg,#2a1800,#4a2a08,#3a1800)',
      badge: 'Bestseller', badge_style: 'top', customisable: true, sort_order: 1,
    },
    {
      name: 'The Compound',
      price: 429,
      desc: 'Two smash patties. Double cheddar. Deadfire chilli mayo. Caramelised onions. Brioche.',
      image: '🍔', image_bg: 'linear-gradient(135deg,#2a1500,#502a10,#2e1600)',
      badge: 'Double Stack', badge_style: null, customisable: true, sort_order: 2,
    },
    {
      name: 'Double Inferno',
      price: 479,
      desc: 'Two patties. Ghost pepper jack. Scorpion hot sauce. Fermented mustard. Toasted sesame brioche.',
      image: '🌶️', image_bg: 'linear-gradient(135deg,#3a0800,#601010,#2a0400)',
      badge: '🔥 Very Hot', badge_style: 'hot', customisable: true, sort_order: 3,
    },
    {
      name: 'The Black Press',
      price: 349,
      desc: 'Charcoal black bean and beet patty. House aioli. Aged gouda. Pickled jalapeño. Veg.',
      image: '🌿', image_bg: 'linear-gradient(135deg,#0a1a08,#142010,#081408)',
      badge: 'Veg', badge_style: 'veg', customisable: true, sort_order: 4,
    },
    {
      name: 'The Truffle Smash',
      price: 399,
      desc: 'Single patty. White truffle aioli. Parmesan. Caramelised onions. Arugula. Brioche.',
      image: '✨', image_bg: 'linear-gradient(135deg,#1a1608,#2e2810,#121004)',
      badge: null, badge_style: null, customisable: true, sort_order: 5,
    },
    {
      name: 'Mushroom Swiss',
      price: 369,
      desc: 'Single patty. Sautéed wild mushrooms. Swiss cheese. Dijon aioli. Brioche.',
      image: '🍄', image_bg: 'linear-gradient(135deg,#181a10,#2c2e1c,#101208)',
      badge: null, badge_style: null, customisable: true, sort_order: 6,
    },
  ],

  'Chicken': [
    {
      name: 'Classic Buffalo Wings (6 pcs)',
      price: 299,
      desc: 'Double-fried wings tossed in our house buffalo sauce. Blue cheese dip and celery.',
      image: '🔥', image_bg: 'linear-gradient(135deg,#2a0a00,#4a1408,#200800)',
      badge: null, badge_style: null, customisable: true, sort_order: 1,
    },
    {
      name: 'Deadfire Wings (6 pcs)',
      price: 349,
      desc: "Scorpion chilli glaze. Fried shallots. Cooling sour cream. Don't let them sit.",
      image: '🌶️', image_bg: 'linear-gradient(135deg,#380400,#620808,#280200)',
      badge: '🔥 Hot', badge_style: 'hot', customisable: true, sort_order: 2,
    },
    {
      name: 'Honey Garlic Crisp Wings (6 pcs)',
      price: 329,
      desc: 'Dry-brined overnight. Double-fried. Wild honey, black garlic, toasted sesame.',
      image: '🍯', image_bg: 'linear-gradient(135deg,#1a1400,#2e2406,#120e00)',
      badge: null, badge_style: null, customisable: true, sort_order: 3,
    },
    {
      name: 'Chicken Strips (4 pcs)',
      price: 279,
      desc: 'Hand-breaded buttermilk strips. Crisp outside, juicy inside. House dip included.',
      image: '🍗', image_bg: 'linear-gradient(135deg,#2a1800,#4a2a08,#3a1800)',
      badge: null, badge_style: null, customisable: true, sort_order: 4,
    },
    {
      name: 'Wings Party Pack (18 pcs)',
      price: 849,
      desc: 'Choose any two sauces across 18 wings. Buffalo / Deadfire / Honey Garlic.',
      image: '🍗', image_bg: 'linear-gradient(135deg,#2a0800,#501008,#1a0400)',
      badge: 'Save ₹150', badge_style: 'save', customisable: false, sort_order: 5,
    },
  ],

  'Loaded Fries': [
    {
      name: 'Deadfire Fries',
      price: 189,
      desc: 'Skin-on double-fried fries. Deadfire chilli mayo. Crispy fried garlic. Chives.',
      image: '🍟', image_bg: 'linear-gradient(135deg,#2a1e04,#3e2a08,#1e1402)',
      badge: 'House Classic', badge_style: 'top', customisable: false, sort_order: 1,
    },
    {
      name: 'The Wreck',
      price: 329,
      desc: 'Fries smothered in pulled smash beef, cheddar sauce, pickled red onions, house hot sauce.',
      image: '🥩', image_bg: 'linear-gradient(135deg,#2a1800,#4a2610,#1e1000)',
      badge: null, badge_style: null, customisable: false, sort_order: 2,
    },
    {
      name: 'Truffle Mess',
      price: 249,
      desc: 'Thin-cut fries. White truffle oil. Parmesan shave. Cracked pepper. Rosemary salt.',
      image: '✨', image_bg: 'linear-gradient(135deg,#1a1608,#2e2810,#121004)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 3,
    },
    {
      name: 'Buffalo Loaded Fries',
      price: 299,
      desc: 'Fries with buffalo chicken strips, ranch dressing, and pickled jalapeños.',
      image: '🌶️', image_bg: 'linear-gradient(135deg,#2a0a00,#4a1408,#1a0600)',
      badge: null, badge_style: null, customisable: false, sort_order: 4,
    },
  ],

  'Sides & Dips': [
    {
      name: 'Plain Fries',
      price: 129,
      desc: 'Skin-on, double-fried. Just the fries. Perfectly seasoned.',
      image: '🍟', image_bg: 'linear-gradient(135deg,#2a1e04,#3e2a08,#1e1402)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 1,
    },
    {
      name: 'Coleslaw',
      price: 99,
      desc: 'Shredded cabbage and carrot in a creamy apple-cider dressing.',
      image: '🥗', image_bg: 'linear-gradient(135deg,#0a1808,#142410,#061004)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 2,
    },
    {
      name: 'Extra Dip',
      price: 49,
      desc: 'House buffalo, Deadfire hot sauce, blue cheese, ranch, or garlic aioli.',
      image: '🫙', image_bg: 'linear-gradient(135deg,#1a1000,#2e1c08,#100a00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 3,
    },
  ],

  'Combos': [
    {
      name: 'Classic Combo',
      price: 429,
      desc: 'Dead Flat Classic + Deadfire Fries + House sauce. The everyday order.',
      image: '🍔🍟', image_bg: 'linear-gradient(135deg,#1a1200,#302008,#120e00)',
      badge: 'Save ₹60', badge_style: 'save', customisable: false, sort_order: 1,
    },
    {
      name: 'Double Down Combo',
      price: 579,
      desc: 'The Compound + Deadfire Fries + Drink. Fully loaded.',
      image: '🍔🍺', image_bg: 'linear-gradient(135deg,#2a1400,#4a2408,#1a0e00)',
      badge: 'Save ₹80', badge_style: 'save', customisable: false, sort_order: 2,
    },
    {
      name: 'Inferno Combo',
      price: 799,
      desc: 'Double Inferno + Deadfire Wings (6 pcs) + Truffle Mess. The full send.',
      image: '🍔🌶️🔥', image_bg: 'linear-gradient(135deg,#2a0400,#4a1008,#1a0200)',
      badge: 'Save ₹120', badge_style: 'save', customisable: false, sort_order: 3,
    },
    {
      name: 'Wings & Fries',
      price: 449,
      desc: 'Classic Buffalo Wings (6 pcs) + Deadfire Fries + Blue Cheese Dip.',
      image: '🔥🍟', image_bg: 'linear-gradient(135deg,#2a0c00,#4a1808,#1a0600)',
      badge: 'Save ₹50', badge_style: 'save', customisable: false, sort_order: 4,
    },
  ],

  'Drinks': [
    {
      name: 'Cold Brew Coffee',
      price: 149,
      desc: '18-hour cold brew over ice. Black or with oat milk.',
      image: '☕', image_bg: 'linear-gradient(135deg,#0c0800,#181008,#080400)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 1,
    },
    {
      name: 'Craft Lemonade',
      price: 129,
      desc: 'Freshly squeezed lemon, mint, and sea salt over crushed ice.',
      image: '🍋', image_bg: 'linear-gradient(135deg,#0c1800,#162808,#080e00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 2,
    },
    {
      name: 'Classic Cola',
      price: 80,
      desc: 'Ice-cold can of Coca-Cola.',
      image: '🥤', image_bg: 'linear-gradient(135deg,#1a0000,#300808,#0e0000)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 3,
    },
    {
      name: 'Sparkling Water',
      price: 60,
      desc: 'Chilled sparkling mineral water.',
      image: '💧', image_bg: 'linear-gradient(135deg,#08101a,#101828,#060c12)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 4,
    },
  ],
};

// ─── Add-ons (shown in customisation modal for customisable items) ─────────────

const ADDONS = [
  // Burger build-ups
  { label: 'Extra smash patty',        price: 100, sort_order: 1 },
  { label: 'Extra cheese slice',       price: 40,  sort_order: 2 },
  { label: 'Extra Deadfire sauce',     price: 25,  sort_order: 3 },
  { label: 'Bacon add-on',             price: 60,  sort_order: 4 },
  { label: 'Fried egg add-on',         price: 50,  sort_order: 5 },
  // Burger removals (free)
  { label: 'No onions',                price: 0,   sort_order: 6 },
  { label: 'No pickles',               price: 0,   sort_order: 7 },
  { label: 'No sauce',                 price: 0,   sort_order: 8 },
  // Wing sauce upgrades
  { label: 'Extra wing sauce',         price: 30,  sort_order: 9 },
  { label: 'Make it boneless (wings)', price: 0,   sort_order: 10 },
];

// ─── Spice levels ─────────────────────────────────────────────────────────────

const SPICE_LEVELS = [
  'Mild',
  'Medium',
  'Hot',
  'Deadfire',   // max heat — matches brand
].map((label, i) => ({ label, sort_order: i }));

// ─── Seed function ────────────────────────────────────────────────────────────

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Insert into tenant.restaurants first
    const tenantRes = await client.query(`
      INSERT INTO tenant.restaurants (
        id, slug, name, plan, status,
        has_presence, has_orders, has_tables, has_catering, has_insights,
        settings
      ) VALUES (
        'b2000000-0000-0000-0000-000000000002',
        $1, $2, 'full', 'active',
        $3, $4, $5, $6, $7,
        '{
          "currency": "INR",
          "timezone": "Asia/Kolkata",
          "delivery_fee": 3900,
          "free_delivery_above": 39900
        }'
      )
      ON CONFLICT (slug) DO UPDATE SET
        name=EXCLUDED.name,
        has_presence=EXCLUDED.has_presence,
        has_orders=EXCLUDED.has_orders,
        has_tables=EXCLUDED.has_tables,
        has_catering=EXCLUDED.has_catering,
        has_insights=EXCLUDED.has_insights,
        settings=EXCLUDED.settings,
        updated_at=NOW()
      RETURNING id
    `, [
      RESTAURANT.slug, RESTAURANT.name,
      RESTAURANT.has_presence, RESTAURANT.has_orders, RESTAURANT.has_tables,
      RESTAURANT.has_catering, RESTAURANT.has_insights
    ]);

    const tenantId = tenantRes.rows[0].id;
    console.log(`[dead-flat-co] tenant_id: ${tenantId}`);

    const rRes = await client.query(`
      INSERT INTO restaurants (
        slug, name, tagline, year, phone, wa_number, email,
        address, city, delivery_zone, hours_display, open_until,
        has_presence, has_orders, has_tables, has_catering, has_insights,
        delivery_fee, free_delivery_above,
        allowed_origin,
        story_headline, story_body, story_facts, map_url
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,
        $18,$19,
        $20,
        $21,$22,$23,$24
      )
      ON CONFLICT (slug) DO UPDATE SET
        name=EXCLUDED.name, tagline=EXCLUDED.tagline,
        delivery_fee=EXCLUDED.delivery_fee,
        free_delivery_above=EXCLUDED.free_delivery_above,
        story_headline=EXCLUDED.story_headline,
        story_body=EXCLUDED.story_body,
        story_facts=EXCLUDED.story_facts,
        map_url=EXCLUDED.map_url,
        updated_at=NOW()
      RETURNING rest_id
    `, [
      RESTAURANT.slug, RESTAURANT.name, RESTAURANT.tagline, RESTAURANT.year,
      RESTAURANT.phone, RESTAURANT.wa_number, RESTAURANT.email,
      RESTAURANT.address, RESTAURANT.city, RESTAURANT.delivery_zone,
      RESTAURANT.hours_display, RESTAURANT.open_until,
      RESTAURANT.has_presence, RESTAURANT.has_orders, RESTAURANT.has_tables,
      RESTAURANT.has_catering, RESTAURANT.has_insights,
      RESTAURANT.delivery_fee, RESTAURANT.free_delivery_above,
      RESTAURANT.allowed_origin,
      RESTAURANT.story_headline,
      JSON.stringify(RESTAURANT.story_body),
      JSON.stringify(RESTAURANT.story_facts),
      RESTAURANT.map_url,
    ]);

    const restaurantId = rRes.rows[0].rest_id;
    console.log(`[dead-flat-co] rest_id: ${restaurantId}`);

    // Clean existing menu for idempotent re-seed
    await client.query('DELETE FROM menu_addons     WHERE tenant_id=$1', [tenantId]);
    await client.query('DELETE FROM spice_levels    WHERE tenant_id=$1', [tenantId]);
    await client.query('DELETE FROM menu_items      WHERE tenant_id=$1', [tenantId]);
    await client.query('DELETE FROM menu_categories WHERE tenant_id=$1', [tenantId]);

    // Categories + items
    for (const cat of CATEGORIES) {
      const cRes = await client.query(`
        INSERT INTO menu_categories (tenant_id, name, subtitle, sort_order)
        VALUES ($1,$2,$3,$4) RETURNING id
      `, [tenantId, cat.name, cat.subtitle, cat.sort_order]);

      const catId = cRes.rows[0].id;
      for (const item of (ITEMS[cat.name] || [])) {
        await client.query(`
          INSERT INTO menu_items
            (tenant_id, category_id, name, price_paise, description,
             image, image_bg, badge, badge_style, customisable, sort_order)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [
          tenantId, catId, item.name, item.price * 100, item.desc,
          item.image, item.image_bg, item.badge ?? null, item.badge_style ?? null,
          item.customisable, item.sort_order,
        ]);
      }
    }

    // Add-ons
    for (const a of ADDONS) {
      await client.query(`
        INSERT INTO menu_addons (tenant_id, label, price_paise, sort_order)
        VALUES ($1,$2,$3,$4)
      `, [tenantId, a.label, a.price * 100, a.sort_order]);
    }

    // Spice levels
    for (const s of SPICE_LEVELS) {
      await client.query(`
        INSERT INTO spice_levels (tenant_id, label, sort_order)
        VALUES ($1,$2,$3)
      `, [tenantId, s.label, s.sort_order]);
    }

    // Sample customizations for burgers
    // Get item IDs
    const itemRes = await client.query(`
      SELECT id, name FROM menu_items WHERE tenant_id = $1 AND customisable = TRUE
    `, [tenantId]);

    const itemMap = new Map(itemRes.rows.map(r => [r.name, r.id]));

    // For Dead Flat Classic
    const classicId = itemMap.get('Dead Flat Classic');
    if (classicId) {
      // Add customization group
      const groupRes = await client.query(`
        INSERT INTO customization_groups (item_id, name, type, min_select, max_select, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
      `, [classicId, 'Extra Toppings', 'multiple', 0, 2, 1]);

      const groupId = groupRes.rows[0].id;

      // Add options
      await client.query(`
        INSERT INTO customization_options (group_id, name, price_paise, active, sort_order)
        VALUES ($1, $2, $3, $4, $5)
      `, [groupId, 'Extra Cheese', 5000, true, 1]);

      await client.query(`
        INSERT INTO customization_options (group_id, name, price_paise, active, sort_order)
        VALUES ($1, $2, $3, $4, $5)
      `, [groupId, 'Bacon', 10000, true, 2]);
    }

    await client.query('COMMIT');
    console.log('[dead-flat-co] seed complete. 6 categories, 30 items, 10 add-ons, 4 spice levels, customizations added. Tables: OFF.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = seed;

if (require.main === module) {
  seed().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
}
