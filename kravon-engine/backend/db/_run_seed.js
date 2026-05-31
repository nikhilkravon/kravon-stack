'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, 'seeds', 'showcase_seed.sql'), 'utf8'
    );
    console.log('Running showcase_seed.sql...');
    await client.query(sql);
    console.log('Done.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
