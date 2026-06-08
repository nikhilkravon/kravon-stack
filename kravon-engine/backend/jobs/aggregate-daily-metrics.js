'use strict';

const { query } = require('../db/pool');

// Computes and upserts daily_metrics rows for all tenants.
// Looks back LOOKBACK_DAYS on first run; subsequent runs only backfill the last 2 days
// (yesterday + today partial) so they stay fresh without re-scanning history.

const LOOKBACK_DAYS = 90;

async function run(lookbackDays = 2) {
  const start = Date.now();
  console.log(`[metrics-job] starting aggregation lookback=${lookbackDays}d`);

  try {
    // Revenue per tenant per day
    await query(`
      INSERT INTO insights.daily_metrics (tenant_id, metric_date, metric_type, value, breakdown, computed_at)
      SELECT
        tenant_id,
        DATE_TRUNC('day', created_at)::date AS metric_date,
        'revenue'                           AS metric_type,
        COALESCE(SUM(total_amount), 0)      AS value,
        JSONB_OBJECT_AGG(channel, channel_rev) AS breakdown,
        NOW()                               AS computed_at
      FROM (
        SELECT tenant_id, created_at, total_amount, channel,
               SUM(total_amount) OVER (PARTITION BY tenant_id, DATE_TRUNC('day', created_at), channel) AS channel_rev
        FROM orders.orders
        WHERE status IN ('completed', 'delivered')
          AND deleted_at IS NULL
          AND created_at >= CURRENT_DATE - ($1 || ' days')::interval
      ) sub
      GROUP BY tenant_id, DATE_TRUNC('day', created_at)::date
      ON CONFLICT (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID), metric_date, metric_type)
      DO UPDATE SET value = EXCLUDED.value, breakdown = EXCLUDED.breakdown, computed_at = EXCLUDED.computed_at
    `, [lookbackDays]);

    // Order count per tenant per day
    await query(`
      INSERT INTO insights.daily_metrics (tenant_id, metric_date, metric_type, value, computed_at)
      SELECT
        tenant_id,
        DATE_TRUNC('day', created_at)::date AS metric_date,
        'order_count'                       AS metric_type,
        COUNT(*)                            AS value,
        NOW()
      FROM orders.orders
      WHERE status IN ('completed', 'delivered')
        AND deleted_at IS NULL
        AND created_at >= CURRENT_DATE - ($1 || ' days')::interval
      GROUP BY tenant_id, DATE_TRUNC('day', created_at)::date
      ON CONFLICT (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID), metric_date, metric_type)
      DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at
    `, [lookbackDays]);

    // Avg order value per tenant per day
    await query(`
      INSERT INTO insights.daily_metrics (tenant_id, metric_date, metric_type, value, computed_at)
      SELECT
        tenant_id,
        DATE_TRUNC('day', created_at)::date AS metric_date,
        'avg_order_value'                   AS metric_type,
        AVG(total_amount)                   AS value,
        NOW()
      FROM orders.orders
      WHERE status IN ('completed', 'delivered')
        AND deleted_at IS NULL
        AND created_at >= CURRENT_DATE - ($1 || ' days')::interval
      GROUP BY tenant_id, DATE_TRUNC('day', created_at)::date
      ON CONFLICT (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID), metric_date, metric_type)
      DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at
    `, [lookbackDays]);

    // New customers (first order in window, not lifetime)
    await query(`
      INSERT INTO insights.daily_metrics (tenant_id, metric_date, metric_type, value, computed_at)
      SELECT
        tenant_id,
        first_order_date AS metric_date,
        'new_customers'  AS metric_type,
        COUNT(*)         AS value,
        NOW()
      FROM (
        SELECT tenant_id,
               customer_id,
               DATE_TRUNC('day', MIN(created_at))::date AS first_order_date
        FROM orders.orders
        WHERE deleted_at IS NULL
          AND customer_id IS NOT NULL
          AND created_at >= CURRENT_DATE - ($1 || ' days')::interval
        GROUP BY tenant_id, customer_id
      ) first_orders
      GROUP BY tenant_id, first_order_date
      ON CONFLICT (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID), metric_date, metric_type)
      DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at
    `, [lookbackDays]);

    // Returning customers (more than 1 order, grouped by their most recent order day)
    await query(`
      INSERT INTO insights.daily_metrics (tenant_id, metric_date, metric_type, value, computed_at)
      SELECT
        tenant_id,
        DATE_TRUNC('day', MAX(created_at))::date AS metric_date,
        'returning_customers'                    AS metric_type,
        COUNT(*)                                 AS value,
        NOW()
      FROM (
        SELECT tenant_id, customer_id, MAX(created_at) AS created_at
        FROM orders.orders
        WHERE deleted_at IS NULL
          AND customer_id IS NOT NULL
          AND created_at >= CURRENT_DATE - ($1 || ' days')::interval
        GROUP BY tenant_id, customer_id
        HAVING COUNT(*) > 1
      ) returning_customers
      GROUP BY tenant_id, DATE_TRUNC('day', created_at)::date
      ON CONFLICT (tenant_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::UUID), metric_date, metric_type)
      DO UPDATE SET value = EXCLUDED.value, computed_at = EXCLUDED.computed_at
    `, [lookbackDays]);

    console.log(`[metrics-job] done in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('[metrics-job] failed:', err.message);
  }
}

/**
 * Schedule the aggregation job.
 * - Runs immediately on startup with full LOOKBACK_DAYS backfill.
 * - Then every 24h with a 2-day rolling window (catches yesterday + today partial).
 */
function schedule() {
  // Initial backfill — run async so it doesn't block server startup
  run(LOOKBACK_DAYS).catch(err => console.error('[metrics-job] initial backfill error:', err.message));

  // Daily re-run at ~midnight (approximate — setInterval drifts, acceptable for analytics)
  setInterval(() => run(2), 24 * 60 * 60 * 1000);
}

module.exports = { run, schedule };
