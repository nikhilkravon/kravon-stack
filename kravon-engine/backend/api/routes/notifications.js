/**
 * ROUTE — notifications.js
 * GET  /v1/restaurants/:slug/notifications           — paginated list + unread count
 * POST /v1/restaurants/:slug/notifications/:id/read  — mark one read
 * POST /v1/restaurants/:slug/notifications/read-all  — mark all read
 */

'use strict';

const express  = require('express');
const { query } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireRestaurantAuth);

/* ── GET / ───────────────────────────────────────────────────────────────── */
router.get('/', async (req, res, next) => {
  try {
    const tenantId  = req.tenant.tenant_id;
    const unreadOnly = req.query.unread === 'true';
    const page  = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit = Math.min(100,   Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

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

    const total = parseInt(countRes.rows[0].total, 10);
    res.json({
      ok:            true,
      notifications: listRes.rows,
      total,
      unread_count:  parseInt(unreadRes.rows[0].unread, 10),
      page,
      limit,
      pages:         Math.ceil(total / limit),
    });
  } catch (err) { next(err); }
});

/* ── POST /read-all — must be before /:id/read to avoid param capture ────── */
router.post('/read-all', async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE notifications.notifications
       SET read_at = NOW()
       WHERE tenant_id = $1 AND read_at IS NULL
       RETURNING id`,
      [req.tenant.tenant_id]
    );
    res.json({ ok: true, count: result.rowCount });
  } catch (err) { next(err); }
});

/* ── POST /:id/read ──────────────────────────────────────────────────────── */
router.post('/:id/read', async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE notifications.notifications
       SET read_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND read_at IS NULL
       RETURNING id`,
      [req.params.id, req.tenant.tenant_id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Notification not found or already read' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
