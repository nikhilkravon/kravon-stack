'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { query } = require('../pool');

(async () => {
  try {
    const rest = await query(
      'SELECT rest_id, slug, name, has_presence, has_tables, has_orders FROM restaurants WHERE slug = $1',
      ['dummy-presence']
    );
    const tenant = await query(
      'SELECT id, slug, name, has_presence, has_tables, has_orders FROM tenant.restaurants WHERE slug = $1',
      ['dummy-presence']
    );
    const category = await query(
      'SELECT id, name, subtitle FROM menu_categories WHERE tenant_id = $1',
      ['a3000000-0000-0000-0000-000000000001']
    );
    const item = await query(
      'SELECT id, name, price_paise FROM menu_items WHERE tenant_id = $1',
      ['a3000000-0000-0000-0000-000000000001']
    );
    const order = await query(
      'SELECT id, rest_id, order_surface, customer_name, payment_method, total_amount, status FROM orders WHERE rest_id = $1',
      [11]
    );

    console.log('PUBLIC RESTAURANT:');
    console.table(rest.rows);
    console.log('TENANT RESTAURANT:');
    console.table(tenant.rows);
    console.log('MENU CATEGORY:');
    console.table(category.rows);
    console.log('MENU ITEM:');
    console.table(item.rows);
    console.log('ORDER:');
    console.table(order.rows);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
})();
