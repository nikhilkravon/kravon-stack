const { Client } = require('pg');
const client = new Client(process.env.DATABASE_URL);
(async () => {
  try {
    await client.connect();
    const tenantTables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'tenant'
      ORDER BY table_name
    `);
    console.log('TENANT TABLES:', tenantTables.rows.map(r => r.table_name));

    const tenantRestaurantCols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'tenant'
        AND table_name = 'restaurants'
      ORDER BY ordinal_position
    `);
    console.log('TENANT.RESTAURANTS COLUMNS:', tenantRestaurantCols.rows.map(r => r.column_name));

    const tenantRestaurants = await client.query(`SELECT * FROM tenant.restaurants LIMIT 5`);
    console.log('tenant.restaurants SAMPLE:');
    console.table(tenantRestaurants.rows);

    const publicRestCols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'restaurants'
      ORDER BY ordinal_position
    `);
    console.log('PUBLIC.RESTAURANTS COLUMNS:', publicRestCols.rows.map(r => r.column_name));
  } catch (err) {
    console.error(err.message);
  } finally {
    await client.end();
  }
})();
