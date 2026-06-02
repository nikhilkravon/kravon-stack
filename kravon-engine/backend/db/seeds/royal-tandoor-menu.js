'use strict';

/**
 * SEED — royal-tandoor-menu.js
 *
 * Full menu seed for Royal Tandoor — 9 categories, 50 items,
 * variants, and reusable customization groups.
 *
 * Run AFTER royal-tandoor.js (needs the tenant row to exist).
 * Run:  node backend/db/seeds/royal-tandoor-menu.js
 *       (from kravon-engine/backend/)
 *
 * Idempotent — clears existing menu for this tenant before inserting.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const SLUG = 'royal-tandoor';

// ─── Customization group templates ───────────────────────────────────────────
// Applied by name reference in ITEMS below.

const CUST_GROUPS = {
  'Spice Level': {
    group_type:  'radio',
    is_required: true,
    options: [
      { name: 'Mild',       price_modifier: 0, sort_order: 0 },
      { name: 'Medium',     price_modifier: 0, sort_order: 1 },
      { name: 'Hot',        price_modifier: 0, sort_order: 2 },
      { name: 'Extra Hot',  price_modifier: 0, sort_order: 3 },
    ],
  },
  'Extras': {
    group_type:  'checkbox',
    is_required: false,
    options: [
      { name: 'Extra Butter',  price_modifier: 30,  sort_order: 0 },
      { name: 'Extra Cheese',  price_modifier: 50,  sort_order: 1 },
      { name: 'Extra Chicken', price_modifier: 120, sort_order: 2 },
      { name: 'Extra Egg',     price_modifier: 40,  sort_order: 3 },
      { name: 'Extra Raita',   price_modifier: 50,  sort_order: 4 },
    ],
  },
  'Bread Upgrade': {
    group_type:  'checkbox',
    is_required: false,
    options: [
      { name: 'Garlic Butter',    price_modifier: 20, sort_order: 0 },
      { name: 'Cheese Stuffing',  price_modifier: 60, sort_order: 1 },
      { name: 'Extra Butter',     price_modifier: 15, sort_order: 2 },
    ],
  },
};

// ─── Categories + items ───────────────────────────────────────────────────────
// price: null when variants are used instead.
// customizations: array of CUST_GROUPS keys.

const MENU = [
  {
    name: 'Appetizers',
    description: 'Starters from the clay oven',
    position: 0,
    items: [
      {
        name: 'Paneer Tikka',
        price: 395,
        food_type: 'veg',
        description: 'Cottage cheese cubes marinated with spices and char-grilled in the tandoor.',
        tags: ['best-seller', 'tandoor'],
      },
      {
        name: 'Hara Bhara Kebab',
        price: 325,
        food_type: 'veg',
        description: 'Spinach and green pea patties served with mint chutney.',
      },
      {
        name: 'Dahi Ke Kebab',
        price: 365,
        food_type: 'veg',
        description: 'Crisp yogurt kebabs with aromatic spices.',
      },
      {
        name: 'Tandoori Mushroom',
        price: 345,
        food_type: 'veg',
        description: 'Button mushrooms marinated and roasted in clay ovens.',
      },
      {
        name: 'Chicken Tikka',
        price: 475,
        food_type: 'non_veg',
        description: 'Boneless chicken marinated overnight and cooked in the tandoor.',
        tags: ['best-seller'],
        customizations: ['Spice Level'],
      },
      {
        name: 'Murgh Malai Tikka',
        price: 525,
        food_type: 'non_veg',
        description: 'Creamy cheese-marinated chicken tikka finished in the tandoor.',
        tags: ['chef-special'],
      },
      {
        name: 'Tangdi Kebab',
        price: 545,
        food_type: 'non_veg',
        description: 'Juicy chicken drumsticks infused with royal spices.',
      },
      {
        name: 'Fish Tikka',
        price: 595,
        food_type: 'non_veg',
        description: 'Fresh fish cubes char-grilled with Indian herbs.',
      },
      {
        name: 'Tandoori Prawns',
        price: 695,
        food_type: 'non_veg',
        description: 'Jumbo prawns roasted in the tandoor.',
        tags: ['premium'],
      },
    ],
  },

  {
    name: 'Tandoor Specialties',
    description: 'Straight from the royal clay oven',
    position: 1,
    items: [
      {
        name: 'Tandoori Chicken',
        price: null,
        food_type: 'non_veg',
        description: "India's most iconic tandoor-roasted chicken.",
        customizations: ['Spice Level'],
        variants: [
          { name: 'Half', price: 449 },
          { name: 'Full', price: 799 },
        ],
      },
      {
        name: 'Afghani Chicken',
        price: null,
        food_type: 'non_veg',
        description: 'Rich creamy chicken cooked with cashew and cheese marinade.',
        variants: [
          { name: 'Half', price: 499 },
          { name: 'Full', price: 899 },
        ],
      },
      {
        name: 'Royal Tandoor Mixed Grill',
        price: 1295,
        food_type: 'non_veg',
        description: 'Assorted kebabs, chicken, fish and prawns served on a sizzling platter.',
        tags: ['chef-special', 'sharing'],
      },
      {
        name: 'Tandoori Pomfret',
        price: 895,
        food_type: 'non_veg',
        description: 'Whole pomfret marinated and roasted over open flames.',
      },
      {
        name: 'Tandoori Jumbo Prawns',
        price: 995,
        food_type: 'non_veg',
        description: 'Premium prawns cooked in traditional clay ovens.',
      },
    ],
  },

  {
    name: 'Vegetarian Curries',
    description: 'Rich gravies and classic preparations',
    position: 2,
    items: [
      {
        name: 'Paneer Butter Masala',
        price: 445,
        food_type: 'veg',
        description: 'Cottage cheese simmered in rich tomato butter gravy.',
        tags: ['best-seller'],
      },
      {
        name: 'Kadai Paneer',
        price: 445,
        food_type: 'veg',
        description: 'Paneer tossed with peppers and aromatic spices.',
      },
      {
        name: 'Shahi Paneer',
        price: 475,
        food_type: 'veg',
        description: 'Royal paneer curry finished with cream and nuts.',
      },
      {
        name: 'Malai Kofta',
        price: 465,
        food_type: 'veg',
        description: 'Soft cottage cheese dumplings in creamy gravy.',
      },
      {
        name: 'Dal Makhani',
        price: 425,
        food_type: 'veg',
        description: 'Black lentils slow-cooked overnight.',
        tags: ['chef-special'],
      },
      {
        name: 'Chana Masala',
        price: 365,
        food_type: 'vegan',
        description: 'Chickpeas cooked in robust Punjabi spices.',
      },
      {
        name: 'Veg Kolhapuri',
        price: 395,
        food_type: 'vegan',
        description: 'Mixed vegetables in spicy Maharashtrian-style gravy.',
      },
    ],
  },

  {
    name: 'Chicken Curries',
    description: 'Bold North Indian chicken preparations',
    position: 3,
    items: [
      {
        name: 'Butter Chicken',
        price: 565,
        food_type: 'non_veg',
        description: 'Tandoori chicken finished in rich tomato butter sauce.',
        tags: ['signature', 'best-seller'],
        customizations: ['Spice Level', 'Extras'],
      },
      {
        name: 'Chicken Tikka Masala',
        price: 575,
        food_type: 'non_veg',
        description: 'Grilled chicken in a creamy spiced curry.',
      },
      {
        name: 'Chicken Lababdar',
        price: 595,
        food_type: 'non_veg',
        description: 'Rich North Indian curry with smoky flavours.',
      },
      {
        name: 'Dhaba Chicken',
        price: 525,
        food_type: 'non_veg',
        description: 'Rustic roadside-style chicken curry.',
      },
      {
        name: 'Royal Chicken Rara',
        price: 645,
        food_type: 'non_veg',
        description: 'Signature chicken curry finished with minced chicken.',
        tags: ['chef-special'],
      },
    ],
  },

  {
    name: 'Mutton Curries',
    description: 'Slow-cooked lamb and mutton classics',
    position: 4,
    items: [
      {
        name: 'Rogan Josh',
        price: 725,
        food_type: 'non_veg',
        description: 'Kashmiri-style lamb curry with aromatic spices.',
      },
      {
        name: 'Mutton Rara',
        price: 795,
        food_type: 'non_veg',
        description: 'Tender mutton cooked with spiced minced meat.',
      },
      {
        name: 'Nalli Nihari',
        price: 845,
        food_type: 'non_veg',
        description: 'Slow-cooked marrow-rich mutton stew.',
        tags: ['chef-special'],
      },
      {
        name: 'Bhuna Gosht',
        price: 775,
        food_type: 'non_veg',
        description: 'Dry-style mutton preparation with bold spices.',
      },
    ],
  },

  {
    name: 'Biryani',
    description: 'Dum-cooked aromatic rice preparations',
    position: 5,
    items: [
      {
        name: 'Veg Dum Biryani',
        price: 445,
        food_type: 'veg',
        description: 'Fragrant rice layered with vegetables and saffron.',
      },
      {
        name: 'Egg Biryani',
        price: 495,
        food_type: 'egg',
        description: 'Aromatic rice layered with spiced eggs.',
      },
      {
        name: 'Chicken Dum Biryani',
        price: null,
        food_type: 'non_veg',
        description: 'Slow-cooked biryani sealed traditionally.',
        tags: ['best-seller'],
        customizations: ['Spice Level', 'Extras'],
        variants: [
          { name: 'Regular',     price: 595 },
          { name: 'Family Pack', price: 1095 },
        ],
      },
      {
        name: 'Mutton Dum Biryani',
        price: 745,
        food_type: 'non_veg',
        description: 'Tender lamb layered with fragrant basmati rice.',
      },
      {
        name: 'Royal Special Biryani',
        price: 895,
        food_type: 'non_veg',
        description: 'Signature house biryani featuring chicken, mutton and egg.',
        tags: ['signature'],
      },
    ],
  },

  {
    name: 'Indian Breads',
    description: 'Fresh from the tandoor',
    position: 6,
    items: [
      { name: 'Tandoori Roti',  price: 45,  food_type: 'veg' },
      { name: 'Butter Roti',    price: 55,  food_type: 'veg' },
      { name: 'Plain Naan',     price: 65,  food_type: 'veg' },
      { name: 'Butter Naan',    price: 75,  food_type: 'veg' },
      { name: 'Garlic Naan',    price: 95,  food_type: 'veg', tags: ['best-seller'] },
      { name: 'Cheese Naan',    price: 145, food_type: 'veg' },
      { name: 'Laccha Paratha', price: 95,  food_type: 'veg' },
    ],
  },

  {
    name: 'Desserts',
    description: 'Sweet endings',
    position: 7,
    items: [
      {
        name: 'Gulab Jamun',
        price: 195,
        food_type: 'veg',
        description: 'Warm syrup-soaked milk dumplings.',
      },
      {
        name: 'Rasmalai',
        price: 245,
        food_type: 'veg',
        description: 'Soft cottage cheese discs in saffron milk.',
      },
      {
        name: 'Kulfi Falooda',
        price: 295,
        food_type: 'veg',
        description: 'Traditional kulfi served with falooda.',
      },
      {
        name: 'Gulab Jamun Cheesecake',
        price: 345,
        food_type: 'veg',
        description: 'Modern fusion dessert combining two favourites.',
        tags: ['chef-special', 'new'],
      },
    ],
  },

  {
    name: 'Beverages',
    description: 'Refreshing drinks and lassis',
    position: 8,
    items: [
      { name: 'Sweet Lassi',   price: 145, food_type: 'veg' },
      { name: 'Mango Lassi',   price: 175, food_type: 'veg' },
      { name: 'Masala Chaas',  price: 125, food_type: 'veg' },
      { name: 'Fresh Lime Soda', price: 135, food_type: 'vegan' },
      { name: 'Cold Coffee',   price: 195, food_type: 'veg' },
      {
        name: 'House Mocktail Collection',
        price: null,
        food_type: 'vegan',
        variants: [
          { name: 'Virgin Mojito',      price: 245 },
          { name: 'Blue Lagoon',        price: 245 },
          { name: 'Mango Mint Cooler',  price: 245 },
          { name: 'Tropical Sunset',    price: 245 },
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

    // Resolve tenant
    const tenantRes = await client.query(
      `SELECT id FROM tenant.restaurants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
      [SLUG]
    );
    if (!tenantRes.rows.length) throw new Error(`Tenant not found for slug: ${SLUG}. Run royal-tandoor.js first.`);
    const tenantId = tenantRes.rows[0].id;
    console.log(`[royal-tandoor-menu] tenant_id: ${tenantId}`);

    // Get or create menu container
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

    // Wipe existing menu for idempotent re-seed
    await client.query(
      `UPDATE menu.customization_options SET deleted_at = NOW()
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );
    await client.query(
      `UPDATE menu.customization_groups SET deleted_at = NOW()
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );
    await client.query(
      `UPDATE menu.item_variants SET deleted_at = NOW()
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );
    await client.query(
      `UPDATE menu.menu_items SET deleted_at = NOW()
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );
    await client.query(
      `UPDATE menu.categories SET deleted_at = NOW()
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId]
    );
    console.log('[royal-tandoor-menu] existing menu cleared');

    // Insert categories, items, variants, customizations
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

        // Variants
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

        // Customization groups
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
            const groupId = groupRes.rows[0].id;

            for (let o = 0; o < groupDef.options.length; o++) {
              const opt = groupDef.options[o];
              await client.query(
                `INSERT INTO menu.customization_options
                   (tenant_id, group_id, name, price_modifier, sort_order)
                 VALUES ($1,$2,$3,$4,$5)`,
                [tenantId, groupId, opt.name, opt.price_modifier, opt.sort_order]
              );
            }
          }
        }
      }

      console.log(`[royal-tandoor-menu] ✓ ${cat.name} — ${cat.items.length} items`);
    }

    await client.query('COMMIT');
    console.log(`\n[royal-tandoor-menu] seed complete — 9 categories, ${totalItems} items.`);

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
    .catch(e => { console.error('[royal-tandoor-menu] failed:', e.message); process.exit(1); });
}
