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

module.exports = { getSummary, getOrdersByDay };
