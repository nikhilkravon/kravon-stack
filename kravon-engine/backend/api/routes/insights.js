/**
 * ROUTE — insights.js
 * GET /v1/restaurants/:slug/insights/summary
 * GET /v1/restaurants/:slug/insights/orders
 *
 * Analytics aggregations for the Insights dashboard.
 * All routes require admin JWT.
 *
 * Schema notes (v12):
 *   orders live in  orders.orders      (tenant_id, not rest_id)
 *   customers in    customer.customers  (no order_count column — computed)
 *   leads in        catering.leads      (status enum, not tier)
 *   All tables use soft-deletes (deleted_at IS NULL guard required).
 *
 * Lead tier mapping:
 *   hot  → qualified | negotiating
 *   warm → contacted | proposal_sent
 *   cool → new | on_hold
 */

'use strict';

const express  = require('express');
const { query } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireRestaurantAuth);

/* ── Summary — last 30 days ──────────────────────────────────────────────── */
router.get('/summary', async (req, res, next) => {
  try {
    const id = req.tenant.rest_id;
    const [ordersRes, leadsRes, repeatRes] = await Promise.all([
      query(`
        SELECT
          COUNT(*)                    AS total_orders,
          SUM(total_amount)           AS gross_revenue,
          AVG(total_amount)           AS avg_order_value,
          COUNT(DISTINCT customer_id) AS unique_customers
        FROM orders.orders
        WHERE tenant_id = $1
          AND status = 'delivered'
          AND deleted_at IS NULL
          AND created_at > NOW() - INTERVAL '30 days'
      `, [id]),

      query(`
        SELECT
          COUNT(*) AS total_leads,
          COUNT(*) FILTER (WHERE status IN ('qualified', 'negotiating'))     AS hot,
          COUNT(*) FILTER (WHERE status IN ('contacted', 'proposal_sent'))   AS warm,
          COUNT(*) FILTER (WHERE status IN ('new', 'on_hold'))               AS cool
        FROM catering.leads
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND created_at > NOW() - INTERVAL '30 days'
      `, [id]),

      query(`
        SELECT COUNT(*) AS repeat_customers
        FROM (
          SELECT customer_id
          FROM orders.orders
          WHERE tenant_id = $1
            AND deleted_at IS NULL
            AND customer_id IS NOT NULL
          GROUP BY customer_id
          HAVING COUNT(*) > 1
        ) sub
      `, [id]),
    ]);

    res.json({
      ok: true,
      period: '30d',
      orders:    ordersRes.rows[0],
      leads:     leadsRes.rows[0],
      customers: repeatRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

/* ── Orders by day ───────────────────────────────────────────────────────── */
router.get('/orders', async (req, res, next) => {
  try {
    const id      = req.tenant.rest_id;
    const rawDays = parseInt(req.query.days, 10);
    const days    = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 30;

    const result = await query(`
      SELECT
        DATE_TRUNC('day', created_at) AS day,
        COUNT(*)                      AS order_count,
        SUM(total_amount)             AS revenue
      FROM orders.orders
      WHERE tenant_id = $1
        AND status NOT IN ('cancelled')
        AND deleted_at IS NULL
        AND created_at > NOW() - INTERVAL '1 day' * $2
      GROUP BY 1
      ORDER BY 1
    `, [id, days]);

    res.json({ ok: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
