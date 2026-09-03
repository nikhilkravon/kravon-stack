'use strict';

/**
 * MAINTENANCE — cleanup-cafe-bodhi-tree-testdata.js
 *
 * One-shot pre-launch reset for the cafe-bodhi-tree tenant
 * (opening 05.09.2026). Deletes ONLY transactional test data created
 * during pre-launch verification; menu, tables, staff, brand, and all
 * other tenant config are untouched. Table statuses reset to available.
 *
 * Explicitly approved by the owner on 04.09.2026 before launch.
 *
 * Run:  node db/seeds/cleanup-cafe-bodhi-tree-testdata.js
 *       (from kravon-engine/backend/)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const { getClient } = require('../pool');

const TENANT_ID = '1abc383c-ea6e-4cc7-a4b8-abb94eccfbc5';

// Ordered to respect FK constraints (children before parents).
const DELETES = [
  'DELETE FROM billing.settlement_revisions WHERE tenant_id = $1',
  'DELETE FROM billing.invoices             WHERE tenant_id = $1',
  'DELETE FROM billing.payments             WHERE tenant_id = $1',
  'DELETE FROM billing.settlement_lines     WHERE tenant_id = $1',
  'DELETE FROM billing.settlements          WHERE tenant_id = $1',
  'DELETE FROM dining.reviews               WHERE tenant_id = $1',
  'DELETE FROM orders.order_items           WHERE tenant_id = $1',
  'DELETE FROM orders.orders                WHERE tenant_id = $1',
  'DELETE FROM dining.sessions              WHERE tenant_id = $1',
  'DELETE FROM notifications.notifications  WHERE tenant_id = $1',
  'DELETE FROM platform.event_outbox        WHERE tenant_id = $1',
  'DELETE FROM customer.customers           WHERE tenant_id = $1',
];

async function run() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const sql of DELETES) {
      const r = await client.query(sql, [TENANT_ID]);
      console.log(`${String(r.rowCount).padStart(3)}  ${sql.replace(/\s+/g, ' ').slice(0, 70)}`);
    }

    const rt = await client.query(
      `UPDATE dining.tables
       SET status = 'available'
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [TENANT_ID],
    );
    console.log(`${String(rt.rowCount).padStart(3)}  tables reset to available`);

    await client.query('COMMIT');
    console.log('\nCLEANUP COMMITTED — tenant is at a clean zero state for launch.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ROLLED BACK:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

run().then(() => process.exit());
