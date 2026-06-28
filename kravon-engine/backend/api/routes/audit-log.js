'use strict';

/**
 * ROUTE — audit-log.js
 * GET /v1/restaurants/:slug/audit-log
 *
 * Reads platform.audit_log for the current tenant.
 * Supports: search, date range, actor filter, action filter, entity filter.
 * Requires staff JWT (owner/admin — sensitive operational data).
 */

const express = require('express');
const { query } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireRestaurantAuth);

const ACTION_LABELS = {
  'session.open':       'Session Opened',
  'session.close':      'Session Closed',
  'order.status_update': 'Order Status Updated',
  'config.update':      'Config Updated',
  'menu.item_create':   'Menu Item Created',
  'menu.item_update':   'Menu Item Updated',
  'menu.item_delete':   'Menu Item Deleted',
  'staff.create':       'Staff Added',
  'staff.update':       'Staff Updated',
  'staff.delete':       'Staff Removed',
  'settings.update':    'Settings Changed',
  'auth.login':         'Staff Login',
  'auth.logout':        'Staff Logout',
  'auth.password_reset': 'Password Reset',
};

router.get('/', async (req, res, next) => {
  try {
    const id     = req.tenant.tenant_id;
    const page   = Math.min(10000, Math.max(1, parseInt(req.query.page,  10) || 1));
    const limit  = Math.min(100,   Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const params  = [id];
    const filters = ['a.tenant_id = $1'];

    if (req.query.action) {
      params.push(req.query.action);
      filters.push(`a.action = $${params.length}`);
    }
    if (req.query.actor_id) {
      params.push(req.query.actor_id);
      filters.push(`a.actor_id = $${params.length}::uuid`);
    }
    if (req.query.entity_type) {
      params.push(req.query.entity_type);
      filters.push(`a.entity_type = $${params.length}`);
    }
    if (req.query.date_from) {
      params.push(req.query.date_from);
      filters.push(`a.created_at >= $${params.length}`);
    }
    if (req.query.date_to) {
      params.push(req.query.date_to);
      filters.push(`a.created_at <  $${params.length}`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      const p = params.length;
      filters.push(`(a.action ILIKE $${p} OR st.name ILIKE $${p} OR st.email ILIKE $${p})`);
    }

    const where = filters.join(' AND ');

    const [rows, countRes] = await Promise.all([
      query(
        `SELECT
           a.id, a.action, a.actor_type, a.entity_type, a.entity_id,
           a.before_state, a.after_state, a.ip_address, a.created_at,
           st.name  AS actor_name,
           st.email AS actor_email
         FROM platform.audit_log a
         LEFT JOIN tenant.staff st ON st.id = a.actor_id AND st.tenant_id = a.tenant_id
         WHERE ${where}
         ORDER BY a.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM platform.audit_log a
         LEFT JOIN tenant.staff st ON st.id = a.actor_id AND st.tenant_id = a.tenant_id
         WHERE ${where}`,
        params
      ),
    ]);

    const total = parseInt(countRes.rows[0].total, 10);
    res.json({
      ok: true,
      logs: rows.rows,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      action_labels: ACTION_LABELS,
    });
  } catch (err) { next(err); }
});

/* ── GET /audit-log/actions — list distinct actions for filter dropdown ───── */
router.get('/actions', async (req, res, next) => {
  try {
    const res2 = await query(
      `SELECT DISTINCT action FROM platform.audit_log
       WHERE tenant_id = $1 ORDER BY action`,
      [req.tenant.tenant_id]
    );
    res.json({ ok: true, actions: res2.rows.map(r => r.action) });
  } catch (err) { next(err); }
});

module.exports = router;
