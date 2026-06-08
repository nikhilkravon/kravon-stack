'use strict';

const express              = require('express');
const { query }            = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');
const intelligenceService  = require('../../domains/intelligence/service');

const router = express.Router();
router.use(requireRestaurantAuth);

/* ── Summary — last 30 days (pre-aggregated) ─────────────────────────────── */
router.get('/summary', async (req, res, next) => {
  try {
    const id = req.tenant.tenant_id;

    const [summary, leadsRes, repeatRes] = await Promise.all([
      intelligenceService.getSummary(id),

      query(`
        SELECT
          COUNT(*) AS total_leads,
          COUNT(*) FILTER (WHERE status IN ('qualified', 'negotiating'))   AS hot,
          COUNT(*) FILTER (WHERE status IN ('contacted', 'proposal_sent')) AS warm,
          COUNT(*) FILTER (WHERE status IN ('new', 'on_hold'))             AS cool
        FROM catering.leads
        WHERE tenant_id = $1 AND deleted_at IS NULL AND created_at > NOW() - INTERVAL '30 days'
      `, [id]),

      // repeat_customers already in summary from daily_metrics
      Promise.resolve(null),
    ]);

    res.json({
      ok:     true,
      period: '30d',
      orders: {
        total_orders:     summary.total_orders,
        gross_revenue:    summary.gross_revenue   ? String(summary.gross_revenue)   : null,
        avg_order_value:  summary.avg_order_value ? String(summary.avg_order_value) : null,
        unique_customers: String(summary.unique_customers),
      },
      leads:     leadsRes.rows[0],
      customers: { repeat_customers: String(summary.repeat_customers) },
    });
  } catch (err) { next(err); }
});

/* ── Tonight — live operational data (stays live, always fast) ────────────── */
router.get('/tonight', async (req, res, next) => {
  try {
    const id = req.tenant.tenant_id;

    const [ordersRes, sessionsRes] = await Promise.all([
      query(`
        SELECT
          COUNT(*) FILTER (WHERE status NOT IN ('cancelled','refunded')) AS order_count,
          COUNT(*) FILTER (WHERE status IN ('pending','confirmed','preparing','ready','out_for_delivery')) AS live_orders,
          COALESCE(SUM(total_amount) FILTER (WHERE status NOT IN ('cancelled','refunded','pending')), 0) AS revenue
        FROM orders.orders
        WHERE tenant_id = $1 AND deleted_at IS NULL AND created_at >= DATE_TRUNC('day', NOW())
      `, [id]),
      query(`
        SELECT COUNT(*) AS open_tables, COALESCE(SUM(covers), 0) AS covers
        FROM dining.sessions s
        JOIN dining.tables t ON t.id = s.table_id
        WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND s.closed_at IS NULL
      `, [id]),
    ]);

    res.json({ ok: true, orders: ordersRes.rows[0], sessions: sessionsRes.rows[0] });
  } catch (err) { next(err); }
});

/* ── Orders by day (pre-aggregated) ─────────────────────────────────────── */
router.get('/orders', async (req, res, next) => {
  try {
    const id      = req.tenant.tenant_id;
    const rawDays = parseInt(req.query.days, 10);
    const days    = Number.isFinite(rawDays) ? Math.min(Math.max(rawDays, 1), 365) : 30;

    const data = await intelligenceService.getOrdersByDay(id, days);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
});

module.exports = router;
