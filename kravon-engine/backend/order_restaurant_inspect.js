const { Client } = require('pg');
const client = new Client(process.env.DATABASE_URL);
(async () => {
  try {
    await client.connect();
    const res = await client.query(`
      SELECT r.slug, o.rest_id, o.status, o.total_amount, o.payment_method, o.created_at
      FROM public.orders o
      JOIN public.restaurants r ON o.rest_id = r.rest_id
      ORDER BY o.id
    `);
    console.table(res.rows);
  } catch (err) {
    console.error(err.message);
  } finally {
    await client.end();
  }
})();
