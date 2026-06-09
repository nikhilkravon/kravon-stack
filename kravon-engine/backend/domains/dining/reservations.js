'use strict';

/**
 * Dining domain — reservations service.
 *
 * Owns the full reservation lifecycle: creation, listing, status updates.
 * Customer identity resolved via CustomerService (F02).
 */

const { query, getClient } = require('../../db/pool');
const customerService      = require('../customer/service');
const events               = require('../../utils/events');
const sessions             = require('./sessions');

function generateConfirmationCode() {
  return `R${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

async function create(tenant, {
  customer_name, customer_phone, customer_email,
  party_size, reservation_time, occasion, dietary_notes, table_id,
}) {
  const tenant_id  = tenant.tenant_id;
  const resCfg     = tenant.reservations || {};

  if (resCfg.accepts_reservations === false) {
    return { error: 'This restaurant is not currently accepting reservations.', status: 409 };
  }

  const reservationAt = new Date(reservation_time);
  if (Number.isNaN(reservationAt.getTime())) {
    return { error: 'reservation_time is invalid.', status: 400 };
  }

  const nowMs          = Date.now();
  const maxAdvanceDays = resCfg.max_advance_days  ?? 30;
  const minAdvanceHrs  = resCfg.min_advance_hours ?? 2;
  const maxPartySize   = resCfg.max_party_size    ?? 12;

  if (reservationAt.getTime() < nowMs + minAdvanceHrs * 3600_000) {
    return { error: `Reservations must be made at least ${minAdvanceHrs} hour(s) in advance.`, status: 400 };
  }
  if (reservationAt.getTime() > nowMs + maxAdvanceDays * 86400_000) {
    return { error: `Reservations can only be made up to ${maxAdvanceDays} day(s) in advance.`, status: 400 };
  }
  if (party_size > maxPartySize) {
    return { error: `Maximum party size is ${maxPartySize}. Please call us for larger groups.`, status: 400 };
  }

  const slots = resCfg.slots || [];
  if (slots.length) {
    const dayOfWeek = reservationAt.getDay();
    const hhmm      = `${String(reservationAt.getHours()).padStart(2, '0')}:${String(reservationAt.getMinutes()).padStart(2, '0')}`;
    const inSlot    = slots.some(s => s.day === dayOfWeek && hhmm >= s.open && hhmm < s.close);
    if (!inSlot) {
      return { error: 'The selected time is outside our reservation hours.', status: 400 };
    }
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Customer identity (F02)
    const customer_id = await customerService.findOrCreate(client, tenant_id, {
      phone: customer_phone, name: customer_name, email: customer_email,
    });

    let validatedTableId = null;
    if (table_id) {
      const tableRes = await client.query(
        `SELECT id FROM dining.tables WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [table_id, tenant_id]
      );
      if (!tableRes.rows.length) {
        await client.query('ROLLBACK');
        return { error: 'Table not found.', status: 404 };
      }
      validatedTableId = table_id;
    }

    const confirmation_code = generateConfirmationCode();
    const reservationRes = await client.query(
      `INSERT INTO dining.reservations (
         tenant_id, location_id, customer_id, table_id,
         party_size, reservation_time, status, source,
         occasion, dietary_notes, confirmation_code,
         metadata, created_at, updated_at
       ) VALUES ($1, NULL, $2, $3, $4, $5, 'pending', 'presence', $6, $7, $8, '{}', NOW(), NOW())
       RETURNING id, confirmation_code`,
      [tenant_id, customer_id, validatedTableId, party_size,
       reservationAt.toISOString(), occasion ?? null, dietary_notes ?? null, confirmation_code]
    );

    await client.query('COMMIT');
    events.emit('reservation.created', {
      tenantId: tenant_id, reservationId: reservationRes.rows[0].id,
      partySize: party_size, reservationTime: reservationAt.toISOString(),
    });

    return {
      reservation_id:    reservationRes.rows[0].id,
      confirmation_code: reservationRes.rows[0].confirmation_code,
      status:            'pending',
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const VALID_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];

async function updateStatus(tenant, reservationId, { status, notes, table_id }, staffId) {
  const tenantId = typeof tenant === 'object' ? tenant.tenant_id : tenant;

  if (status && !VALID_STATUSES.includes(status)) {
    return { error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}`, status: 400 };
  }

  const sets   = [];
  const params = [reservationId, tenantId];

  if (status)             { params.push(status); sets.push(`status = $${params.length}`); }
  if (notes !== undefined){ params.push(notes);  sets.push(`dietary_notes = $${params.length}`); }
  if (status === 'cancelled') sets.push(`cancelled_at = NOW()`);
  sets.push(`updated_at = NOW()`);

  const result = await query(
    `UPDATE dining.reservations
     SET ${sets.join(', ')}
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     RETURNING id, status, table_id, party_size, updated_at`,
    params
  );

  if (!result.rows.length) return { error: 'Reservation not found', status: 404 };

  const reservation = result.rows[0];

  if (status) {
    events.emit('reservation.status_updated', { tenantId, reservationId, status, actorId: staffId });
  }

  // Auto-open a dining session when seating a reservation
  // table_id override from caller (staff picks table in modal) takes priority over reserved table
  let session = null;
  const effectiveTableId = table_id || reservation.table_id;
  if (status === 'seated' && effectiveTableId) {
    const tenantObj = typeof tenant === 'object' ? tenant : { tenant_id: tenantId };
    const sessionResult = await sessions.openSession(
      tenantObj,
      { table_id: effectiveTableId, covers: reservation.party_size, reservation_id: reservationId },
      staffId
    );
    if (!sessionResult.error) {
      session = sessionResult;
    } else {
      session = { error: sessionResult.error };
    }
  }

  return { reservation, session };
}

async function list(tenantId, { page = 1, limit = 25, status = null } = {}) {
  const params  = [tenantId];
  const filters = ['r.tenant_id = $1', 'r.deleted_at IS NULL'];
  const offset  = (page - 1) * limit;

  if (status === 'upcoming') {
    filters.push(`r.status IN ('pending','confirmed') AND r.reservation_time > NOW()`);
  } else if (status) {
    params.push(status);
    filters.push(`r.status = $${params.length}`);
  }

  const where = `WHERE ${filters.join(' AND ')}`;
  const [listRes, countRes] = await Promise.all([
    query(
      `SELECT r.id, r.party_size, r.reservation_time, r.status,
              r.occasion, r.dietary_notes, r.confirmation_code,
              r.source, r.created_at, r.table_id,
              c.name  AS customer_name,
              c.phone AS customer_phone,
              c.email AS customer_email,
              t.name  AS table_label
       FROM dining.reservations r
       LEFT JOIN customer.customers c ON c.id = r.customer_id AND c.deleted_at IS NULL
       LEFT JOIN dining.tables t      ON t.id = r.table_id    AND t.deleted_at IS NULL
       ${where}
       ORDER BY r.reservation_time ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
    query(`SELECT COUNT(*) AS total FROM dining.reservations r ${where}`, params),
  ]);

  return {
    reservations: listRes.rows,
    total:        parseInt(countRes.rows[0].total, 10),
  };
}

module.exports = { create, updateStatus, list };
