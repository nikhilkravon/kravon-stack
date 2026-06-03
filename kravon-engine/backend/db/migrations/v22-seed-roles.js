/**
 * MIGRATION — v22-seed-roles.js
 * Seeds the six system roles into every tenant that does not already have them.
 *
 * System roles:
 *   owner    — full access, only role that can manage staff
 *   manager  — operational access, cannot manage staff or billing
 *   cashier  — order management and billing view only
 *   kitchen  — kitchen display view only
 *   host     — reservations and tables only
 *   catering — catering leads and events only
 *
 * These role names are what the JWT carries (req.auth.roles) and what
 * requireRole() checks. They must exist in tenant.roles for the login
 * query to embed them in the token at login time.
 *
 * Idempotent — uses ON CONFLICT DO NOTHING on (tenant_id, name).
 * Safe to re-run.
 *
 * Usage: node db/migrations/v22-seed-roles.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const SYSTEM_ROLES = [
  { name: 'owner',    display_name: 'Owner',          description: 'Full platform access. Can manage staff, billing, and all settings.' },
  { name: 'manager',  display_name: 'Manager',         description: 'Operational access across orders, reservations, and catering. Cannot manage staff or billing.' },
  { name: 'cashier',  display_name: 'Cashier',         description: 'Order management and payment view. No settings access.' },
  { name: 'kitchen',  display_name: 'Kitchen Staff',   description: 'Kitchen display view only. Can see and update order status.' },
  { name: 'host',     display_name: 'Host / Captain',  description: 'Reservations, tables, and dine-in session management.' },
  { name: 'catering', display_name: 'Catering Staff',  description: 'Catering leads and events only.' },
];

(async () => {
  console.log('Running V22 migration (seed system roles)...\n');

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // Load all active tenants
    const tenantsRes = await client.query(
      `SELECT id, slug FROM tenant.restaurants WHERE deleted_at IS NULL ORDER BY created_at`
    );

    console.log(`  Found ${tenantsRes.rows.length} tenant(s).\n`);

    let totalInserted = 0;
    let totalSkipped  = 0;

    for (const tenant of tenantsRes.rows) {
      for (const role of SYSTEM_ROLES) {
        const res = await client.query(
          `INSERT INTO tenant.roles (tenant_id, name, display_name, description, is_system_role, is_active)
           VALUES ($1, $2, $3, $4, TRUE, TRUE)
           ON CONFLICT (tenant_id, name) DO NOTHING
           RETURNING id`,
          [tenant.id, role.name, role.display_name, role.description]
        );

        if (res.rows.length) {
          totalInserted++;
        } else {
          totalSkipped++;
        }
      }
      console.log(`  ✓ ${tenant.slug}`);
    }

    await client.query('COMMIT');

    console.log(`\n  Roles inserted: ${totalInserted}`);
    console.log(`  Roles already existed (skipped): ${totalSkipped}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nV22 migration FAILED — rolled back.');
    console.error(err.message);
    client.release();
    process.exit(1);
  }

  // Record in schema_migrations
  try {
    await client.query(
      `INSERT INTO platform.schema_migrations (version, name)
       VALUES ('v22', 'seed-system-roles')
       ON CONFLICT (version) DO NOTHING`
    );
    console.log('\n  ✓ Recorded in platform.schema_migrations');
  } catch {
    // schema_migrations may not exist on installs that skipped v20
  }

  client.release();
  console.log('\nV22 complete.');
  process.exit(0);
})();
