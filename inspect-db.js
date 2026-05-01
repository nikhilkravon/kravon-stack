/**
 * Quick database inspection script
 * Lists all tables and sample data
 */
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:fCxAtglgstOexCzeTXVjWxadgoxVkkSy@turntable.proxy.rlwy.net:17128/railway'
});

async function inspect() {
  try {
    await client.connect();
    console.log('✅ Connected to Railway PostgreSQL\n');

    // Get all tables
    const tablesQuery = `
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    `;
    const tablesResult = await client.query(tablesQuery);
    console.log('📊 TABLES IN DATABASE:\n');
    const tablesBySchema = {};
    tablesResult.rows.forEach(row => {
      if (!tablesBySchema[row.table_schema]) {
        tablesBySchema[row.table_schema] = [];
      }
      tablesBySchema[row.table_schema].push(row.table_name);
    });

    for (const schema in tablesBySchema) {
      console.log(`\n  Schema: ${schema}`);
      tablesBySchema[schema].forEach(table => {
        console.log(`    - ${table}`);
      });
    }

    // Get row counts
    console.log('\n\n📈 ROW COUNTS PER TABLE:\n');
    for (const schema in tablesBySchema) {
      for (const table of tablesBySchema[schema]) {
        const countResult = await client.query(`SELECT COUNT(*) as count FROM ${schema}.${table}`);
        const count = countResult.rows[0].count;
        if (count > 0) {
          console.log(`  ${schema}.${table}: ${count} rows`);
        }
      }
    }

    // Sample data from key tables
    console.log('\n\n📋 SAMPLE DATA FROM KEY TABLES:\n');

    // Tenants
    console.log('--- TENANT SCHEMA ---');
    const tenantResult = await client.query('SELECT id, name, slug FROM tenant.restaurants LIMIT 3');
    console.log('Restaurants:');
    console.log(tenantResult.rows);

    // Locations
    const locResult = await client.query('SELECT id, name, restaurant_id FROM tenant.locations LIMIT 3');
    console.log('\nLocations:');
    console.log(locResult.rows);

    // Menu items
    console.log('\n--- MENU SCHEMA ---');
    const menuResult = await client.query('SELECT id, name, price FROM menu.menu_items LIMIT 5');
    console.log('Menu Items:');
    console.log(menuResult.rows);

    // Customers
    console.log('\n--- CUSTOMER SCHEMA ---');
    const custResult = await client.query('SELECT id, phone, email FROM customer.customers LIMIT 3');
    console.log('Customers:');
    console.log(custResult.rows);

    // Orders
    console.log('\n--- ORDERS SCHEMA ---');
    const orderResult = await client.query('SELECT id, customer_phone, total, status FROM orders.orders LIMIT 5');
    console.log('Orders:');
    console.log(orderResult.rows);

    // Check if data exists in tables
    console.log('\n\n🔍 DATA EXISTENCE CHECK:\n');
    const checks = [
      { schema: 'tenant', table: 'restaurants', label: 'Restaurants' },
      { schema: 'tenant', table: 'locations', label: 'Locations' },
      { schema: 'menu', table: 'menus', label: 'Menus' },
      { schema: 'menu', table: 'menu_items', label: 'Menu Items' },
      { schema: 'customer', table: 'customers', label: 'Customers' },
      { schema: 'orders', table: 'orders', label: 'Orders' },
      { schema: 'payments', table: 'payments', label: 'Payments' },
      { schema: 'dining', table: 'tables', label: 'Dining Tables' },
      { schema: 'catering', table: 'leads', label: 'Catering Leads' }
    ];

    for (const check of checks) {
      const result = await client.query(`SELECT COUNT(*) as count FROM ${check.schema}.${check.table}`);
      const count = result.rows[0].count;
      const status = count > 0 ? '✅' : '❌';
      console.log(`  ${status} ${check.label}: ${count} records`);
    }

    console.log('\n✅ Database inspection complete!\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

inspect();
