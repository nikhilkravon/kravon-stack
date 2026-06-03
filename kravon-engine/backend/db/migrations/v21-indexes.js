/**
 * MIGRATION — v21-indexes.js
 * Performance indexes for all high-traffic query paths.
 *
 * Identified from route analysis:
 *
 *   orders.js      — GET /orders filters on (tenant_id, status), (tenant_id, channel)
 *   leads.js       — GET /leads filters on (tenant_id, status), orders by created_at DESC
 *   customers.js   — GET /customers filters on tenant_id, orders by created_at DESC
 *   dine-in.js     — session open checks (table_id, closed_at IS NULL)
 *                  — kitchen/bill queries (tenant_id, session_id, status)
 *   reviews.js     — GET reviews filters on tenant_id
 *   notifications  — GET /notifications filters on (tenant_id, expires_at > NOW(), read_at)
 *   audit_log      — high-write table, needs tenant+created_at for log viewers
 *   platform.export_jobs / customer_data_requests — governance queries
 *
 * All steps are idempotent — safe to re-run.
 * Usage: node db/migrations/v21-indexes.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [

  // ── orders.orders ─────────────────────────────────────────────────────────
  // GET /orders filters by (tenant_id, status) — existing idx_orders_status covers
  // (tenant_id, status) but not the composite with created_at for sorted pages.
  // The hot query: WHERE tenant_id=$1 AND status IN (...) ORDER BY created_at DESC
  ['orders: composite (tenant_id, status, created_at DESC) for paginated filtered list',
    `CREATE INDEX IF NOT EXISTS idx_orders_tenant_status_time
     ON orders.orders(tenant_id, status, created_at DESC)
     WHERE deleted_at IS NULL`],

  // GET /orders?channel=qr — channel filter on top of tenant
  ['orders: composite (tenant_id, channel, created_at DESC) for channel-filtered list',
    `CREATE INDEX IF NOT EXISTS idx_orders_tenant_channel_time
     ON orders.orders(tenant_id, channel, created_at DESC)
     WHERE deleted_at IS NULL`],

  // order_items JOIN on order_id — already indexed, confirm exists
  ['order_items: index on order_id (confirm)',
    `CREATE INDEX IF NOT EXISTS idx_order_items_order
     ON orders.order_items(order_id)`],

  // ── catering.leads ────────────────────────────────────────────────────────
  // GET /leads filters on (tenant_id, status), orders by created_at DESC
  // idx_leads_status exists but is (tenant_id, status) — add time for sorted pages
  ['leads: composite (tenant_id, status, created_at DESC) for paginated filtered list',
    `CREATE INDEX IF NOT EXISTS idx_leads_tenant_status_time
     ON catering.leads(tenant_id, status, created_at DESC)
     WHERE deleted_at IS NULL`],

  // ── customer.customers ────────────────────────────────────────────────────
  // GET /customers orders by created_at DESC — existing idx_customers_tenant covers
  // tenant_id but not sorted. Add composite for pagination.
  ['customers: composite (tenant_id, created_at DESC) for sorted paginated list',
    `CREATE INDEX IF NOT EXISTS idx_customers_tenant_time
     ON customer.customers(tenant_id, created_at DESC)
     WHERE deleted_at IS NULL`],

  // customers.js joins orders ON customer_id to compute order counts
  ['orders: index on customer_id + tenant_id for CRM join',
    `CREATE INDEX IF NOT EXISTS idx_orders_customer_tenant
     ON orders.orders(customer_id, tenant_id)
     WHERE deleted_at IS NULL AND customer_id IS NOT NULL`],

  // ── dining.sessions ───────────────────────────────────────────────────────
  // dine-in kitchen view: WHERE session_id = $1 AND o.tenant_id = $2
  // order_items joined on order_id — already covered.
  // orders joined on session_id — no index on session_id currently
  ['orders: index on session_id for dine-in kitchen/bill queries',
    `CREATE INDEX IF NOT EXISTS idx_orders_session
     ON orders.orders(session_id)
     WHERE session_id IS NOT NULL AND deleted_at IS NULL`],

  // dining.sessions open check: WHERE table_id=$1 AND closed_at IS NULL
  // idx_sessions_table_open (unique) covers this — confirm it exists
  ['sessions: unique partial index on table_id for open-session check (confirm)',
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_table_open
     ON dining.sessions(table_id)
     WHERE closed_at IS NULL AND deleted_at IS NULL`],

  // ── dining.reservations ───────────────────────────────────────────────────
  // GET /dine-in/reservations filters on tenant_id + status, orders by reservation_time
  ['reservations: composite (tenant_id, status, reservation_time) for filtered list',
    `CREATE INDEX IF NOT EXISTS idx_reservations_tenant_status_time
     ON dining.reservations(tenant_id, status, reservation_time DESC)
     WHERE deleted_at IS NULL`],

  // ── dining.reviews ────────────────────────────────────────────────────────
  // GET /reviews filters on tenant_id, orders by created_at DESC
  ['reviews: composite (tenant_id, created_at DESC) for sorted list',
    `CREATE INDEX IF NOT EXISTS idx_reviews_tenant_time
     ON dining.reviews(tenant_id, created_at DESC)
     WHERE deleted_at IS NULL`],

  // ── notifications.notifications ───────────────────────────────────────────
  // GET /notifications: WHERE tenant_id=$1 AND expires_at > NOW()
  // Partial index on unread already covers the unread fast-path.
  // Add covering index for the expires_at filter used on every read.
  ['notifications: composite (tenant_id, expires_at) for non-expired filter',
    `CREATE INDEX IF NOT EXISTS idx_notifications_tenant_expires
     ON notifications.notifications(tenant_id, expires_at)
     WHERE expires_at IS NOT NULL`],

  // ── platform.audit_log ────────────────────────────────────────────────────
  // High-write append-only table. idx_audit_log_tenant exists.
  // Add actor_type index for filtering by system/staff/customer in admin views.
  ['audit_log: index on (tenant_id, actor_type, created_at DESC)',
    `CREATE INDEX IF NOT EXISTS idx_audit_log_actor_type
     ON platform.audit_log(tenant_id, actor_type, created_at DESC)
     WHERE tenant_id IS NOT NULL`],

  // ── platform.export_jobs ──────────────────────────────────────────────────
  // idx_export_jobs_tenant exists from v18. Add status for dashboard filtering.
  ['export_jobs: index on (tenant_id, status) for pending/done filtering',
    `CREATE INDEX IF NOT EXISTS idx_export_jobs_status
     ON platform.export_jobs(tenant_id, status)`],

  // ── platform.customer_data_requests ──────────────────────────────────────
  // idx_cdr_tenant exists. Add status for workflow queue filtering.
  ['customer_data_requests: index on (tenant_id, status) for pending queue',
    `CREATE INDEX IF NOT EXISTS idx_cdr_status
     ON platform.customer_data_requests(tenant_id, status)`],

  // ── tenant.staff ──────────────────────────────────────────────────────────
  // Auth login lookup: WHERE email=$1 AND tenant_id=$2 AND deleted_at IS NULL
  // idx_staff_email_unique covers (tenant_id, email) — already optimal.
  // Add index on password_hash IS NOT NULL for login route filtering.
  ['staff: index on (tenant_id, is_active) for staff list queries',
    `CREATE INDEX IF NOT EXISTS idx_staff_tenant_active
     ON tenant.staff(tenant_id, is_active)
     WHERE deleted_at IS NULL`],

  // ── menu.menu_items ───────────────────────────────────────────────────────
  // Public menu GET: WHERE tenant_id=$1 AND deleted_at IS NULL AND is_available=TRUE
  // idx_menu_items_tenant covers tenant+deleted_at. Add is_available for public menu.
  ['menu_items: composite (tenant_id, is_available) for public menu queries',
    `CREATE INDEX IF NOT EXISTS idx_menu_items_available
     ON menu.menu_items(tenant_id, is_available)
     WHERE deleted_at IS NULL`],

  // ── Register in schema_migrations ─────────────────────────────────────────
  // Done outside the transaction in main(), same as v20.

];

(async () => {
  console.log('Running V21 migration (performance indexes)...\n');

  const client = await getClient();

  try {
    await client.query('BEGIN');

    for (const [label, sql] of STEPS) {
      try {
        await client.query(sql);
        console.log(`  ✓ ${label}`);
      } catch (err) {
        console.error(`  ✗ ${label}`);
        console.error(`    ${err.message}`);
        throw err;
      }
    }

    await client.query('COMMIT');
    console.log('\n  ✓ All indexes created.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nV21 migration FAILED — rolled back.');
    console.error(err.message);
    client.release();
    process.exit(1);
  }

  // Record in schema_migrations (idempotent)
  try {
    await client.query(
      `INSERT INTO platform.schema_migrations (version, name)
       VALUES ('v21', 'performance-indexes')
       ON CONFLICT (version) DO NOTHING`
    );
    console.log('  ✓ Recorded in platform.schema_migrations');
  } catch (err) {
    // schema_migrations may not exist on older installs that skipped v20
    console.warn('  ! Could not record in schema_migrations:', err.message);
  }

  client.release();
  console.log('\nV21 complete.');
  process.exit(0);
})();
