'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { query } = require('../pool');

const TENANT_ID = 'a3000000-0000-0000-0000-000000000001';
const SLUG = 'dummy-presence';
const NAME = 'Dummy Presence Co';

async function upsertPublicRestaurant() {
  const result = await query(`
    INSERT INTO restaurants (
      slug, name, tagline, year, phone, wa_number, email,
      address, city, hours_display, open_until,
      has_presence, has_tables, has_orders, has_catering, has_insights,
      delivery_fee, free_delivery_above, allowed_origin, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
    )
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      tagline = EXCLUDED.tagline,
      year = EXCLUDED.year,
      phone = EXCLUDED.phone,
      wa_number = EXCLUDED.wa_number,
      email = EXCLUDED.email,
      address = EXCLUDED.address,
      city = EXCLUDED.city,
      hours_display = EXCLUDED.hours_display,
      open_until = EXCLUDED.open_until,
      has_presence = EXCLUDED.has_presence,
      has_tables = EXCLUDED.has_tables,
      has_orders = EXCLUDED.has_orders,
      has_catering = EXCLUDED.has_catering,
      has_insights = EXCLUDED.has_insights,
      delivery_fee = EXCLUDED.delivery_fee,
      free_delivery_above = EXCLUDED.free_delivery_above,
      allowed_origin = EXCLUDED.allowed_origin,
      updated_at = NOW()
    RETURNING rest_id
  `, [
    SLUG,
    NAME,
    'A test restaurant for Presence + Orders',
    '2026',
    '+91 90000 00000',
    '919000000000',
    'hello@dummypresence.in',
    'Unit 101, Test Plaza, New Delhi',
    'New Delhi',
    'Mon – Sun: 10:00 AM – 10:00 PM',
    '10:00 PM',
    true,
    false,
    true,
    false,
    false,
    4900,
    49900,
    'https://dummypresence.in',
    '2026-05-02T00:00:00Z',
    '2026-05-02T00:00:00Z'
  ]);
  return result.rows[0].rest_id;
}

async function upsertTenantRestaurant() {
  await query(`
    INSERT INTO tenant.restaurants (
      id, slug, name, plan, status,
      has_presence, has_orders, has_tables, has_catering, has_insights, settings
    ) VALUES (
      $1,$2,$3,'full','active',true,true,false,false,false,'{}'
    )
    ON CONFLICT (id) DO NOTHING
  `, [TENANT_ID, SLUG, NAME]);
}

async function ensureMenuCategory() {
  const existing = await query(
    'SELECT id FROM menu_categories WHERE tenant_id = $1 AND name = $2 LIMIT 1',
    [TENANT_ID, 'Dummy Menu']
  );
  if (existing.rows.length) {
    return existing.rows[0].id;
  }

  const result = await query(`
    INSERT INTO menu_categories (tenant_id, name, subtitle, active, sort_order)
    VALUES ($1, $2, $3, true, 1)
    RETURNING id
  `, [TENANT_ID, 'Dummy Menu', 'Test menu for dummy restaurant']);
  return result.rows[0].id;
}

async function ensureMenuItem(categoryId) {
  const existing = await query(
    'SELECT id FROM menu_items WHERE tenant_id = $1 AND name = $2 LIMIT 1',
    [TENANT_ID, 'Dummy Burger']
  );
  if (existing.rows.length) {
    return existing.rows[0].id;
  }

  const result = await query(`
    INSERT INTO menu_items (
      tenant_id, category_id, name, price_paise, description,
      image, image_bg, badge, badge_style, customisable, active, sort_order
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true,1)
    RETURNING id
  `, [
    TENANT_ID,
    categoryId,
    'Dummy Burger',
    24900,
    'Simple test burger for the dummy restaurant.',
    '🍔',
    'linear-gradient(135deg,#2a1800,#4a2a08,#3a1800)',
    'Test',
    'top'
  ]);
  return result.rows[0].id;
}

async function ensureAddons() {
  const existing = await query(
    'SELECT id FROM menu_addons WHERE tenant_id = $1 LIMIT 1',
    [TENANT_ID]
  );
  if (existing.rows.length) return;

  const addons = [
    ['Extra Cheese', 3000, 1],
    ['Extra Patty',  8000, 2],
    ['Add Egg',      2500, 3],
    ['Extra Sauce',  1000, 4],
  ];

  for (const [label, price_paise, sort_order] of addons) {
    await query(
      'INSERT INTO menu_addons (tenant_id, label, price_paise, active, sort_order) VALUES ($1,$2,$3,true,$4)',
      [TENANT_ID, label, price_paise, sort_order]
    );
  }
}

async function ensureSpiceLevels() {
  const existing = await query(
    'SELECT id FROM spice_levels WHERE tenant_id = $1 LIMIT 1',
    [TENANT_ID]
  );
  if (existing.rows.length) return;

  const levels = ['Mild', 'Medium', 'Spicy', 'Extra Spicy'];
  for (let i = 0; i < levels.length; i++) {
    await query(
      'INSERT INTO spice_levels (tenant_id, label, sort_order) VALUES ($1,$2,$3)',
      [TENANT_ID, levels[i], i + 1]
    );
  }
}

async function ensureDummyOrder(restId, itemId) {
  const existing = await query(
    'SELECT id FROM orders WHERE rest_id = $1 AND customer_phone = $2 AND special_notes = $3 LIMIT 1',
    [restId, '9000000000', 'Dummy restaurant seed order']
  );
  if (existing.rows.length) {
    return existing.rows[0].id;
  }

  const itemsJson = JSON.stringify([{
    id: itemId,
    name: 'Dummy Burger',
    price: 249,
    qty: 1,
    note: null,
    addons: [],
  }]);

  const result = await query(`
    INSERT INTO orders (
      rest_id, order_surface, table_identifier,
      customer_name, customer_phone,
      delivery_address, delivery_locality, delivery_landmark,
      items_json, special_notes,
      subtotal, delivery_fee, gst, total_amount,
      delivery_type, payment_method, payment_status,
      razorpay_order_id, status
    ) VALUES (
      $1, 'orders', NULL,
      'Test User', $2,
      '123 Dummy Lane', 'Test Locality', 'Near Seed Lab',
      $3, $4,
      24900, 4900, 0, 29800,
      'standard', 'cod', 'pending',
      NULL, 'confirmed'
    )
    RETURNING id
  `, [restId, '9000000000', itemsJson, 'Dummy restaurant seed order']);

  return result.rows[0].id;
}

(async () => {
  try {
    console.log('Seeding dummy presence restaurant...');
    const restId = await upsertPublicRestaurant();
    await upsertTenantRestaurant();
    const categoryId = await ensureMenuCategory();
    const itemId = await ensureMenuItem(categoryId);
    await ensureAddons();
    await ensureSpiceLevels();
    const orderId = await ensureDummyOrder(restId, itemId);
    console.log('Done. rest_id=', restId, 'order_id=', orderId);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  }
})();
