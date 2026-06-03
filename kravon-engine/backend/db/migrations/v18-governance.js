/**
 * MIGRATION — v18-governance.js
 * Implements data ownership & governance schema separation per DPDP Act requirements.
 *
 * New tables:
 *   customer.consent_history       — append-only consent event log (legally defensible)
 *   platform.export_jobs           — tracks tenant data export requests
 *   platform.customer_data_requests — DPDP compliance workflow (export/delete/correct)
 *   platform.benchmarks            — cross-tenant aggregated intelligence (NO tenant FK)
 *
 * Safe to re-run — all DDL guarded with IF NOT EXISTS.
 * Usage: node db/migrations/v18-governance.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [
  ['Create customer.consent_history — append-only consent event log',
    `CREATE TABLE IF NOT EXISTS customer.consent_history (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id  UUID        NOT NULL REFERENCES customer.customers(id),
      tenant_id    UUID        NOT NULL REFERENCES tenant.restaurants(id),
      consent_type TEXT        NOT NULL,
      granted      BOOLEAN     NOT NULL,
      source       TEXT        NOT NULL,
      ip_address   TEXT,
      user_agent   TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],

  ['Index consent_history by customer',
    `CREATE INDEX IF NOT EXISTS idx_consent_history_customer
     ON customer.consent_history(customer_id, created_at DESC)`],

  ['Index consent_history by tenant',
    `CREATE INDEX IF NOT EXISTS idx_consent_history_tenant
     ON customer.consent_history(tenant_id, created_at DESC)`],

  ['Create platform.export_jobs — tenant data export request tracker',
    `CREATE TABLE IF NOT EXISTS platform.export_jobs (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    UUID        NOT NULL REFERENCES tenant.restaurants(id),
      export_type  TEXT        NOT NULL DEFAULT 'full',
      status       TEXT        NOT NULL DEFAULT 'pending',
      storage_path TEXT,
      requested_by UUID,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )`],

  ['Index export_jobs by tenant',
    `CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant
     ON platform.export_jobs(tenant_id, requested_at DESC)`],

  ['Create platform.customer_data_requests — DPDP compliance workflow',
    `CREATE TABLE IF NOT EXISTS platform.customer_data_requests (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id   UUID        NOT NULL REFERENCES customer.customers(id),
      tenant_id     UUID        NOT NULL REFERENCES tenant.restaurants(id),
      request_type  TEXT        NOT NULL,
      status        TEXT        NOT NULL DEFAULT 'pending',
      requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at  TIMESTAMPTZ
    )`],

  ['Index customer_data_requests by customer',
    `CREATE INDEX IF NOT EXISTS idx_cdr_customer
     ON platform.customer_data_requests(customer_id, requested_at DESC)`],

  ['Index customer_data_requests by tenant',
    `CREATE INDEX IF NOT EXISTS idx_cdr_tenant
     ON platform.customer_data_requests(tenant_id, requested_at DESC)`],

  ['Create platform.benchmarks — cross-tenant aggregated intelligence (no tenant FK)',
    `CREATE TABLE IF NOT EXISTS platform.benchmarks (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      metric_name  TEXT        NOT NULL,
      dimension    TEXT        NOT NULL,
      value        NUMERIC     NOT NULL,
      sample_count INTEGER     NOT NULL,
      period_start DATE        NOT NULL,
      period_end   DATE        NOT NULL,
      computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],

  ['Index benchmarks by metric and dimension',
    `CREATE INDEX IF NOT EXISTS idx_benchmarks_metric
     ON platform.benchmarks(metric_name, dimension, period_end DESC)`],
];

(async () => {
  console.log('Running V18 migration (data ownership & governance)...\n');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [label, sql] of STEPS) {
      await client.query(sql);
      console.log(`  ✓ ${label}`);
    }
    await client.query('COMMIT');
    console.log('\nV18 migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\n  ✗ V18 migration failed: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
})();
