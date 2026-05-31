'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Change these before running
const SLUG     = 'spice-of-india';
const EMAIL    = 'rahul@spiceofindia.in';
const PASSWORD = 'admin1234';

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12);

  const tenantRes = await pool.query(
    'SELECT id FROM tenant.restaurants WHERE slug = $1',
    [SLUG]
  );
  if (!tenantRes.rows.length) {
    console.error('Restaurant not found:', SLUG);
    process.exit(1);
  }
  const tenantId = tenantRes.rows[0].id;

  const result = await pool.query(
    `UPDATE tenant.staff
     SET password_hash = $1
     WHERE tenant_id = $2 AND email = $3
     RETURNING id, name, email`,
    [hash, tenantId, EMAIL]
  );

  if (!result.rows.length) {
    console.error('Staff not found:', EMAIL);
    process.exit(1);
  }

  console.log('Password set for:', result.rows[0].name, `(${result.rows[0].email})`);
  await pool.end();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
