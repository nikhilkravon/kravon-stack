const { query } = require('./db/pool');

(async () => {
  try {
    console.log('Checking for reservations tables...');

    const result = await query(`
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
      const diningTables = await query(`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'dining'
        ORDER BY tablename
      `);
      console.log('Dining schema tables:', diningTables.rows.map(r => r.tablename));
    }

    // Also check if reservations table exists in dining schema specifically
    try {
      const reservationsCheck = await query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'dining'
          AND table_name = 'reservations'
        )
      `);
      console.log('Does dining.reservations exist?', reservationsCheck.rows[0].exists);
    } catch (err) {
      console.log('Error checking reservations table:', err.message);
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    process.exit(0);
  }
})();