'use strict';

/**
 * Customer domain — service.
 *
 * Single entry point for all customer identity resolution.
 * Every surface (ordering, dining, reservations, leads) calls findOrCreate()
 * instead of issuing its own inline INSERT.
 *
 * This is the canonical solution to F02 (Customer Identity Explosion):
 * one customer per phone number per tenant, enforced here, once.
 */

const repo   = require('./repository');
const events = require('../../utils/events');

/**
 * Resolve or create a customer record by phone number.
 *
 * @param {object} client  - pg transaction client (or null to use pool query)
 * @param {string} tenantId
 * @param {object} identity - { phone, name?, email? }
 * @returns {Promise<string>} customerId (UUID)
 */
async function findOrCreate(client, tenantId, { phone, name, email } = {}) {
  if (!phone) return null;

  const existing = await repo.findByPhone(client, tenantId, phone);
  if (existing) {
    // Update name if a better one is provided
    if (name && name !== existing.name) {
      await client.query(
        `UPDATE customer.customers SET name = $1, updated_at = NOW()
         WHERE tenant_id = $2 AND id = $3`,
        [name, tenantId, existing.id]
      );
    }
    return existing.id;
  }

  const created = await repo.upsertByPhone(client, tenantId, { phone, name, email });

  // Emit async — new customer acquisition signal for Intelligence + Communications
  events.emit('customer.created', { tenantId, customerId: created.id, phone });

  return created.id;
}

/**
 * Get full customer profile including order history.
 */
async function getProfile(tenantId, customerId) {
  const { query } = require('../../db/pool');

  const [customer, orders] = await Promise.all([
    repo.findById(tenantId, customerId),
    query(
      `SELECT id, channel, fulfillment_type, status, total_amount, created_at
       FROM orders.orders
       WHERE tenant_id = $1 AND customer_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 50`,
      [tenantId, customerId]
    ),
  ]);

  if (!customer) return null;
  return {
    ...customer,
    orders: orders.rows.map(o => ({ ...o, total_amount: Number(o.total_amount) })),
  };
}

module.exports = { findOrCreate, getProfile };
