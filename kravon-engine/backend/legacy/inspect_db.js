const { Client } = require('pg');
const client = new Client(process.env.DATABASE_URL);

(async () => {
  try {
    await client.connect();
    console.log('Connected to Railway DB');

    const res = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema IN ('public','tenant','dining')
      AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name
    `);
    console.log('TABLES:');
    res.rows.forEach(r => console.log(`${r.table_schema}.${r.table_name}`));

    const checks = ['dining.reservations','dining.events','public.users','public.orders','public.order_items'];
    console.log('\nCOUNTS:');
    for (const entry of checks) {
      const [schema, name] = entry.split('.');
      try {
        const count = await client.query(`SELECT COUNT(*) AS cnt FROM ${schema}.${name}`);
        console.log(`${entry}: ${count.rows[0].cnt}`);
      } catch (err) {
        console.log(`${entry}: missing or no access`);
      }
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
})();
