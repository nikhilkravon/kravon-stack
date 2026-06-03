'use strict';

/**
 * notification.service.js — In-app notification writer.
 *
 * Called only by notification.listeners.js.
 * Business routes must never import this directly — they emit events.
 *
 * Responsibilities:
 *   - Check tenant.notification_preferences (absent key = enabled)
 *   - Insert into notifications.notifications with 90-day expiry
 *   - Never throw — failures are logged and swallowed
 */

const { query } = require('../db/pool');

/**
 * @param {object} opts
 * @param {string}  opts.tenantId
 * @param {string}  opts.type        - event type: 'order.created'
 * @param {string}  opts.priority    - INFO | SUCCESS | WARNING | CRITICAL
 * @param {string}  opts.title
 * @param {string}  [opts.body]
 * @param {string}  [opts.entityType]
 * @param {string}  [opts.entityId]
 * @param {string}  [opts.actorType] - 'staff' | 'customer' | 'system'
 * @param {string}  [opts.actorId]
 * @param {object}  [opts.metadata]
 */
async function create({
  tenantId, type, priority = 'INFO', title, body = null,
  entityType = null, entityId = null,
  actorType = null, actorId = null,
  metadata = {},
}) {
  try {
    // Check per-tenant preference — absent key defaults to enabled (true)
    const prefRes = await query(
      `SELECT preferences->$2 AS enabled
       FROM tenant.notification_preferences
       WHERE tenant_id = $1`,
      [tenantId, type]
    );
    if (prefRes.rows.length && prefRes.rows[0].enabled === false) return;

    await query(
      `INSERT INTO notifications.notifications
         (tenant_id, type, priority, title, body,
          entity_type, entity_id, actor_type, actor_id, metadata, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() + INTERVAL '90 days')`,
      [tenantId, type, priority, title, body,
       entityType, entityId || null, actorType, actorId || null,
       JSON.stringify(metadata)]
    );
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error', event: 'notification_write_failed',
      type, tenantId, message: err.message,
    }));
  }
}

module.exports = { create };
