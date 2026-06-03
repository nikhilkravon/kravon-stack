'use strict';

/**
 * audit.js — fire-and-forget writes to platform.audit_log.
 * Never throws — a failed audit write must never block the business operation.
 *
 * Usage:
 *   audit.log(client, { tenantId, actorId, actorType, action, entityType, entityId,
 *                       oldValue, newValue, req })
 *
 * Within an open transaction pass the pg client so the audit row is part of
 * the same transaction. Pass null to use the shared pool instead.
 */

const { query } = require('../db/pool');

/**
 * @param {import('pg').PoolClient|null} client  - open transaction client, or null
 * @param {object} opts
 * @param {string}  opts.tenantId
 * @param {string}  [opts.actorId]
 * @param {'staff'|'system'|'customer'} [opts.actorType='staff']
 * @param {string}  opts.action       - e.g. 'session.open', 'config.update'
 * @param {string}  [opts.entityType] - e.g. 'dining.session', 'tenant.restaurant'
 * @param {string}  [opts.entityId]
 * @param {object}  [opts.oldValue]   - maps to before_state column
 * @param {object}  [opts.newValue]   - maps to after_state column
 * @param {object}  [opts.req]        - Express req, for ip/user-agent
 */
async function log(client, {
  tenantId, actorId = null, actorType = 'staff',
  action, entityType = null, entityId = null,
  oldValue = null, newValue = null,
  req = null,
} = {}) {
  const ip        = req ? (req.ip || null) : null;
  const userAgent = req ? (req.headers?.['user-agent'] || null) : null;

  const sql = `
    INSERT INTO platform.audit_log
      (tenant_id, actor_id, actor_type, action, entity_type, entity_id,
       before_state, after_state, ip_address, user_agent)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
  `;
  const params = [
    tenantId, actorId, actorType, action, entityType, entityId,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    ip, userAgent,
  ];

  try {
    if (client) {
      await client.query(sql, params);
    } else {
      await query(sql, params);
    }
  } catch (err) {
    // Never let audit failure surface to the caller.
    console.error(JSON.stringify({ level: 'error', event: 'audit_write_failed',
      action, tenantId, message: err.message }));
  }
}

module.exports = { log };
