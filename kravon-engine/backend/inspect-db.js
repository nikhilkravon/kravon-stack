const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:fCxAtglgstOexCzeTXVjWxadgoxVkkSy@turntable.proxy.rlwy.net:17128/railway'
});

async function inspect() {
  try {
    await client.connect();
    console.log('\n✅ Connected to Railway PostgreSQL\n');

    const tablesResult = await client.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name
    `);
    
    console.log('📊 DATABASE SCHEMA:\n');
    const tablesBySchema = {};
    tablesResult.rows.forEach(row => {
      if (!tablesBySchema[row.table_schema]) tablesBySchema[row.table_schema] = [];
      tablesBySchema[row.table_schema].push(row.table_name);
    });

    for (const schema in tablesBySchema) {
      console.log(`\n  ${schema}:`);
      tablesBySchema[schema].forEach(table => console.log(`    • ${table}`));
    }

    console.log('\n\n📈 ROW COUNTS:\n');
    for (const schema in tablesBySchema) {
      for (const table of tablesBySchema[schema]) {
        try {
          const result = await client.query(`SELECT COUNT(*) as count FROM ${schema}.${table}`);
          const count = result.rows[0].count;
          if (count > 0) console.log(`  ${schema}.${table}: ${count} rows`);
        } catch (e) {}
      }
    }

    console.log('\n\n📋 SAMPLE DATA:\n');

    try {
      const rests = await client.query('SELECT id, name, slug FROM tenant.restaurants LIMIT 2');
      if (rests.rows.length > 0) {
        console.log('--- RESTAURANTS ---');
        rests.rows.forEach(r => console.log(`  • ${r.name} (${r.slug})`));
      }
    } catch (e) {}

    try {
      const locs = await client.query('SELECT id, name FROM tenant.locations LIMIT 2');
      if (locs.rows.length > 0) {
        console.log('\n--- LOCATIONS ---');
        locs.rows.forEach(l => console.log(`  • ${l.name}`));
      }
    } catch (e) {}

    try {
      const menus = await client.query('SELECT id, name, price FROM menu.menu_items LIMIT 3');
      if (menus.rows.length > 0) {
        console.log('\n--- MENU ITEMS ---');
        menus.rows.forEach(m => console.log(`  • ${m.name} - ₹${m.price}`));
      }
    } catch (e) {}

    try {
      const custs = await client.query('SELECT COUNT(*) as count FROM customer.customers');
      console.log(`\n--- CUSTOMERS: ${custs.rows[0].count} records ---`);
    } catch (e) {}

    try {
      const ords = await client.query('SELECT COUNT(*) as count FROM orders.orders');
      console.log(`--- ORDERS: ${ords.rows[0].count} records ---`);
    } catch (e) {}

    try {
      const pays = await client.query('SELECT COUNT(*) as count FROM payments.payments');
      console.log(`--- PAYMENTS: ${pays.rows[0].count} records ---`);
    } catch (e) {}

    console.log('\n✅ Complete!\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

inspect();
