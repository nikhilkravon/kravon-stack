'use strict';

/**
 * fetch-menu-images-cdn.js
 * Fetches Unsplash image URLs and stores them directly in the DB.
 * No local download — uses Unsplash CDN URLs directly.
 * Works in both local and production environments.
 */

require('dotenv').config();

const https = require('https');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const KEY  = process.env.UNSPLASH_ACCESS_KEY;

const ITEMS = [
  { name: 'Chicken Tikka',             q: 'chicken tikka indian appetizer' },
  { name: 'Dahi Ke Kebab',             q: 'dahi kebab indian appetizer' },
  { name: 'Fish Tikka',                q: 'fish tikka tandoor grilled' },
  { name: 'Hara Bhara Kebab',          q: 'hara bhara kebab vegetarian green' },
  { name: 'Murgh Malai Tikka',         q: 'malai tikka chicken creamy' },
  { name: 'Paneer Tikka',              q: 'paneer tikka grilled indian' },
  { name: 'Tandoori Mushroom',         q: 'tandoori mushroom indian' },
  { name: 'Tandoori Prawns',           q: 'tandoori prawns grilled spicy' },
  { name: 'Tangdi Kebab',              q: 'tangdi kebab chicken drumstick' },
  { name: 'Chicken Dum Biryani',       q: 'chicken biryani dum pot' },
  { name: 'Egg Biryani',               q: 'egg biryani indian rice' },
  { name: 'Mutton Dum Biryani',        q: 'mutton biryani dum spiced' },
  { name: 'Royal Special Biryani',     q: 'biryani rice indian saffron' },
  { name: 'Veg Dum Biryani',           q: 'vegetable biryani dum indian' },
  { name: 'Butter Chicken',            q: 'butter chicken makhani curry' },
  { name: 'Chicken Lababdar',          q: 'chicken lababdar curry tomato' },
  { name: 'Chicken Tikka Masala',      q: 'chicken tikka masala curry' },
  { name: 'Dhaba Chicken',             q: 'dhaba chicken curry rustic' },
  { name: 'Royal Chicken Rara',        q: 'chicken curry mince indian' },
  { name: 'Gulab Jamun',               q: 'gulab jamun indian sweet dessert' },
  { name: 'Gulab Jamun Cheesecake',    q: 'cheesecake fusion dessert plate' },
  { name: 'Kulfi Falooda',             q: 'kulfi ice cream indian dessert' },
  { name: 'Rasmalai',                  q: 'rasmalai indian milk sweet' },
  { name: 'Butter Naan',               q: 'butter naan bread clay oven' },
  { name: 'Garlic Naan',               q: 'garlic naan flatbread indian' },
  { name: 'Laccha Paratha',            q: 'laccha paratha layered flatbread' },
  { name: 'Plain Naan',                q: 'naan bread plain indian' },
  { name: 'Cheese Naan',               q: 'cheese naan stuffed bread' },
  { name: 'Butter Roti',               q: 'roti butter wheat bread indian' },
  { name: 'Tandoori Roti',             q: 'tandoori roti clay oven bread' },
  { name: 'Bhuna Gosht',               q: 'bhuna gosht mutton curry dry' },
  { name: 'Mutton Rara',               q: 'mutton curry mince indian' },
  { name: 'Nalli Nihari',              q: 'lamb shank slow cooked curry' },
  { name: 'Rogan Josh',                q: 'rogan josh lamb curry red' },
  { name: 'Afghani Chicken',           q: 'afghani chicken creamy grilled' },
  { name: 'Royal Tandoor Mixed Grill', q: 'mixed grill platter indian tandoor' },
  { name: 'Tandoori Chicken',          q: 'tandoori whole chicken grilled' },
  { name: 'Tandoori Jumbo Prawns',     q: 'tandoori jumbo prawns grilled' },
  { name: 'Tandoori Pomfret',          q: 'tandoori fish grilled whole' },
  { name: 'Chana Masala',              q: 'chana masala chickpea curry' },
  { name: 'Dal Makhani',               q: 'dal makhani black lentil butter' },
  { name: 'Kadai Paneer',              q: 'kadai paneer wok curry' },
  { name: 'Malai Kofta',               q: 'malai kofta paneer dumplings curry' },
  { name: 'Paneer Butter Masala',      q: 'paneer butter masala tomato curry' },
  { name: 'Shahi Paneer',              q: 'shahi paneer rich curry' },
  { name: 'Veg Kolhapuri',             q: 'vegetable kolhapuri spicy curry' },
  { name: 'Mango Lassi',               q: 'mango lassi yogurt drink' },
  { name: 'Sweet Lassi',               q: 'lassi sweet yogurt drink' },
  { name: 'Masala Chaas',              q: 'buttermilk chaas spiced drink' },
  { name: 'Cold Coffee',               q: 'cold coffee iced drink glass' },
  { name: 'Fresh Lime Soda',           q: 'lime soda fresh fizzy drink' },
  { name: 'House Mocktail Collection', q: 'mocktail colorful drinks glass' },
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: 'Client-ID ' + KEY } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Parse error: ' + data.slice(0, 80))); }
      });
    }).on('error', reject);
  });
}

async function run() {
  const dbRes = await pool.query(`
    SELECT i.id, i.name FROM menu.menu_items i
    JOIN tenant.restaurants r ON r.id = i.tenant_id
    WHERE r.slug = 'royal-tandoor' AND i.deleted_at IS NULL
  `);

  const dbMap = {};
  dbRes.rows.forEach(r => { dbMap[r.name] = r.id; });

  let updated = 0;
  let skipped = 0;

  for (const item of ITEMS) {
    const id = dbMap[item.name];
    if (!id) { console.log('—', item.name, '(not in db)'); skipped++; continue; }

    try {
      const apiUrl = 'https://api.unsplash.com/search/photos?query='
        + encodeURIComponent(item.q)
        + '&per_page=3&orientation=landscape&content_filter=high';

      const data = await fetchJson(apiUrl);

      if (!data.results || !data.results.length) {
        console.log('—', item.name, '(no result)');
        skipped++;
        continue;
      }

      // Use regular size URL — good quality, not too large
      const imageUrl = data.results[0].urls.regular;

      await pool.query(
        'UPDATE menu.menu_items SET image_url = $1 WHERE id = $2',
        [imageUrl, id]
      );

      console.log('✓', item.name.padEnd(35), imageUrl.slice(0, 50) + '…');
      updated++;

      // 250ms between requests — stay well under 50 req/hr demo limit
      await new Promise(r => setTimeout(r, 250));

    } catch (e) {
      console.error('✗', item.name, '-', e.message);
      skipped++;
    }
  }

  console.log('\nUpdated:', updated, '| Skipped:', skipped);
  await pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); process.exit(1); });
