require('dotenv').config();

(async () => {
  try {
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const res = await client.query('SELECT id, name, slug, status FROM tenant.restaurants ORDER BY id DESC LIMIT 20');
    console.log(JSON.stringify(res.rows, null, 2));
    await client.end();
  } catch (err) {
    console.error('Query failed:', err.message);
    process.exit(1);
  }
})();
