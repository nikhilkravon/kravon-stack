'use strict';

/**
 * MAINTENANCE — price-cafe-bodhi-tree-menu.js
 *
 * One-shot pre-launch pricing pass for the cafe-bodhi-tree tenant.
 * Applies the real menu prices supplied by the owner (04.09.2026,
 * ahead of the 05.09.2026 launch) via the same authenticated
 * dashboard API a staff member would use — not direct DB writes —
 * so bustConfigCache() fires correctly and validation applies.
 *
 * Also, per owner decision:
 *   - Renames "Honey Chilli Potato Spring Roll" -> "Veg Spring Roll"
 *   - Adds a "Lemon Coriander Soup" item (new, no prior seed row)
 *   - Adds Onion/Tomato/Masala variants to Uttapam (was variant-less)
 *   - Adds a second variant dimension (Schezwan/Chilli Garlic) is NOT
 *     representable by this schema (variants are a single flat list,
 *     not two independent dimensions) — see NOTE at bottom. Handled
 *     by creating one flattened variant per combination instead.
 *
 * Idempotent for item price/name updates (PUT by id). Variant/item
 * creation is NOT idempotent — re-running will create duplicates for
 * any category that lacked the item/variant on the previous run.
 * Check output before re-running.
 *
 * Run:  node db/seeds/price-cafe-bodhi-tree-menu.js
 *       (from kravon-engine/backend/)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const BASE = process.env.KRAVON_API_BASE || 'https://kravon-backend-production.up.railway.app';
const SLUG = 'cafe-bodhi-tree';
const EMAIL = 'admin@cbt.in';
const PASSWORD = 'CafeBodhiTree@2026';

// ─── Simple item price updates (name -> price in rupees) ──────────────────────
// Applied via PUT /menu/items/:id { price }. Matched by exact current name.

const ITEM_PRICES = {
  // Bodhi Beginnings
  'Uttapam':                          249,
  'Ghee Podi Dosa':                   0,   // not in owner's price list — left as-is (flagged below)
  'Sheera':                           0,   // not in owner's price list — left as-is (flagged below)
  'Ban Maska':                        69,

  // Warm & Wholesome
  'Tomato Basil Soup':                259,
  'Broccoli Almond Soup':             259,
  'Hot & Sour Soup':                  259,

  // Bites Under the Tree
  'Paneer Tikka':                     399,
  'Jhara Bhara Kebab':                359,
  'Masala Cheese Corn Ball':          369,
  'Spicy Vegetable Tacos':            349,
  'Spicy Cottage Cheese Tacos':       399,
  'Loaded Nachos':                    399,
  // 'Honey Chilli Potato Spring Roll' -> renamed + priced separately below
  'Tangra Chilli Paneer':             0,   // not in owner's price list — left as-is (flagged below)
  'Crispy Corn':                      0,   // not in owner's price list — left as-is (flagged below)
  'Chips & Dip':                      0,   // not in owner's price list — left as-is (flagged below)
  'Garlic Bread':                     249,
  'Cheese Chilli Garlic Toast':       299,
  'Avocado & Feta Cheese Crostini':   399,
  'Truffle Mushroom Crostini':        399,

  // Chaat & Street Stories — owner gave ₹329 as a platter price; applied
  // to each item individually per owner's supplied menu (see chat note).
  'Pani Puri':                        329,
  'Shev Puri':                        329,
  'Dahi Puri':                        329,
  'Ragda Puri':                       329,

  // Wood-Fired Stories
  'Margherita Pizza':                 399,
  'Farmhouse Veggie Supreme Pizza':   449,
  'Burrata Mozzarella Pizza with Basil Pesto': 499,
  'Pizza Al Funghi with Truffle Oil': 499,

  // Pasta Your Way
  'Make Your Own Pasta':              449,
  'Arrabbiata':                       399,
  'Alfredo':                          399,
  'Basil Pesto':                      399,

  // East Meets West
  'Stir-Fried Asian Vegetables in Black Pepper Sauce': 429,
  'Vegetables in Hot Garlic Sauce':   429,
  // Noodle/rice dishes priced via variants below (has_variants = true)

  // From the Indian Kitchen
  'Paneer Tikka Masala':              499,
  'Matar Paneer':                     479,
  'Paneer Khurchan':                  499,
  'Subz Miloni':                      449,
  'Bharwa Bhendi':                    379,
  'Jeera Aloo':                       349,
  'Aloo Matar':                       379,
  'Mushroom Masala':                  449,
  'Dal Makhani':                      449,
  'Dal Fry':                          349,
  'Dal Tadka':                        379,

  // Rice & Comfort
  'Steamed Rice':                     229,
  'Jeera Rice':                       259,
  'Green Peas Pulao':                 299,
  'Veg Pulao':                        0,   // not in owner's price list — left as-is (flagged below)
  'Curd Rice':                        249,
  // Veg Biryani / Paneer Biryani and Dal Khichadi / Palak Dal Khichadi
  // are variant items — priced via variants below.

  // Indian Breads
  'Roti':                             49,
  'Naan':                             79,
  'Garlic Naan':                      89,
  'Cheese Chilli Garlic Naan':        149,
  'Laccha Paratha':                   119,
  // Kulcha is a variant item — priced via variants below.

  // A Little Something Sweet
  'Gulab Jamun':                      199,
  'Classic Chocolate Brownie':        249,
  'Tres Leches':                      349,
  'Choice of Ice Cream':              199,
};

// ─── Item renames (old name -> new name) ───────────────────────────────────────

const ITEM_RENAMES = {
  'Honey Chilli Potato Spring Roll': 'Veg Spring Roll',
};

// After rename, this item also gets a price (matched by NEW name):
const RENAMED_ITEM_PRICES = {
  'Veg Spring Roll': 349,
};

// ─── Variant price updates (item name -> { variant name -> price }) ───────────
// Owner's price = single price for the item; all listed variants get that price.

const VARIANT_UNIFORM_PRICE = {
  'Idli':      { price: 199, variants: ['Ghee', 'Podi'] },
  'Dosa':      { price: 229, variants: ['Plain', 'Masala', 'Mysore', 'Set Dosa'] },
  'French Fries': { price: 299, variants: ['Peri Peri', 'Truffle & Parmesan'] },
  'Veg Biryani / Paneer Biryani': { price: 399, variants: ['Veg Biryani', 'Paneer Biryani'] },
  'Dal Khichadi / Palak Dal Khichadi': { price: 349, variants: ['Dal Khichadi', 'Palak Dal Khichadi'] },
  'Kulcha':    { price: 159, variants: ['Plain', 'Aloo', 'Paneer', 'Mushroom', 'Masala'] },
};

// ─── New items to create ────────────────────────────────────────────────────────

const NEW_ITEMS = [
  { category: 'Warm & Wholesome', name: 'Lemon Coriander Soup',
    description: 'Light and refreshing soup with bright lemon and aromatic coriander.',
    price: 259, food_type: 'veg' },
];

// ─── New variants to add to Uttapam (was variant-less, flat price) ────────────
// Uttapam becomes a variant item: base price cleared, three variants added
// at the owner's single quoted price (₹249 each).

const UTTAPAM_NEW_VARIANTS = [
  { name: 'Onion',  price: 249 },
  { name: 'Tomato', price: 249 },
  { name: 'Masala', price: 249 },
];

/**
 * NOTE on the noodle dishes (Vegetable Hakka Noodles / Rice, Szechwan
 * Vegetable Noodles / Rice, Chilli Garlic Noodles / Rice):
 *
 * The owner's list independently varies BOTH format (Hakka Noodles vs
 * Rice) AND style (Schezwan vs Chilli Garlic) for what the seed treated
 * as three separate items each with one variant dimension (format only).
 * This schema's variants are a single flat list per item — it cannot
 * express two independent dimensions (format × style) as a matrix.
 *
 * Rather than guess a flattening, this script leaves these three items
 * exactly as seeded (format-only variants: Noodles/Rice per item) and
 * prices every existing variant at the owner's single quoted price
 * (₹429). If a real format × style matrix is wanted, that needs a menu
 * redesign, not a scripted price patch — flagged in the summary output.
 */
const NOODLE_VARIANT_PRICE = 429;
const NOODLE_ITEMS = [
  'Vegetable Hakka Noodles / Rice',
  'Szechwan Vegetable Noodles / Rice',
  'Chilli Garlic Noodles / Rice',
];

// ─── HTTP helpers ───────────────────────────────────────────────────────────────

async function login() {
  const res = await fetch(`${BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: SLUG, email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();
  return data.accessToken;
}

function api(token) {
  const root = `${BASE}/v1/restaurants/${SLUG}`;
  const req = async (method, path, body) => {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${path} failed: ${res.status}`);
    return data;
  };
  return {
    get:  (path)       => req('GET', path),
    put:  (path, body) => req('PUT', path, body),
    post: (path, body) => req('POST', path, body),
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function run() {
  const token = await login();
  const a = api(token);

  const config = await a.get('/config');
  const categories = config.config.categories;
  const itemsByName = new Map();
  for (const cat of categories) {
    for (const item of cat.items) itemsByName.set(item.name, { ...item, category_id: cat.id });
  }

  const skipped = [];
  const done = [];

  // 1. Rename items
  for (const [oldName, newName] of Object.entries(ITEM_RENAMES)) {
    const item = itemsByName.get(oldName);
    if (!item) { skipped.push(`RENAME: "${oldName}" not found`); continue; }
    await a.put(`/menu/items/${item.id}`, { name: newName });
    item.name = newName;
    itemsByName.set(newName, item);
    itemsByName.delete(oldName);
    done.push(`renamed "${oldName}" -> "${newName}"`);
  }

  // 2. Simple price updates
  for (const [name, price] of Object.entries({ ...ITEM_PRICES, ...RENAMED_ITEM_PRICES })) {
    if (price === 0) { skipped.push(`PRICE: "${name}" — no price supplied, left at 0`); continue; }
    const item = itemsByName.get(name);
    if (!item) { skipped.push(`PRICE: "${name}" not found in menu`); continue; }
    await a.put(`/menu/items/${item.id}`, { price });
    done.push(`priced "${name}" = ₹${price}`);
  }

  // 3. Uniform variant prices (existing variant items)
  for (const [itemName, { price, variants }] of Object.entries(VARIANT_UNIFORM_PRICE)) {
    const item = itemsByName.get(itemName);
    if (!item) { skipped.push(`VARIANTS: "${itemName}" not found`); continue; }
    const { variants: existing } = await a.get(`/menu/items/${item.id}/variants`);
    for (const vName of variants) {
      const v = existing.find(x => x.name === vName);
      if (!v) { skipped.push(`VARIANT: "${itemName}" -> "${vName}" not found`); continue; }
      await a.put(`/menu/items/${item.id}/variants/${v.id}`, { price });
      done.push(`priced variant "${itemName}" / "${vName}" = ₹${price}`);
    }
  }

  // 4. Noodle items — price existing format variants at owner's quoted price
  for (const itemName of NOODLE_ITEMS) {
    const item = itemsByName.get(itemName);
    if (!item) { skipped.push(`NOODLES: "${itemName}" not found`); continue; }
    const { variants: existing } = await a.get(`/menu/items/${item.id}/variants`);
    for (const v of existing) {
      await a.put(`/menu/items/${item.id}/variants/${v.id}`, { price: NOODLE_VARIANT_PRICE });
      done.push(`priced variant "${itemName}" / "${v.name}" = ₹${NOODLE_VARIANT_PRICE}`);
    }
  }

  // 5. New items
  for (const spec of NEW_ITEMS) {
    const cat = categories.find(c => c.name === spec.category);
    if (!cat) { skipped.push(`NEW ITEM: category "${spec.category}" not found`); continue; }
    if (itemsByName.has(spec.name)) { skipped.push(`NEW ITEM: "${spec.name}" already exists — skip to avoid duplicate`); continue; }
    await a.post('/menu/items', {
      category_id: cat.id, name: spec.name, description: spec.description,
      price: spec.price, food_type: spec.food_type,
    });
    done.push(`created item "${spec.name}" in "${spec.category}" = ₹${spec.price}`);
  }

  // 6. Uttapam: add Onion/Tomato/Masala variants
  const uttapam = itemsByName.get('Uttapam');
  if (!uttapam) {
    skipped.push('UTTAPAM VARIANTS: "Uttapam" not found');
  } else {
    const { variants: existing } = await a.get(`/menu/items/${uttapam.id}/variants`);
    for (const spec of UTTAPAM_NEW_VARIANTS) {
      if (existing.some(v => v.name === spec.name)) {
        skipped.push(`UTTAPAM VARIANT: "${spec.name}" already exists — skip to avoid duplicate`);
        continue;
      }
      await a.post(`/menu/items/${uttapam.id}/variants`, spec);
      done.push(`added variant "Uttapam" / "${spec.name}" = ₹${spec.price}`);
    }
  }

  console.log(`\n=== DONE (${done.length}) ===`);
  done.forEach(x => console.log('  ✓', x));
  console.log(`\n=== SKIPPED / NEEDS ATTENTION (${skipped.length}) ===`);
  skipped.forEach(x => console.log('  ⚠', x));
  console.log('\nPricing pass complete.');
}

run().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1; });
