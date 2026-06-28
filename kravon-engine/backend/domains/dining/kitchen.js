'use strict';

/**
 * Dining domain — kitchen service (F05 fix: all channels).
 *
 * Returns a unified view of all active orders:
 *   tables[]  — dine-in orders grouped by open session / table
 *   queue[]   — delivery + pickup orders with no session
 *
 * Kitchen staff see every order regardless of channel.
 */

const { query } = require('../../db/pool');

async function getKitchenView(tenant_id) {
  const [dineInResult, queueResult] = await Promise.all([
    query(
      `SELECT
         t.name    AS table_name,
         s.id      AS session_id,
         s.opened_at,
         s.covers,
         s.session_status,
         s.bill_requested_at,
         json_agg(
           json_build_object(
             'order_id',   o.id,
             'status',     o.status,
             'created_at', o.created_at,
             'notes',      o.special_instructions,
             'items',      oi.items_agg
           ) ORDER BY o.created_at
         ) FILTER (WHERE o.id IS NOT NULL) AS orders
       FROM dining.sessions s
       JOIN dining.tables t ON t.id = s.table_id
       LEFT JOIN orders.orders o
         ON o.session_id = s.id
         AND o.status IN ('pending', 'confirmed', 'preparing')
         AND o.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT json_agg(
           json_build_object(
             'name',      oi2.item_name,
             'qty',       oi2.quantity,
             'note',      oi2.special_note,
             'allergens', mi.allergens
           ) ORDER BY oi2.id
         ) AS items_agg
         FROM orders.order_items oi2
         LEFT JOIN menu.menu_items mi ON mi.id = oi2.menu_item_id
         WHERE oi2.order_id = o.id
       ) oi ON TRUE
       WHERE s.tenant_id = $1 AND s.closed_at IS NULL AND s.deleted_at IS NULL
       GROUP BY t.name, s.id, s.opened_at, s.covers, s.session_status, s.bill_requested_at
       ORDER BY s.opened_at ASC
       LIMIT 200`,
      [tenant_id]
    ),
    query(
      `SELECT
         o.id                            AS order_id,
         o.status,
         o.channel,
         o.fulfillment_type,
         o.created_at,
         o.special_instructions,
         o.metadata->>'customer_name'    AS customer_name,
         o.metadata->>'table_identifier' AS table_identifier,
         json_agg(
           json_build_object(
             'name',      oi.item_name,
             'qty',       oi.quantity,
             'note',      oi.special_note,
             'allergens', mi.allergens
           )
           ORDER BY oi.id
         ) AS items
       FROM orders.orders o
       JOIN orders.order_items oi ON oi.order_id = o.id
       LEFT JOIN menu.menu_items mi ON mi.id = oi.menu_item_id
       WHERE o.tenant_id = $1
         AND o.session_id IS NULL
         AND o.status IN ('pending', 'confirmed', 'preparing')
         AND o.deleted_at IS NULL
       GROUP BY o.id
       ORDER BY o.created_at ASC
       LIMIT 200`,
      [tenant_id]
    ),
  ]);

  return { tables: dineInResult.rows, queue: queueResult.rows };
}

module.exports = { getKitchenView };
