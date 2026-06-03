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
    // 1. Wipe all schemas
    console.log('Dropping schemas...');
    await client.query(`
      DROP SCHEMA IF EXISTS tenant        CASCADE;
      DROP SCHEMA IF EXISTS brand         CASCADE;
      DROP SCHEMA IF EXISTS menu          CASCADE;
      DROP SCHEMA IF EXISTS customer      CASCADE;
      DROP SCHEMA IF EXISTS orders        CASCADE;
      DROP SCHEMA IF EXISTS payments      CASCADE;
      DROP SCHEMA IF EXISTS dining        CASCADE;
      DROP SCHEMA IF EXISTS catering      CASCADE;
      DROP SCHEMA IF EXISTS insights      CASCADE;
      DROP SCHEMA IF EXISTS platform      CASCADE;
      DROP SCHEMA IF EXISTS inventory     CASCADE;
      DROP SCHEMA IF EXISTS notifications CASCADE;
    `);
    console.log('  schemas dropped.');

    // 2. Wipe legacy flat tables in public
    console.log('Dropping legacy public tables...');
    await client.query(`
      DROP TABLE IF EXISTS public.restaurants  CASCADE;
      DROP TABLE IF EXISTS public.orders       CASCADE;
      DROP TABLE IF EXISTS public.menu_items   CASCADE;
      DROP TABLE IF EXISTS public.reviews      CASCADE;
      DROP TABLE IF EXISTS public.sessions     CASCADE;
      DROP TABLE IF EXISTS public.tables       CASCADE;
      DROP TABLE IF EXISTS public.migrations   CASCADE;
    `);
    console.log('  legacy tables dropped.');

    // 3. Drop ENUMs in public schema
    const enumsRes = await client.query(`
      SELECT typname FROM pg_type
      WHERE typtype = 'e'
        AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    `);
    for (const row of enumsRes.rows) {
      await client.query(`DROP TYPE IF EXISTS "${row.typname}" CASCADE`);
    }
    console.log(`  ${enumsRes.rows.length} ENUMs dropped.`);

    // 4. Apply v20 canonical schema
    console.log('Applying kravon_schema_v20.sql...');
    const schema = fs.readFileSync(
      path.join(__dirname, 'kravon_schema_v20.sql'), 'utf8'
    );
    await client.query(schema);
    console.log('  schema applied.');

    // 5. Apply seed
    console.log('Applying kravon_seed_v12.sql...');
    const seed = fs.readFileSync(
      path.join(__dirname, 'seeds', 'kravon_seed_v12.sql'), 'utf8'
    );
    await client.query(seed);
    console.log('  seed applied.');

    console.log('\nDB reset complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});
