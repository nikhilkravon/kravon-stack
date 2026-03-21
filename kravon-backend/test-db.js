require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10_000,
});

async function test() {
  try {
    const client = await pool.connect();
    const res = await client.query('SELECT NOW()');
    console.log('Connected successfully:', res.rows[0]);
    client.release();
    pool.end();
  } catch (err) {
    console.error('Connection failed:', err.message);
    pool.end();
  }
}

test();