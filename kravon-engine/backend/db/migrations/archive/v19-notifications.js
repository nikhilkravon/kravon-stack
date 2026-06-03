/**
 * MIGRATION — v19-notifications.js
 * Creates the notifications event infrastructure.
 *
 *   notifications schema       — isolated from tenant/platform schemas
 *   notifications.notifications — in-app notification store (90-day TTL via expires_at)
 *   tenant.notification_preferences — per-tenant on/off toggles per event type
 *
 * Safe to re-run — all DDL guarded with IF NOT EXISTS.
 * Usage: node db/migrations/v19-notifications.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const STEPS = [
  ['Create notifications schema',
    `CREATE SCHEMA IF NOT EXISTS notifications`],

  ['Create notifications.notifications table',
    `CREATE TABLE IF NOT EXISTS notifications.notifications (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID        NOT NULL REFERENCES tenant.restaurants(id),
      type        TEXT        NOT NULL,
      priority    TEXT        NOT NULL DEFAULT 'INFO',
      title       TEXT        NOT NULL,
      body        TEXT,
      entity_type TEXT,
      entity_id   UUID,
      actor_type  TEXT,
      actor_id    UUID,
      metadata    JSONB       NOT NULL DEFAULT '{}',
      read_at     TIMESTAMPTZ,
      expires_at  TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],

  ['Index notifications by tenant (unread fast-path)',
    `CREATE INDEX IF NOT EXISTS idx_notifications_tenant_unread
     ON notifications.notifications(tenant_id, created_at DESC)
     WHERE read_at IS NULL`],

  ['Index notifications by tenant (all)',
    `CREATE INDEX IF NOT EXISTS idx_notifications_tenant
     ON notifications.notifications(tenant_id, created_at DESC)`],

  ['Index notifications by expires_at (future cleanup job)',
    `CREATE INDEX IF NOT EXISTS idx_notifications_expires
     ON notifications.notifications(expires_at)
     WHERE expires_at IS NOT NULL`],

  ['Create tenant.notification_preferences table',
    `CREATE TABLE IF NOT EXISTS tenant.notification_preferences (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   UUID        NOT NULL UNIQUE REFERENCES tenant.restaurants(id),
      preferences JSONB       NOT NULL DEFAULT '{}'::jsonb,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`],
];

(async () => {
  console.log('Running V19 migration (notifications & event infrastructure)...\n');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [label, sql] of STEPS) {
      await client.query(sql);
      console.log(`  ✓ ${label}`);
    }
    await client.query('COMMIT');
    console.log('\nV19 migration complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\n  ✗ V19 migration failed: ${err.message}`);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
})();
