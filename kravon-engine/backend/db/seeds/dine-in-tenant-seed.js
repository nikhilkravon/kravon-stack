/**
 * SEED — dine-in-tenant-seed.js
 * Seeds the v12 tenant schema rows required for dine-in to function.
 *
 * What this seeds:
 *   tenant.restaurants   — Dead Flat Co (Spice of India already exists)
 *   tenant.locations     — one primary location per restaurant
 *   dining.tables        — 8 tables for Spice of India (Dead Flat Co is delivery-only)
 *
 * Fixed UUIDs follow the project convention:
 *   a1xxxxxx  = tenant.restaurants
 *   a2xxxxxx  = tenant.locations
 *   c1xxxxxx  = dining.tables (Spice of India)
 *
 * Usage: node db/seeds/dine-in-tenant-seed.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { query } = require('../pool');

/* ── Fixed UUIDs ────────────────────────────────────────────────────────── */
const SPICE_TENANT_UUID    = 'a1000000-0000-0000-0000-000000000001';
const SPICE_LOCATION_UUID  = 'a2000000-0000-0000-0000-000000000001'; // already exists
const DFC_TENANT_UUID      = 'a1000000-0000-0000-0000-000000000002';
const DFC_LOCATION_UUID    = 'a2000000-0000-0000-0000-000000000002';

/* ── tenant.restaurants ─────────────────────────────────────────────────── */
async function seedTenantRestaurants() {
  // Spice of India should already exist — upsert is safe
  await query(`
    INSERT INTO tenant.restaurants
      (id, slug, name, plan, status, has_presence, has_orders, has_tables, has_catering, has_insights, settings)
    VALUES
      ($1, 'spice-of-india', 'Spice of India', 'growth', 'active', true, true, true, true, true, '{}'),
      ($2, 'dead-flat-co',   'Dead Flat Co',   'growth', 'active', true, true, false, false, false, '{}')
    ON CONFLICT (id) DO NOTHING
  `, [SPICE_TENANT_UUID, DFC_TENANT_UUID]);
  console.log('  ✓ tenant.restaurants');
}

/* ── tenant.locations ───────────────────────────────────────────────────── */
async function seedTenantLocations() {
  // Spice of India location already exists — skip; insert Dead Flat Co
  await query(`
    INSERT INTO tenant.locations
      (id, tenant_id, name, city, country, timezone, is_active, metadata)
    VALUES
      ($1, $2, 'Dead Flat Co Delivery Hub', 'Mumbai', 'IN', 'Asia/Kolkata', true, '{}')
    ON CONFLICT (id) DO NOTHING
  `, [DFC_LOCATION_UUID, DFC_TENANT_UUID]);
  console.log('  ✓ tenant.locations');
}

/* ── dining.tables (Spice of India only — Dead Flat Co is delivery-only) ─ */
const SPICE_TABLES = [
  { id: 'c1000000-0000-0000-0000-000000000001', name: 'T1', capacity: 2, floor: 'Ground' },
  { id: 'c1000000-0000-0000-0000-000000000002', name: 'T2', capacity: 2, floor: 'Ground' },
  { id: 'c1000000-0000-0000-0000-000000000003', name: 'T3', capacity: 4, floor: 'Ground' },
  { id: 'c1000000-0000-0000-0000-000000000004', name: 'T4', capacity: 4, floor: 'Ground' },
  { id: 'c1000000-0000-0000-0000-000000000005', name: 'T5', capacity: 4, floor: 'Ground' },
  { id: 'c1000000-0000-0000-0000-000000000006', name: 'T6', capacity: 6, floor: 'Ground' },
  { id: 'c1000000-0000-0000-0000-000000000007', name: 'T7', capacity: 6, floor: 'Mezzanine' },
  { id: 'c1000000-0000-0000-0000-000000000008', name: 'T8', capacity: 8, floor: 'Mezzanine' },
];

async function seedDiningTables() {
  for (const t of SPICE_TABLES) {
    await query(`
      INSERT INTO dining.tables
        (id, tenant_id, location_id, name, capacity, floor, status, qr_code, is_active)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'available', gen_random_uuid()::TEXT, true)
      ON CONFLICT (id) DO NOTHING
    `, [t.id, SPICE_TENANT_UUID, SPICE_LOCATION_UUID, t.name, t.capacity, t.floor]);
    console.log(`  ✓ dining.tables: Spice of India ${t.name} (capacity ${t.capacity})`);
  }
}

/* ── Run ────────────────────────────────────────────────────────────────── */
(async () => {
  console.log('Running dine-in tenant seed...\n');
  try {
    await seedTenantRestaurants();
    await seedTenantLocations();
    await seedDiningTables();
    console.log('\nDine-in tenant seed complete.');
  } catch (err) {
    console.error(`\n  ✗ Seed failed: ${err.message}`);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
