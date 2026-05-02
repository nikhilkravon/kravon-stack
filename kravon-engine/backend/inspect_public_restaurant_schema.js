const { Client } = require('pg');
const client = new Client(process.env.DATABASE_URL);
(async () => {
  try {
    await client.connect();
    const defaultRes = await client.query(`
      SELECT column_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'restaurants'
        AND column_name = 'rest_id'
    `);
    console.log(defaultRes.rows);
    const seqRes = await client.query(`
      SELECT pg_get_serial_sequence('public.restaurants', 'rest_id') AS seq
    `);
    console.log('serial sequence:', seqRes.rows);
    const maxRes = await client.query(`SELECT MAX(rest_id) AS max_rest_id FROM public.restaurants`);
    console.log('max rest_id:', maxRes.rows[0].max_rest_id);
  } catch (err) {
    console.error(err.message);
  } finally {
    await client.end();
  }
})();
