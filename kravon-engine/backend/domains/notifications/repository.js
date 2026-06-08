'use strict';

const { query } = require('../../db/pool');

async function list(tenantId, { page = 1, limit = 20, unreadOnly = false } = {}) {
  const offset  = (page - 1) * limit;
  const filters = ['tenant_id = $1', `(expires_at IS NULL OR expires_at > NOW())`];
  if (unreadOnly) filters.push('read_at IS NULL');
  const where = `WHERE ${filters.join(' AND ')}`;

  const [listRes, countRes, unreadRes] = await Promise.all([
    query(
      `SELECT id, type, priority, title, body, entity_type, entity_id,
              actor_type, actor_id, metadata, read_at, created_at
       FROM notifications.notifications
       ${where}
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset]
    ),
    query(`SELECT COUNT(*) AS total FROM notifications.notifications ${where}`, [tenantId]),
    query(
      `SELECT COUNT(*) AS unread FROM notifications.notifications
       WHERE tenant_id = $1 AND read_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
      [tenantId]
    ),
  ]);

  return {
    notifications: listRes.rows,
    total:         parseInt(countRes.rows[0].total, 10),
    unread_count:  parseInt(unreadRes.rows[0].unread, 10),
  };
}

async function markRead(tenantId, notificationId) {
  const res = await query(
    `UPDATE notifications.notifications
     SET read_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND read_at IS NULL
     RETURNING id`,
    [notificationId, tenantId]
  );
  return res.rowCount > 0;
}

async function markAllRead(tenantId) {
  const res = await query(
    `UPDATE notifications.notifications
     SET read_at = NOW()
     WHERE tenant_id = $1 AND read_at IS NULL
     RETURNING id`,
    [tenantId]
  );
  return res.rowCount;
}

module.exports = { list, markRead, markAllRead };
