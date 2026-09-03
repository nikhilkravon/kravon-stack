'use strict';

/**
 * SEED — cafe-bodhi-tree-menu.js
 *
 * Full menu seed for Café Bodhi Tree — 12 categories, 67 items
 * (pure vegetarian). Beverages & Smoothies is seeded empty pending
 * the drink menu.
 *
 * Run AFTER cafe-bodhi-tree.js (needs the tenant row to exist).
 * Run:  node backend/db/seeds/cafe-bodhi-tree-menu.js
 *       (from kravon-engine/backend/)
 *
 * Idempotent — clears existing menu for this tenant before inserting.
 *
 * NOTE: prices are not yet finalized for this pre-launch tenant. All
 * items are seeded at price 0 (or variant price 0) as a placeholder —
 * update real prices via the dashboard Menu view before going live.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const SLUG = 'cafe-bodhi-tree';

// ─── Categories + items ───────────────────────────────────────────────────────
// price: null when variants are used instead.

const MENU = [
  {
    name: 'Bodhi Beginnings',
    description: 'South Indian breakfast classics to start the morning',
    position: 0,
    items: [
      {
        name: 'Idli',
        price: null,
        food_type: 'veg',
        description: 'Soft steamed South Indian rice cakes, served with your choice of ghee or podi.',
        variants: [
          { name: 'Ghee', price: 0 },
          { name: 'Podi', price: 0 },
        ],
      },
      {
        name: 'Dosa',
        price: null,
        food_type: 'veg',
        description: 'Classic South Indian crepe, available in a choice of traditional preparations.',
        variants: [
          { name: 'Plain', price: 0 },
          { name: 'Masala', price: 0 },
          { name: 'Mysore', price: 0 },
          { name: 'Set Dosa', price: 0 },
        ],
      },
      {
        name: 'Uttapam',
        price: 0,
        food_type: 'veg',
        description: 'Thick, soft South Indian savoury pancake.',
      },
      {
        name: 'Ghee Podi Dosa',
        price: 0,
        food_type: 'veg',
        description: 'Crisp dosa finished with fragrant ghee and spicy podi.',
      },
      {
        name: 'Sheera',
        price: 0,
        food_type: 'veg',
        description: 'Traditional Indian semolina sweet with a rich, comforting texture.',
      },
      {
        name: 'Ban Maska',
        price: 0,
        food_type: 'veg',
        description: 'Soft bun generously spread with creamy maska.',
      },
    ],
  },

  {
    name: 'Warm & Wholesome',
    description: 'Soups',
    position: 1,
    items: [
      {
        name: 'Tomato Basil Soup',
        price: 0,
        food_type: 'veg',
        description: 'Comforting tomato soup with the fresh, aromatic character of basil.',
      },
      {
        name: 'Broccoli Almond Soup',
        price: 0,
        food_type: 'veg',
        description: 'Smooth, nourishing broccoli soup enriched with the subtle nuttiness of almonds.',
      },
      {
        name: 'Hot & Sour Soup',
        price: 0,
        food_type: 'veg',
        description: 'A warming Indo-Chinese soup balancing spicy heat with a tangy finish.',
      },
    ],
  },

  {
    name: 'Bites Under the Tree',
    description: 'Appetizers and small plates',
    position: 2,
    items: [
      {
        name: 'Paneer Tikka',
        price: 0,
        food_type: 'veg',
        description: 'Grilled cottage cheese marinated with aromatic Indian spices.',
      },
      {
        name: 'Jhara Bhara Kebab',
        price: 0,
        food_type: 'veg',
        description: 'A flavourful vegetarian kebab packed with spiced vegetables and herbs.',
      },
      {
        name: 'Masala Cheese Corn Ball',
        price: 0,
        food_type: 'veg',
        description: 'Crispy golden bites filled with a savoury blend of cheese, corn and spices.',
      },
      {
        name: 'French Fries',
        price: null,
        food_type: 'veg',
        description: 'Crisp golden fries with a choice of indulgent and spicy finishes.',
        variants: [
          { name: 'Peri Peri', price: 0 },
          { name: 'Truffle & Parmesan', price: 0 },
        ],
      },
      {
        name: 'Spicy Vegetable Tacos',
        price: 0,
        food_type: 'veg',
        description: 'Vibrant vegetable-filled tacos with a spicy kick.',
      },
      {
        name: 'Spicy Cottage Cheese Tacos',
        price: 0,
        food_type: 'veg',
        description: 'Soft tacos filled with spiced cottage cheese for a rich, satisfying bite.',
      },
      {
        name: 'Loaded Nachos',
        price: 0,
        food_type: 'veg',
        description: 'Crispy nachos piled high with flavourful toppings.',
      },
      {
        name: 'Honey Chilli Potato Spring Roll',
        price: 0,
        food_type: 'veg',
        description: 'Crispy spring rolls featuring chilli-seasoned potato with a sweet honey finish.',
      },
      {
        name: 'Tangra Chilli Paneer',
        price: 0,
        food_type: 'veg',
        description: 'Indo-Chinese style paneer tossed in a bold, spicy chilli sauce.',
      },
      {
        name: 'Crispy Corn',
        price: 0,
        food_type: 'veg',
        description: 'Crunchy golden corn tossed with savoury seasoning.',
      },
      {
        name: 'Chips & Dip',
        price: 0,
        food_type: 'veg',
        description: 'Crisp chips served with a flavourful dipping accompaniment.',
      },
      {
        name: 'Garlic Bread',
        price: 0,
        food_type: 'veg',
        description: 'Toasted bread infused with aromatic garlic and herbs.',
      },
      {
        name: 'Cheese Chilli Garlic Toast',
        price: 0,
        food_type: 'veg',
        description: 'Toasted bread layered with cheese, chilli and fragrant garlic.',
      },
      {
        name: 'Avocado & Feta Cheese Crostini',
        price: 0,
        food_type: 'veg',
        description: 'Crisp crostini topped with creamy avocado and tangy feta cheese.',
      },
      {
        name: 'Truffle Mushroom Crostini',
        price: 0,
        food_type: 'veg',
        description: 'Crisp crostini topped with earthy mushrooms and an aromatic truffle touch.',
      },
    ],
  },

  {
    name: 'Chaat & Street Stories',
    description: 'Chaat platter',
    position: 3,
    items: [
      {
        name: 'Pani Puri',
        price: 0,
        food_type: 'veg',
        description: 'Crisp puris filled with flavourful spiced water and traditional chaat accompaniments.',
      },
      {
        name: 'Shev Puri',
        price: 0,
        food_type: 'veg',
        description: 'Crisp puris layered with classic chaat toppings and finished with crunchy shev.',
      },
      {
        name: 'Dahi Puri',
        price: 0,
        food_type: 'veg',
        description: 'Crisp puris filled with creamy yoghurt and vibrant chaat flavours.',
      },
      {
        name: 'Ragda Puri',
        price: 0,
        food_type: 'veg',
        description: 'Crisp puris paired with hearty ragda and traditional chaat flavours.',
      },
    ],
  },

  {
    name: 'Wood-Fired Stories',
    description: 'Pizzas',
    position: 4,
    items: [
      {
        name: 'Margherita Pizza',
        price: 0,
        food_type: 'veg',
        description: 'A classic Italian pizza with tomato, mozzarella and fragrant basil.',
      },
      {
        name: 'Farmhouse Veggie Supreme Pizza',
        price: 0,
        food_type: 'veg',
        description: 'A generous vegetarian pizza loaded with fresh, flavourful vegetables.',
      },
      {
        name: 'Burrata Mozzarella Pizza with Basil Pesto',
        price: 0,
        food_type: 'veg',
        description: 'A rich, indulgent pizza combining creamy burrata mozzarella with aromatic basil pesto.',
        tags: ['signature'],
      },
      {
        name: 'Pizza Al Funghi with Truffle Oil',
        price: 0,
        food_type: 'veg',
        description: 'An earthy mushroom pizza elevated with the distinctive aroma of truffle oil.',
        tags: ['signature'],
      },
    ],
  },

  {
    name: 'Pasta Your Way',
    description: 'Pasta',
    position: 5,
    items: [
      {
        name: 'Make Your Own Pasta',
        price: 0,
        food_type: 'veg',
        description: 'Build your pasta your way with your choice of preparation and flavours.',
      },
      {
        name: 'Arrabbiata',
        price: 0,
        food_type: 'veg',
        description: 'Pasta tossed in a vibrant, spicy tomato-based Arrabbiata sauce.',
      },
      {
        name: 'Alfredo',
        price: 0,
        food_type: 'veg',
        description: 'Creamy pasta coated in a rich and comforting Alfredo sauce.',
      },
      {
        name: 'Basil Pesto',
        price: 0,
        food_type: 'veg',
        description: 'Pasta tossed in aromatic basil pesto for a fresh, herbaceous finish.',
      },
    ],
  },

  {
    name: 'East Meets West',
    description: 'Indo-Asian',
    position: 6,
    items: [
      {
        name: 'Stir-Fried Asian Vegetables in Black Pepper Sauce',
        price: 0,
        food_type: 'veg',
        description: 'Fresh vegetables stir-fried with a bold, aromatic black pepper sauce.',
      },
      {
        name: 'Vegetables in Hot Garlic Sauce',
        price: 0,
        food_type: 'veg',
        description: 'Tender vegetables tossed in a spicy, fragrant hot garlic sauce.',
      },
      {
        name: 'Vegetable Hakka Noodles / Rice',
        price: null,
        food_type: 'veg',
        description: 'Classic Indo-Chinese preparation with vegetables, available with noodles or rice.',
        variants: [
          { name: 'Hakka Noodles', price: 0 },
          { name: 'Rice', price: 0 },
        ],
      },
      {
        name: 'Szechwan Vegetable Noodles / Rice',
        price: null,
        food_type: 'veg',
        description: 'Vegetables tossed in a fiery Szechwan preparation, served with noodles or rice.',
        variants: [
          { name: 'Noodles', price: 0 },
          { name: 'Rice', price: 0 },
        ],
      },
      {
        name: 'Chilli Garlic Noodles / Rice',
        price: null,
        food_type: 'veg',
        description: 'Aromatic noodles or rice tossed with chilli and garlic for a bold, savoury finish.',
        variants: [
          { name: 'Noodles', price: 0 },
          { name: 'Rice', price: 0 },
        ],
      },
    ],
  },

  {
    name: 'From the Indian Kitchen',
    description: 'Indian mains',
    position: 7,
    items: [
      {
        name: 'Paneer Tikka Masala',
        price: 0,
        food_type: 'veg',
        description: 'Tender paneer cooked in a rich, aromatic tomato-based masala.',
      },
      {
        name: 'Matar Paneer',
        price: 0,
        food_type: 'veg',
        description: 'A comforting combination of paneer and green peas in a flavourful Indian gravy.',
      },
      {
        name: 'Paneer Khurchan',
        price: 0,
        food_type: 'veg',
        description: 'Sliced paneer cooked with vegetables and aromatic spices for a rich, savoury preparation.',
      },
      {
        name: 'Subz Miloni',
        price: 0,
        food_type: 'veg',
        description: 'A colourful medley of seasonal vegetables prepared in a rich, flavourful Indian gravy.',
      },
      {
        name: 'Bharwa Bhendi',
        price: 0,
        food_type: 'veg',
        description: 'Tender okra filled with a fragrant spiced stuffing and cooked to perfection.',
      },
      {
        name: 'Jeera Aloo',
        price: 0,
        food_type: 'veg',
        description: 'Potatoes tossed with cumin and aromatic Indian spices for a simple, comforting classic.',
      },
      {
        name: 'Aloo Matar',
        price: 0,
        food_type: 'veg',
        description: 'Potatoes and green peas cooked together in a comforting Indian-style gravy.',
      },
      {
        name: 'Mushroom Masala',
        price: 0,
        food_type: 'veg',
        description: 'Mushrooms cooked in a rich, aromatic masala gravy.',
      },
      {
        name: 'Dal Makhani',
        price: 0,
        food_type: 'veg',
        description: 'Slow-cooked black lentils prepared into a rich and creamy classic.',
      },
      {
        name: 'Dal Fry',
        price: 0,
        food_type: 'veg',
        description: 'Yellow lentils tempered with aromatic spices for a comforting everyday classic.',
      },
      {
        name: 'Dal Tadka',
        price: 0,
        food_type: 'veg',
        description: 'Comforting lentils finished with a fragrant tempering of spices.',
      },
    ],
  },

  {
    name: 'Rice & Comfort',
    description: 'Rice and biryani',
    position: 8,
    items: [
      {
        name: 'Steamed Rice',
        price: 0,
        food_type: 'veg',
        description: 'Simple, fluffy steamed rice — a comforting accompaniment to Indian curries and dals.',
      },
      {
        name: 'Jeera Rice',
        price: 0,
        food_type: 'veg',
        description: 'Fragrant basmati rice tempered with aromatic cumin.',
      },
      {
        name: 'Green Peas Pulao',
        price: 0,
        food_type: 'veg',
        description: 'Fragrant rice cooked with sweet green peas and subtle spices.',
      },
      {
        name: 'Veg Pulao',
        price: 0,
        food_type: 'veg',
        description: 'Aromatic rice cooked with a colourful medley of vegetables and spices.',
      },
      {
        name: 'Veg Biryani / Paneer Biryani',
        price: null,
        food_type: 'veg',
        description: 'Fragrant, spiced biryani available in a vegetable or paneer preparation.',
        variants: [
          { name: 'Veg Biryani', price: 0 },
          { name: 'Paneer Biryani', price: 0 },
        ],
      },
      {
        name: 'Dal Khichadi / Palak Dal Khichadi',
        price: null,
        food_type: 'veg',
        description: 'Wholesome lentil-and-rice comfort food, available in a classic or spinach-infused preparation.',
        tags: ['signature'],
        variants: [
          { name: 'Dal Khichadi', price: 0 },
          { name: 'Palak Dal Khichadi', price: 0 },
        ],
      },
      {
        name: 'Curd Rice',
        price: 0,
        food_type: 'veg',
        description: 'Cooling, comforting rice blended with creamy curd for a simple South Indian classic.',
      },
    ],
  },

  {
    name: 'Indian Breads',
    description: 'Rotis, naans and parathas',
    position: 9,
    items: [
      {
        name: 'Roti',
        price: 0,
        food_type: 'veg',
        description: 'Soft Indian flatbread, freshly prepared to pair with curries and dals.',
      },
      {
        name: 'Naan',
        price: 0,
        food_type: 'veg',
        description: 'Classic soft and lightly charred Indian flatbread, ideal with rich gravies.',
      },
      {
        name: 'Garlic Naan',
        price: 0,
        food_type: 'veg',
        description: 'Soft naan finished with aromatic garlic for an extra burst of flavour.',
      },
      {
        name: 'Cheese Chilli Garlic Naan',
        price: 0,
        food_type: 'veg',
        description: 'Indulgent naan layered with cheese, chilli and fragrant garlic.',
      },
      {
        name: 'Laccha Paratha',
        price: 0,
        food_type: 'veg',
        description: 'Flaky, layered Indian flatbread with a crisp exterior and soft centre.',
      },
      {
        name: 'Kulcha',
        price: null,
        food_type: 'veg',
        description: 'Soft, leavened Indian bread available with a choice of savoury fillings.',
        variants: [
          { name: 'Plain', price: 0 },
          { name: 'Aloo', price: 0 },
          { name: 'Paneer', price: 0 },
          { name: 'Mushroom', price: 0 },
          { name: 'Masala', price: 0 },
        ],
      },
    ],
  },

  {
    name: 'A Little Something Sweet',
    description: 'Desserts',
    position: 10,
    items: [
      {
        name: 'Gulab Jamun',
        price: 0,
        food_type: 'veg',
        description: 'Soft, syrup-soaked Indian sweet served warm and comforting.',
      },
      {
        name: 'Classic Chocolate Brownie',
        price: 0,
        food_type: 'veg',
        description: 'Rich, indulgent chocolate brownie with a soft, fudgy centre.',
      },
      {
        name: 'Tres Leches',
        price: 0,
        food_type: 'veg',
        description: 'A delicate, moist cake soaked in a rich three-milk preparation.',
      },
      {
        name: 'Choice of Ice Cream',
        price: 0,
        food_type: 'veg',
        description: 'A simple, refreshing way to finish your meal with your choice of ice cream.',
      },
    ],
  },

  {
    name: 'Beverages & Smoothies',
    description: 'Wellness beverages and smoothies — coming soon',
    position: 11,
    items: [],
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
    if (!tenantRes.rows.length) throw new Error(`Tenant not found for slug: ${SLUG}. Run cafe-bodhi-tree.js first.`);
    const tenantId = tenantRes.rows[0].id;
    console.log(`[cafe-bodhi-tree-menu] tenant_id: ${tenantId}`);

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
    console.log('[cafe-bodhi-tree-menu] existing menu cleared');

    // Insert categories, items, variants
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
      }

      console.log(`[cafe-bodhi-tree-menu] ✓ ${cat.name} — ${cat.items.length} items`);
    }

    await client.query('COMMIT');
    console.log(`\n[cafe-bodhi-tree-menu] seed complete — ${MENU.length} categories, ${totalItems} items.`);
    console.log('[cafe-bodhi-tree-menu] NOTE: all prices seeded at 0 (placeholder) — update via dashboard before launch.');

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
    .catch(e => { console.error('[cafe-bodhi-tree-menu] failed:', e.message); process.exit(1); });
}
