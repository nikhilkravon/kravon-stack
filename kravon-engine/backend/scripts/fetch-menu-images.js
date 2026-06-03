'use strict';

require('dotenv').config();

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const { Pool } = require('pg');

const pool    = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const KEY     = process.env.UNSPLASH_ACCESS_KEY;
const DEST    = path.join(__dirname, '../../frontend/seed-assets/royal-tandoor/menu');
const BASE_URL = 'http://localhost:8000/seed-assets/royal-tandoor/menu';

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

const ITEMS = [
  { name: 'Chicken Tikka',             q: 'chicken tikka indian appetizer' },
  { name: 'Dahi Ke Kebab',             q: 'dahi kebab indian appetizer' },
  { name: 'Fish Tikka',                q: 'fish tikka tandoor grilled' },
  { name: 'Hara Bhara Kebab',          q: 'hara bhara kebab vegetarian green' },
  { name: 'Murgh Malai Tikka',         q: 'malai tikka chicken creamy' },
  { name: 'Paneer Tikka',              q: 'paneer tikka grilled indian' },
  { name: 'Tandoori Mushroom',         q: 'tandoori mushroom indian' },
  { name: 'Tandoori Prawns',           q: 'tandoori prawns grilled spicy' },
  { name: 'Tangdi Kebab',              q: 'tangdi kebab chicken leg grilled' },
  { name: 'Chicken Dum Biryani',       q: 'chicken biryani dum pot' },
  { name: 'Egg Biryani',               q: 'egg biryani indian rice' },
  { name: 'Mutton Dum Biryani',        q: 'mutton biryani dum spiced' },
  { name: 'Royal Special Biryani',     q: 'special biryani royal indian' },
  { name: 'Veg Dum Biryani',           q: 'vegetable biryani dum indian' },
  { name: 'Butter Chicken',            q: 'butter chicken makhani curry' },
  { name: 'Chicken Lababdar',          q: 'chicken lababdar curry tomato' },
  { name: 'Chicken Tikka Masala',      q: 'chicken tikka masala curry' },
  { name: 'Dhaba Chicken',             q: 'dhaba chicken curry rustic' },
  { name: 'Royal Chicken Rara',        q: 'chicken rara mince curry' },
  { name: 'Gulab Jamun',               q: 'gulab jamun indian sweet dessert' },
  { name: 'Gulab Jamun Cheesecake',    q: 'cheesecake fusion dessert' },
  { name: 'Kulfi Falooda',             q: 'kulfi falooda indian ice cream' },
  { name: 'Rasmalai',                  q: 'rasmalai indian milk sweet' },
  { name: 'Butter Naan',               q: 'butter naan bread clay oven' },
  { name: 'Garlic Naan',               q: 'garlic naan flatbread indian' },
  { name: 'Laccha Paratha',            q: 'laccha paratha layered flatbread' },
  { name: 'Plain Naan',                q: 'naan bread plain indian' },
  { name: 'Cheese Naan',               q: 'cheese naan stuffed bread' },
  { name: 'Butter Roti',               q: 'roti butter wheat bread' },
  { name: 'Tandoori Roti',             q: 'tandoori roti clay oven bread' },
  { name: 'Bhuna Gosht',               q: 'bhuna gosht mutton curry dry' },
  { name: 'Mutton Rara',               q: 'mutton rara curry mince' },
  { name: 'Nalli Nihari',              q: 'nihari lamb shank slow cooked' },
  { name: 'Rogan Josh',                q: 'rogan josh kashmiri lamb curry' },
  { name: 'Afghani Chicken',           q: 'afghani chicken creamy grilled' },
  { name: 'Royal Tandoor Mixed Grill', q: 'mixed grill platter tandoor indian' },
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
  { name: 'Fresh Lime Soda',           q: 'lime soda fresh drink fizzy' },
  { name: 'House Mocktail Collection', q: 'mocktail colorful drinks glass' },
];

function toSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: 'Client-ID ' + KEY } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u, depth) => {
      if (depth > 5) return reject(new Error('too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) return follow(res.headers.location, depth + 1);
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        const f = fs.createWriteStream(dest);
        res.pipe(f);
        f.on('finish', () => f.close(resolve));
        f.on('error', reject);
      }).on('error', reject);
    };
    follow(url, 0);
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

  let downloaded = 0;
  let skipped = 0;

  for (const item of ITEMS) {
    const id = dbMap[item.name];
    if (!id) { console.log('skip (not in db):', item.name); skipped++; continue; }

    try {
      const apiUrl = 'https://api.unsplash.com/search/photos?query='
        + encodeURIComponent(item.q)
        + '&per_page=3&orientation=landscape';

      const data = await fetchJson(apiUrl);
      const photo = data.results && data.results[0];

      if (!photo) { console.log('no result:', item.name); skipped++; continue; }

      const imgUrl   = photo.urls.regular;
      const filename = toSlug(item.name) + '.jpg';
      const destFile = path.join(DEST, filename);

      await downloadFile(imgUrl, destFile);

      const dbUrl = BASE_URL + '/' + filename;
      await pool.query('UPDATE menu.menu_items SET image_url = $1 WHERE id = $2', [dbUrl, id]);

      console.log('✓', item.name.padEnd(35), filename);
      downloaded++;

      await new Promise(r => setTimeout(r, 250));
    } catch (e) {
      console.error('✗', item.name, '-', e.message);
      skipped++;
    }
  }

  console.log('\nDownloaded:', downloaded, '| Skipped:', skipped);
  await pool.end();
}

run().catch(e => { console.error(e.message); pool.end(); process.exit(1); });
