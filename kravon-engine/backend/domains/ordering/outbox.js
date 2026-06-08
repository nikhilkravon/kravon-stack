'use strict';

/**
 * Thin wrapper for writing to platform.event_outbox within a transaction.
 * Must be called with an open pg client so the outbox row is part of the
 * same transaction as the business object (order, session, etc.).
 */

async function enqueue(client, tenantId, eventType, payload) {
  await client.query(
    `INSERT INTO platform.event_outbox (tenant_id, event_type, payload)
     VALUES ($1, $2, $3)`,
    [tenantId || null, eventType, JSON.stringify(payload)]
  );
}

module.exports = { enqueue };
