'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

// ─── Restaurant ───────────────────────────────────────────────────────────────

const RESTAURANT = {
  slug:               'spice-of-india',
  name:               'Spice of India',
  tagline:            'Authentic Indian Cuisine',
  year:               '2019',
  phone:              '+91 98765 43210',
  wa_number:          '919876543210',
  email:              'hello@spiceofindia.in',
  address:            '14, Inner Circle, Connaught Place, New Delhi 110001',
  city:               'Connaught Place, New Delhi',
  delivery_zone:      'Connaught Place · Rajiv Chowk · Janpath · Barakhamba',
  hours_display:      'Mon – Sun: 11:00 AM – 11:00 PM',
  open_until:         '11:00 PM',
  // Story
  story_headline: 'Cooking from the heart since 2019',
  story_body: [
    'Spice of India started as a single table in a family kitchen in Connaught Place. What began as cooking for neighbours became a full restaurant in less than a year — word of mouth did the rest.',
    'Every dish is made to order. Our curries start with whole spices, our dough is kneaded fresh each morning, and our tandoor runs from 10 AM until the last naan leaves the kitchen.',
    'We are not a chain. There is no central commissary, no frozen prep. This is one kitchen, one team, cooking the same way we always have.',
  ],
  story_facts: [
    { icon: '📅', title: 'Est. 2019',       body: 'Serving Connaught Place for 6 years' },
    { icon: '🍽️', title: '500+ covers/day', body: 'Dine-in, delivery & catering combined' },
    { icon: '👨‍🍳', title: '1 head chef',     body: 'Rajan Sharma — 22 years in the kitchen' },
    { icon: '🌶️', title: 'All fresh spices', body: 'Ground in-house, never pre-mixed' },
  ],
  // Location
  map_url: 'https://maps.google.com/?q=14+Inner+Circle+Connaught+Place+New+Delhi',
  // Products
  has_presence:       true,
  has_orders:         true,
  has_tables:         true,   // dine-in QR enabled
  has_catering:       true,
  has_insights:       true,
  // Tables config
  review_threshold:   4,      // prompt Google review for 4★ and above
  google_review_url:  'https://g.page/r/spice-of-india-cp/review',
  // Delivery
  delivery_fee:       4900,         // ₹49
  free_delivery_above: 59900,       // free above ₹599
  // Payments
  allowed_origin:     'https://spiceofindia.in',
};

// ─── Menu categories ──────────────────────────────────────────────────────────

const CATEGORIES = [
  { name: 'Appetizers',     subtitle: 'Starters & snacks',    sort_order: 1 },
  { name: 'Tandoor',        subtitle: 'From the clay oven',   sort_order: 2 },
  { name: 'Main Course',    subtitle: null,                   sort_order: 3 },
  { name: 'Breads & Rice',  subtitle: null,                   sort_order: 4 },
  { name: 'Desserts',       subtitle: 'Sweet endings',        sort_order: 5 },
  { name: 'Beverages',      subtitle: null,                   sort_order: 6 },
];

// prices in ₹ — seed script multiplies by 100 before insert
const ITEMS = {
  'Appetizers': [
    {
      name: 'Samosa (2 pcs)',
      price: 120,
      desc: 'Crispy golden pastry filled with spiced potato and peas. Served with mint chutney.',
      image: '🥟', image_bg: 'linear-gradient(135deg,#2a1800,#4a2a08,#3a1800)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 1,
    },
    {
      name: 'Paneer Tikka',
      price: 320,
      desc: 'Cubes of cottage cheese marinated in spiced yoghurt, charred in the tandoor. Served with green chutney.',
      image: '🫕', image_bg: 'linear-gradient(135deg,#2a1500,#502a10,#2e1600)',
      badge: 'Veg', badge_style: 'veg', customisable: true, sort_order: 2,
    },
    {
      name: 'Chicken 65',
      price: 360,
      desc: 'Deep-fried chicken in a fiery red marinade with curry leaves and green chillies.',
      image: '🍗', image_bg: 'linear-gradient(135deg,#3a0800,#601010,#2a0400)',
      badge: 'Bestseller', badge_style: 'top', customisable: true, sort_order: 3,
    },
    {
      name: 'Dahi Puri (6 pcs)',
      price: 160,
      desc: 'Crisp hollow puris filled with spiced potato, tangy tamarind water, and sweet yoghurt.',
      image: '🍡', image_bg: 'linear-gradient(135deg,#1a1000,#342008,#100a00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 4,
    },
    {
      name: 'Seekh Kebab (4 pcs)',
      price: 380,
      desc: 'Minced lamb mixed with aromatics and spices, skewered and cooked in the tandoor.',
      image: '🍢', image_bg: 'linear-gradient(135deg,#2a0a00,#4a1408,#1a0600)',
      badge: 'Non-Veg', badge_style: null, customisable: true, sort_order: 5,
    },
  ],

  'Tandoor': [
    {
      name: 'Murgh Malai Kebab',
      price: 420,
      desc: 'Chicken marinated in cream, cheese, and mild spices. Melt-in-mouth texture from the tandoor.',
      image: '🍗', image_bg: 'linear-gradient(135deg,#2a1800,#4a2a08,#3a1800)',
      badge: 'Non-Veg', badge_style: null, customisable: true, sort_order: 1,
    },
    {
      name: 'Tandoori Prawns (6 pcs)',
      price: 580,
      desc: 'Jumbo prawns in a tangy yoghurt and spice marinade, cooked on skewers in the clay oven.',
      image: '🦐', image_bg: 'linear-gradient(135deg,#2a1200,#4a2410,#1a0c00)',
      badge: 'Seafood', badge_style: null, customisable: true, sort_order: 2,
    },
    {
      name: 'Paneer Malai Tikka',
      price: 360,
      desc: 'Cottage cheese in a cream and saffron marinade. Delicately spiced, golden from the tandoor.',
      image: '🫕', image_bg: 'linear-gradient(135deg,#1e1000,#362008,#160c00)',
      badge: 'Veg', badge_style: 'veg', customisable: true, sort_order: 3,
    },
    {
      name: 'Mixed Grill Platter',
      price: 780,
      desc: 'Murgh Malai Kebab + Seekh Kebab + Tandoori Prawns + Mint Chutney. Great for sharing.',
      image: '🍽️', image_bg: 'linear-gradient(135deg,#2a0c00,#501808,#1e0800)',
      badge: 'Sharing', badge_style: 'top', customisable: false, sort_order: 4,
    },
  ],

  'Main Course': [
    {
      name: 'Butter Chicken',
      price: 480,
      desc: 'Tender chicken in a silky tomato and cream gravy. Mildly spiced, richly flavoured. Our most ordered dish.',
      image: '🍛', image_bg: 'linear-gradient(135deg,#3a1400,#602808,#2a0e00)',
      badge: 'Bestseller', badge_style: 'top', customisable: true, sort_order: 1,
    },
    {
      name: 'Paneer Butter Masala',
      price: 400,
      desc: 'Soft cottage cheese in the same rich tomato-cream base as our Butter Chicken. A veg crowd favourite.',
      image: '🍛', image_bg: 'linear-gradient(135deg,#2a1800,#4a2a08,#3a1800)',
      badge: 'Veg', badge_style: 'veg', customisable: true, sort_order: 2,
    },
    {
      name: 'Lamb Rogan Josh',
      price: 560,
      desc: 'Slow-braised lamb shoulder in a deep Kashmiri gravy of whole spices, yoghurt, and Kashmiri chillies.',
      image: '🍖', image_bg: 'linear-gradient(135deg,#2a0800,#501008,#1a0400)',
      badge: 'Non-Veg', badge_style: null, customisable: true, sort_order: 3,
    },
    {
      name: 'Dal Makhani',
      price: 340,
      desc: 'Black lentils slow-cooked overnight with tomatoes and butter. A staple of the north Indian table.',
      image: '🫕', image_bg: 'linear-gradient(135deg,#1a0800,#382010,#100400)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 4,
    },
    {
      name: 'Chicken Biryani',
      price: 520,
      desc: 'Long-grain basmati layered with spiced chicken, caramelised onions, and saffron. Dum-cooked to order.',
      image: '🍚', image_bg: 'linear-gradient(135deg,#2a1400,#4a2808,#1e1000)',
      badge: 'Bestseller', badge_style: 'top', customisable: true, sort_order: 5,
    },
    {
      name: 'Vegetable Biryani',
      price: 420,
      desc: 'Seasonal vegetables and paneer in fragrant saffron basmati. Served with a salan and raita.',
      image: '🍚', image_bg: 'linear-gradient(135deg,#1a1400,#302408,#120e00)',
      badge: 'Veg', badge_style: 'veg', customisable: true, sort_order: 6,
    },
    {
      name: 'Palak Paneer',
      price: 360,
      desc: 'Fresh cottage cheese cubes in a smooth, vibrant spinach and spice gravy.',
      image: '🥬', image_bg: 'linear-gradient(135deg,#081808,#10280e,#061006)',
      badge: 'Veg', badge_style: 'veg', customisable: true, sort_order: 7,
    },
    {
      name: 'Prawn Masala',
      price: 620,
      desc: 'Juicy prawns in a spiced onion-tomato gravy with coastal aromatics.',
      image: '🦐', image_bg: 'linear-gradient(135deg,#2a1000,#4a2010,#1a0a00)',
      badge: 'Seafood', badge_style: null, customisable: true, sort_order: 8,
    },
  ],

  'Breads & Rice': [
    {
      name: 'Butter Naan',
      price: 80,
      desc: 'Leavened flatbread baked on the walls of the tandoor, finished with butter.',
      image: '🫓', image_bg: 'linear-gradient(135deg,#2a1800,#4a2a08,#3a1800)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 1,
    },
    {
      name: 'Garlic Naan',
      price: 100,
      desc: 'Butter naan topped with minced garlic and fresh coriander.',
      image: '🫓', image_bg: 'linear-gradient(135deg,#1a1400,#2e2408,#100e00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 2,
    },
    {
      name: 'Laccha Paratha',
      price: 90,
      desc: 'Flaky, layered whole-wheat bread cooked on the tawa with ghee.',
      image: '🫓', image_bg: 'linear-gradient(135deg,#1a1200,#302008,#100c00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 3,
    },
    {
      name: 'Jeera Rice',
      price: 160,
      desc: 'Basmati rice tempered with cumin seeds in ghee. Pairs with any curry.',
      image: '🍚', image_bg: 'linear-gradient(135deg,#2a1e08,#3e2a10,#1a1406)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 4,
    },
    {
      name: 'Steamed Rice',
      price: 120,
      desc: 'Plain steamed basmati.',
      image: '🍚', image_bg: 'linear-gradient(135deg,#1e1a08,#30280c,#141006)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 5,
    },
  ],

  'Desserts': [
    {
      name: 'Gulab Jamun (2 pcs)',
      price: 160,
      desc: 'Soft milk-solid dumplings soaked in rose-cardamom syrup. Served warm.',
      image: '🍬', image_bg: 'linear-gradient(135deg,#2a1000,#4a1e08,#1a0a00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 1,
    },
    {
      name: 'Ras Malai (2 pcs)',
      price: 200,
      desc: 'Chilled cottage-cheese dumplings in thickened saffron milk with pistachios.',
      image: '🍮', image_bg: 'linear-gradient(135deg,#1a1400,#2e2008,#100e00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 2,
    },
    {
      name: 'Kulfi (Stick)',
      price: 140,
      desc: 'Dense, slow-frozen Indian ice cream in malai, pista, or mango. Rich and not too sweet.',
      image: '🍦', image_bg: 'linear-gradient(135deg,#1a1200,#2e1e08,#100c00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 3,
    },
    {
      name: 'Gajar Halwa',
      price: 180,
      desc: 'Slow-cooked carrot pudding with ghee, milk, and cardamom. Garnished with almonds.',
      image: '🥕', image_bg: 'linear-gradient(135deg,#2a0e00,#481a08,#1a0800)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 4,
    },
  ],

  'Beverages': [
    {
      name: 'Sweet Lassi',
      price: 120,
      desc: 'Thick chilled yoghurt drink with sugar and a hint of rose water.',
      image: '🥛', image_bg: 'linear-gradient(135deg,#1a1800,#2e2808,#100e00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 1,
    },
    {
      name: 'Salted Lassi',
      price: 120,
      desc: 'Tart, chilled yoghurt drink with black salt, roasted cumin, and mint.',
      image: '🥛', image_bg: 'linear-gradient(135deg,#181a18,#28302a,#101410)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 2,
    },
    {
      name: 'Masala Chai',
      price: 80,
      desc: 'Cardamom, ginger, and cinnamon chai brewed strong with full-fat milk.',
      image: '☕', image_bg: 'linear-gradient(135deg,#1a1000,#2e1e08,#100a00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 3,
    },
    {
      name: 'Fresh Lime Soda',
      price: 100,
      desc: 'Squeezed lime over soda with your choice of sweet, salty, or mixed.',
      image: '🍋', image_bg: 'linear-gradient(135deg,#0c1800,#162808,#080e00)',
      badge: 'Veg', badge_style: 'veg', customisable: false, sort_order: 4,
    },
    {
      name: 'Mango Lassi',
      price: 160,
      desc: 'Alphonso mango pulp blended with thick yoghurt and a touch of cardamom.',
      image: '🥭', image_bg: 'linear-gradient(135deg,#2a1800,#4a2808,#1a1000)',
      badge: 'Seasonal', badge_style: 'top', customisable: false, sort_order: 5,
    },
  ],
};

// ─── Add-ons (shown in customisation modal for customisable items) ─────────────

const ADDONS = [
  // Protein upgrades
  { label: 'Extra Paneer',         price: 80,  sort_order: 1 },
  { label: 'Extra Chicken',        price: 100, sort_order: 2 },
  // Accompaniments
  { label: 'Extra Gravy (small)',  price: 60,  sort_order: 3 },
  { label: 'Extra Raita',          price: 50,  sort_order: 4 },
  { label: 'Extra Mint Chutney',   price: 30,  sort_order: 5 },
  // Bread additions
  { label: 'Extra Naan',           price: 80,  sort_order: 6 },
  { label: 'Extra Laccha Paratha', price: 90,  sort_order: 7 },
  // Dietary notes (free)
  { label: 'Less Spicy',           price: 0,   sort_order: 8 },
  { label: 'No Onion / No Garlic', price: 0,   sort_order: 9 },
  { label: 'Extra Spicy',          price: 0,   sort_order: 10 },
];

// ─── Spice levels ─────────────────────────────────────────────────────────────

const SPICE_LEVELS = [
  'Mild',
  'Medium',
  'Hot',
  'Extra Hot',
].map((label, i) => ({ label, sort_order: i }));

// ─── Seed function ────────────────────────────────────────────────────────────

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const rRes = await client.query(`
      INSERT INTO restaurants (
        slug, name, tagline, year, phone, wa_number, email,
        address, city, delivery_zone, hours_display, open_until,
        has_presence, has_orders, has_tables, has_catering, has_insights,
        review_threshold, google_review_url,
        delivery_fee, free_delivery_above,
        allowed_origin,
        story_headline, story_body, story_facts, map_url
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,
        $18,$19,
        $20,$21,
        $22,
        $23,$24,$25,$26
      )
      ON CONFLICT (slug) DO UPDATE SET
        name=EXCLUDED.name, tagline=EXCLUDED.tagline,
        has_tables=EXCLUDED.has_tables,
        review_threshold=EXCLUDED.review_threshold,
        google_review_url=EXCLUDED.google_review_url,
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
      RESTAURANT.review_threshold, RESTAURANT.google_review_url,
      RESTAURANT.delivery_fee, RESTAURANT.free_delivery_above,
      RESTAURANT.allowed_origin,
      RESTAURANT.story_headline,
      JSON.stringify(RESTAURANT.story_body),
      JSON.stringify(RESTAURANT.story_facts),
      RESTAURANT.map_url,
    ]);

    const restaurantId = rRes.rows[0].rest_id;
    console.log(`[spice-of-india] rest_id: ${restaurantId}`);

    // Clean existing menu for idempotent re-seed
    await client.query('DELETE FROM menu_addons     WHERE rest_id=$1', [restaurantId]);
    await client.query('DELETE FROM spice_levels    WHERE rest_id=$1', [restaurantId]);
    await client.query('DELETE FROM menu_items      WHERE rest_id=$1', [restaurantId]);
    await client.query('DELETE FROM menu_categories WHERE rest_id=$1', [restaurantId]);

    // Categories + items
    for (const cat of CATEGORIES) {
      const cRes = await client.query(`
        INSERT INTO menu_categories (rest_id, name, subtitle, sort_order)
        VALUES ($1,$2,$3,$4) RETURNING id
      `, [restaurantId, cat.name, cat.subtitle, cat.sort_order]);

      const catId = cRes.rows[0].id;
      for (const item of (ITEMS[cat.name] || [])) {
        await client.query(`
          INSERT INTO menu_items
            (rest_id, category_id, name, price_paise, description,
             image, image_bg, badge, badge_style, customisable, sort_order)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [
          restaurantId, catId, item.name, item.price * 100, item.desc,
          item.image, item.image_bg, item.badge ?? null, item.badge_style ?? null,
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
    console.log('[spice-of-india] seed complete. 6 categories, 30 items, 10 add-ons, 4 spice levels. Tables: ON.');
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
