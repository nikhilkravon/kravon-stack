/**
 * ROUTE — insights.js
 * GET /v1/restaurants/:slug/insights/summary
 * GET /v1/restaurants/:slug/insights/orders
 * GET /v1/restaurants/:slug/insights/leads
 *
 * Analytics aggregations for the Insights dashboard.
 * All routes require admin JWT.
 */

'use strict';

const express  = require('express');
const { query } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

// All insight routes require authentication
router.use('/insights', requireRestaurantAuth);

/* ── Summary — last 30 days ──────────────────────────────────────────────── */
router.get('/insights/summary', async (req, res, next) => {
  try {
    const id = req.tenant.rest_id;
    const [ordersRes, leadsRes, repeatRes] = await Promise.all([
      query(`
        SELECT
          COUNT(*)               AS total_orders,
          SUM(total_amount)      AS gross_revenue,
          AVG(total_amount)      AS avg_order_value,
          COUNT(DISTINCT customer_phone) AS unique_customers
        FROM orders
        WHERE rest_id=$1
          AND status='delivered'
          AND created_at > NOW() - INTERVAL '30 days'
      `, [id]),
      query(`
        SELECT COUNT(*) AS total_leads,
          COUNT(*) FILTER (WHERE tier='hot')  AS hot,
          COUNT(*) FILTER (WHERE tier='warm') AS warm,
          COUNT(*) FILTER (WHERE tier='cool') AS cool
        FROM catering_leads
        WHERE rest_id=$1
          AND created_at > NOW() - INTERVAL '30 days'
      `, [id]),
      query(`
        SELECT COUNT(*) AS repeat_customers
        FROM customers
        WHERE rest_id=$1 AND order_count > 1
      `, [id]),
    ]);

    res.json({
      ok: true,
      period: '30d',
      orders:   ordersRes.rows[0],
      leads:    leadsRes.rows[0],
      customers: repeatRes.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

/* ── Orders by day ───────────────────────────────────────────────────────── */
router.get('/insights/orders', async (req, res, next) => {
  try {
    const id   = req.tenant.rest_id;
    const rawDays = parseInt(req.query.days, 10);
    const days = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 30;
    const result = await query(`
      SELECT
        DATE_TRUNC('day', created_at) AS day,
        COUNT(*)                      AS order_count,
        SUM(total_amount)             AS revenue
      FROM orders
      WHERE rest_id=$1
        AND status NOT IN ('cancelled')
        AND created_at > NOW() - ($2 || ' days')::INTERVAL
      GROUP BY 1
      ORDER BY 1
    `, [id, days]);
    res.json({ ok: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
