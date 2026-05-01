const { Client } = require('pg');

(async () => {
  try {
    const client = new Client(process.env.DATABASE_URL);
    await client.connect();
    console.log('Connected to Railway DB');

    const result = await client.query(`
      SELECT schemaname, tablename
      FROM pg_tables
      WHERE schemaname IN ('public', 'tenant', 'dining')
      AND tablename LIKE '%reservation%'
      ORDER BY schemaname, tablename
    `);

    console.log('Reservations tables found:');
    console.log(result.rows);

    if (result.rows.length === 0) {
      console.log('No reservations tables found. Checking dining schema tables:');
      const diningTables = await client.query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'dining'
        ORDER BY tablename
      `);
      console.log('Dining schema tables:', diningTables.rows.map(r => r.tablename));
    }

    // Check if reservations table exists
    const existsResult = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'dining'
        AND table_name = 'reservations'
      )
    `);
    console.log('Does dining.reservations exist?', existsResult.rows[0].exists);

    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
})();