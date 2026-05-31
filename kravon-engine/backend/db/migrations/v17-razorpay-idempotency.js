/**
 * MIGRATION — v17-razorpay-idempotency.js
 * Prevents duplicate Razorpay orders from frontend retries by adding a unique
 * partial index on the razorpay_order_id extracted from metadata JSONB.
 * Also adds a functional index so webhook lookups (metadata->>'razorpay_order_id')
 * use an index rather than a full table scan.
 *
 * Safe to re-run — all steps guarded with IF NOT EXISTS.
 * Usage: node db/migrations/v17-razorpay-idempotency.js
 */

'use strict';

require('dotenv').config();
const { query } = require('../pool');

const STEPS = [
  // Unique index on razorpay_order_id extracted from metadata JSONB.
  // Partial: only non-null values (rows without Razorpay have NULL metadata->>'razorpay_order_id').
  // This prevents a frontend retry from creating two Razorpay orders for one DB order.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_order_id
   ON orders.orders ((metadata->>'razorpay_order_id'))
   WHERE metadata->>'razorpay_order_id' IS NOT NULL`,

  // Index on razorpay_payment_id for post-capture lookup performance.
  `CREATE INDEX IF NOT EXISTS idx_orders_razorpay_payment_id
   ON orders.orders ((metadata->>'razorpay_payment_id'))
   WHERE metadata->>'razorpay_payment_id' IS NOT NULL`,
];

(async () => {
  console.log('Running V17 migration (Razorpay order idempotency indexes)...\n');
  for (const sql of STEPS) {
    const label = sql.trim().split('\n')[0].slice(0, 80);
    try {
      await query(sql);
      console.log(`  ✓ ${label}`);
    } catch (err) {
      console.error(`  ✗ ${label}`);
      console.error(`    ${err.message}`);
      process.exit(1);
    }
  }
  console.log('\nV17 migration complete.');
  process.exit(0);
})();
