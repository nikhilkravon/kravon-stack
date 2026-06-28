'use strict';

const { query } = require('../../db/pool');

// Schema: insights.daily_metrics — one row per (tenant_id, metric_date, metric_type).
// metric_types used here: 'revenue', 'order_count', 'avg_order_value',
//   'new_customers', 'returning_customers'.

const METRIC = {
  REVENUE:             'revenue',
  ORDER_COUNT:         'order_count',
  AVG_ORDER_VALUE:     'avg_order_value',
  NEW_CUSTOMERS:       'new_customers',
  RETURNING_CUSTOMERS: 'returning_customers',
};

/**
 * Read 30-day summary from pre-aggregated daily_metrics.
 * Falls back gracefully if no rows exist yet.
 */
async function getSummary(tenantId) {
  const res = await query(
    `SELECT metric_type, SUM(value) AS total, AVG(value) AS avg
     FROM insights.daily_metrics
     WHERE tenant_id = $1
       AND metric_date > CURRENT_DATE - INTERVAL '30 days'
       AND metric_type = ANY($2)
     GROUP BY metric_type`,
    [tenantId, [METRIC.REVENUE, METRIC.ORDER_COUNT, METRIC.AVG_ORDER_VALUE,
                METRIC.NEW_CUSTOMERS, METRIC.RETURNING_CUSTOMERS]]
  );

  const map = new Map(res.rows.map(r => [r.metric_type, r]));
  const g = (key) => map.get(key);

  return {
    total_orders:       Number(g(METRIC.ORDER_COUNT)?.total      || 0),
    gross_revenue:      Number(g(METRIC.REVENUE)?.total           || 0),
    avg_order_value:    Number(g(METRIC.AVG_ORDER_VALUE)?.avg     || 0),
    unique_customers:   Number(g(METRIC.NEW_CUSTOMERS)?.total     || 0),
    repeat_customers:   Number(g(METRIC.RETURNING_CUSTOMERS)?.total || 0),
  };
}

/**
 * Read orders-by-day from pre-aggregated daily_metrics.
 * Returns [{day, order_count, revenue}] sorted ascending.
 */
async function getOrdersByDay(tenantId, days) {
  const [countRes, revenueRes] = await Promise.all([
    query(
      `SELECT metric_date AS day, value AS order_count
       FROM insights.daily_metrics
       WHERE tenant_id = $1
         AND metric_type = $2
         AND metric_date > CURRENT_DATE - INTERVAL '1 day' * $3
       ORDER BY metric_date`,
      [tenantId, METRIC.ORDER_COUNT, days]
    ),
    query(
      `SELECT metric_date AS day, value AS revenue
       FROM insights.daily_metrics
       WHERE tenant_id = $1
         AND metric_type = $2
         AND metric_date > CURRENT_DATE - INTERVAL '1 day' * $3
       ORDER BY metric_date`,
      [tenantId, METRIC.REVENUE, days]
    ),
  ]);

  // Merge by day
  const revenueMap = new Map(revenueRes.rows.map(r => [r.day.toISOString(), Number(r.revenue)]));
  return countRes.rows.map(r => ({
    day:         r.day,
    order_count: Number(r.order_count),
    revenue:     revenueMap.get(r.day.toISOString()) ?? 0,
  }));
}

async function getRevenueByChannel(tenantId, days) {
  const res = await query(
    `SELECT
       fulfillment_type,
       channel,
       COUNT(*)                          AS order_count,
       COALESCE(SUM(total_amount), 0)    AS revenue,
       COALESCE(AVG(total_amount), 0)    AS avg_order_value
     FROM orders.orders
     WHERE tenant_id = $1
       AND deleted_at IS NULL
       AND status NOT IN ('cancelled','refunded')
       AND created_at >= NOW() - INTERVAL '1 day' * $2
     GROUP BY fulfillment_type, channel
     ORDER BY revenue DESC`,
    [tenantId, days]
  );
  return res.rows.map(r => ({
    ...r,
    order_count:     Number(r.order_count),
    revenue:         Number(r.revenue),
    avg_order_value: Number(r.avg_order_value),
  }));
}

async function getOrdersByHour(tenantId, days) {
  const res = await query(
    `SELECT
       EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Kolkata')::INT AS hour,
       COUNT(*)                          AS order_count,
       COALESCE(SUM(total_amount), 0)    AS revenue
     FROM orders.orders
     WHERE tenant_id = $1
       AND deleted_at IS NULL
       AND status NOT IN ('cancelled','refunded')
       AND created_at >= NOW() - INTERVAL '1 day' * $2
     GROUP BY hour
     ORDER BY hour`,
    [tenantId, days]
  );
  return res.rows.map(r => ({
    hour:        Number(r.hour),
    order_count: Number(r.order_count),
    revenue:     Number(r.revenue),
  }));
}

async function getTopItems(tenantId, days, limit = 15) {
  const res = await query(
    `SELECT
       oi.item_name,
       SUM(oi.quantity)            AS total_qty,
       COALESCE(SUM(oi.total_price), 0) AS total_revenue
     FROM orders.order_items oi
     JOIN orders.orders o ON o.id = oi.order_id
     WHERE o.tenant_id = $1
       AND o.deleted_at IS NULL
       AND o.status NOT IN ('cancelled','refunded')
       AND o.created_at >= NOW() - INTERVAL '1 day' * $2
     GROUP BY oi.item_name
     ORDER BY total_qty DESC
     LIMIT $3`,
    [tenantId, days, limit]
  );
  return res.rows.map(r => ({
    item_name:     r.item_name,
    total_qty:     Number(r.total_qty),
    total_revenue: Number(r.total_revenue),
  }));
}

async function getTableOccupancy(tenantId, days) {
  const res = await query(
    `SELECT
       t.name AS table_name,
       COUNT(s.id)                AS session_count,
       COALESCE(AVG(
         EXTRACT(EPOCH FROM (COALESCE(s.closed_at, NOW()) - s.opened_at)) / 60
       ), 0)::NUMERIC(8,1)       AS avg_duration_mins,
       COALESCE(SUM(s.total_billed), 0) AS total_revenue
     FROM dining.tables t
     LEFT JOIN dining.sessions s
       ON s.table_id = t.id
       AND s.deleted_at IS NULL
       AND s.opened_at >= NOW() - INTERVAL '1 day' * $2
     WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
     GROUP BY t.id, t.name
     ORDER BY session_count DESC`,
    [tenantId, days]
  );
  return res.rows.map(r => ({
    table_name:       r.table_name,
    session_count:    Number(r.session_count),
    avg_duration_mins: Number(r.avg_duration_mins),
    total_revenue:    Number(r.total_revenue),
  }));
}

async function getAvgPrepAndDining(tenantId, days) {
  const [prepRes, diningRes] = await Promise.all([
    // Avg time from order confirmed to ready (preparation time)
    query(
      `SELECT
         COALESCE(AVG(
           EXTRACT(EPOCH FROM (updated_at - created_at)) / 60
         ), 0)::NUMERIC(6,1) AS avg_prep_mins
       FROM orders.orders
       WHERE tenant_id = $1
         AND deleted_at IS NULL
         AND status IN ('ready','completed','delivered')
         AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [tenantId, days]
    ),
    // Avg dining session duration
    query(
      `SELECT
         COALESCE(AVG(
           EXTRACT(EPOCH FROM (closed_at - opened_at)) / 60
         ), 0)::NUMERIC(6,1) AS avg_dining_mins
       FROM dining.sessions
       WHERE tenant_id = $1
         AND deleted_at IS NULL
         AND closed_at IS NOT NULL
         AND opened_at >= NOW() - INTERVAL '1 day' * $2`,
      [tenantId, days]
    ),
  ]);
  return {
    avg_prep_mins:   Number(prepRes.rows[0]?.avg_prep_mins   || 0),
    avg_dining_mins: Number(diningRes.rows[0]?.avg_dining_mins || 0),
  };
}

module.exports = {
  getSummary, getOrdersByDay,
  getRevenueByChannel, getOrdersByHour, getTopItems,
  getTableOccupancy, getAvgPrepAndDining,
};
