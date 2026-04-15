/**
 * SEED — dead-flat-co.js
 * Inserts Dead Flat Co. restaurant data into the database.
 * Derived from the V7 config files (presence + orders + catering).
 * Usage: node db/seeds/dead-flat-co.js
 *
 * This is the migration path from V7 config.js to the database.
 * Each new restaurant gets its own seed file.
 */

'use strict';

require('dotenv').config({ path: '../../.env' });

const { query, getClient } = require('../pool');

const RESTAURANT = {
  slug:           'dead-flat-co',
  name:           'Dead Flat Co.',
  tagline:        'Andheri West · Cloud Kitchen',
  year:           '2025',
  phone:          '+91 72084 00844',
  wa_number:      '917208400844',
  email:          'hello@deadflat.in',
  address:        'Andheri West, Mumbai 400053',
  city:           'Andheri West, Mumbai',
  delivery_zone:  'Andheri · Juhu · Versova · Lokhandwala',
  hours_display:  'Mon – Sun: 12:00 PM – 1:00 AM',
  open_until:     '1:00 AM',
  has_presence:   true,
  has_orders:     true,
  has_catering:   true,
  has_insights:   true,
  allowed_origin: 'https://deadflat.in',
  // razorpay keys are set via environment variables, not seeded
};

const CATEGORIES = [
  { name: 'Smash Burgers',  subtitle: null,        sort_order: 1 },
  { name: 'Loaded Fries',   subtitle: null,        sort_order: 2 },
  { name: 'Hot Wings',      subtitle: '6 pcs each', sort_order: 3 },
  { name: 'Combos',         subtitle: 'Best value', sort_order: 4 },
];

// Items keyed by category name — prices in rupees (stored as integer paise in DB)
const ITEMS = {
  'Smash Burgers': [
    { name: 'Dead Flat Classic', price: 299, desc: 'Single smashed patty. Aged cheddar. Charred onion aioli. Pickles. Brioche.', image: '🍔', image_bg: 'linear-gradient(135deg,#2a1800,#4a2a08,#3a1800)', badge: 'Top Seller', badge_style: 'top', customisable: true, sort_order: 1 },
    { name: 'The Compound',      price: 429, desc: 'Two patties. Double cheddar. Deadfire chilli mayo. Caramelised onions. Brioche.', image: '🍔', image_bg: 'linear-gradient(135deg,#2a1500,#502a10,#2e1600)', badge: 'Double Stack', badge_style: null, customisable: true, sort_order: 2 },
    { name: 'Double Inferno',    price: 479, desc: 'Two patties. Ghost pepper jack. Scorpion hot sauce. Fermented mustard. Toasted sesame brioche.', image: '🌶️', image_bg: 'linear-gradient(135deg,#3a0800,#601010,#2a0400)', badge: '🔥 Very Hot', badge_style: 'hot', customisable: true, sort_order: 3 },
    { name: 'The Black Press',   price: 349, desc: 'Charcoal black bean & beet patty. House aioli. Aged gouda. Pickled jalapeño.', image: '🌿', image_bg: 'linear-gradient(135deg,#0a1a08,#142010,#081408)', badge: 'Veg', badge_style: 'veg', customisable: true, sort_order: 4 },
  ],
  'Loaded Fries': [
    { name: 'Deadfire Fries', price: 189, desc: 'Skin-on double-fried. Deadfire chilli mayo. Crispy fried garlic. Chives.', image: '🍟', image_bg: 'linear-gradient(135deg,#2a1e04,#3e2a08,#1e1402)', badge: 'House Classic', badge_style: 'top', customisable: false, sort_order: 1 },
    { name: 'The Wreck',      price: 329, desc: 'Fries under pulled smash beef, cheddar sauce, pickled onions, house hot sauce.', image: '🥩', image_bg: 'linear-gradient(135deg,#2a1800,#4a2610,#1e1000)', badge: null, badge_style: null, customisable: false, sort_order: 2 },
    { name: 'Truffle Mess',   price: 249, desc: 'Thin-cut fries. White truffle oil. Parmesan shave. Cracked pepper. Rosemary salt.', image: '✨', image_bg: 'linear-gradient(135deg,#1a1608,#2e2810,#121004)', badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 3 },
  ],
  'Hot Wings': [
    { name: 'Classic Buffalo Wings',    price: 299, desc: 'Crispy fried wings. House buffalo sauce. Blue cheese dip. Celery sticks.', image: '🔥', image_bg: 'linear-gradient(135deg,#2a0a00,#4a1408,#200800)', badge: null, badge_style: null, customisable: false, sort_order: 1 },
    { name: 'Deadfire Wings',           price: 349, desc: "Scorpion chilli glaze. Fried shallots. Cooling sour cream. Don't let them sit.", image: '🌶️', image_bg: 'linear-gradient(135deg,#380400,#620808,#280200)', badge: '🔥 Hot', badge_style: 'hot', customisable: false, sort_order: 2 },
    { name: 'Honey Garlic Crisp Wings', price: 329, desc: 'Dry-brined overnight. Double-fried. Wild honey, black garlic, sesame.', image: '🍯', image_bg: 'linear-gradient(135deg,#1a1400,#2e2406,#120e00)', badge: null, badge_style: null, customisable: false, sort_order: 3 },
  ],
  'Combos': [
    { name: 'Classic Combo', price: 429, desc: 'Dead Flat Classic + Deadfire Fries + House sauce. The standard order.', image: '🍔🍟', image_bg: 'linear-gradient(135deg,#1a1200,#302008,#120e00)', badge: 'Save ₹60', badge_style: 'save', customisable: false, sort_order: 1 },
    { name: 'Inferno Combo', price: 799, desc: 'Double Inferno + Deadfire Wings (6pc) + Truffle Mess. The full send.', image: '🍔🌶️🔥', image_bg: 'linear-gradient(135deg,#2a0400,#4a1008,#1a0200)', badge: 'Save ₹80', badge_style: 'save', customisable: false, sort_order: 2 },
  ],
};

const ADDONS = [
  { label: 'Extra cheese slice',     price: 40,  sort_order: 1 },
  { label: 'Extra smash patty',      price: 80,  sort_order: 2 },
  { label: 'Deadfire sauce (extra)', price: 20,  sort_order: 3 },
  { label: 'No onions',              price: 0,   sort_order: 4 },
];

const SPICE_LEVELS = ['Mild', 'Medium', 'Hot', 'Deadfire'].map((label, i) => ({
  label,
  sort_order: i,
}));

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Insert restaurant
    const rRes = await client.query(`
      INSERT INTO restaurants (
        slug, name, tagline, year, phone, wa_number, email,
        address, city, delivery_zone, hours_display, open_until,
        has_presence, has_orders, has_catering, has_insights, allowed_origin
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      ON CONFLICT (slug) DO UPDATE SET
        name=EXCLUDED.name, updated_at=NOW()
      RETURNING id
    `, [
      RESTAURANT.slug, RESTAURANT.name, RESTAURANT.tagline, RESTAURANT.year,
      RESTAURANT.phone, RESTAURANT.wa_number, RESTAURANT.email,
      RESTAURANT.address, RESTAURANT.city, RESTAURANT.delivery_zone,
      RESTAURANT.hours_display, RESTAURANT.open_until,
      RESTAURANT.has_presence, RESTAURANT.has_orders,
      RESTAURANT.has_catering, RESTAURANT.has_insights,
      RESTAURANT.allowed_origin,
    ]);

    const restaurantId = rRes.rows[0].rest_id;
    console.log(`Restaurant ID: ${restaurantId}`);

    // Delete existing menu for clean re-seed
    await client.query('DELETE FROM menu_addons WHERE rest_id=$1', [restaurantId]);
    await client.query('DELETE FROM spice_levels WHERE rest_id=$1', [restaurantId]);
    await client.query('DELETE FROM menu_items WHERE rest_id=$1', [restaurantId]);
    await client.query('DELETE FROM menu_categories WHERE rest_id=$1', [restaurantId]);

    // Insert categories and items
    for (const cat of CATEGORIES) {
      const cRes = await client.query(`
        INSERT INTO menu_categories (rest_id, name, subtitle, sort_order)
        VALUES ($1,$2,$3,$4) RETURNING id
      `, [restaurantId, cat.name, cat.subtitle, cat.sort_order]);

      const catId = cRes.rows[0].id;
      const items = ITEMS[cat.name] || [];
      for (const item of items) {
        await client.query(`
          INSERT INTO menu_items
            (rest_id, category_id, name, price_paise, description,
             image, image_bg, badge, badge_style, customisable, sort_order)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [
          restaurantId, catId, item.name, item.price * 100, item.desc,
          item.image, item.image_bg, item.badge, item.badge_style,
          item.customisable, item.sort_order,
        ]);
      }
    }

    // Add-ons
    for (const a of ADDONS) {
      await client.query(`
        INSERT INTO menu_addons (rest_id, label, price_paise, sort_order)
        VALUES ($1,$2,$3,$4)
      `, [restaurantId, a.label, a.price * 100, a.sort_order]);
    }

    // Spice levels
    for (const s of SPICE_LEVELS) {
      await client.query(`
        INSERT INTO spice_levels (rest_id, label, sort_order)
        VALUES ($1,$2,$3)
      `, [restaurantId, s.label, s.sort_order]);
    }

    await client.query('COMMIT');
    console.log('Seed complete for Dead Flat Co.');
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

seed();
