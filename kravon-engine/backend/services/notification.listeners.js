'use strict';

/**
 * notification.listeners.js — Maps platform events → channels.
 *
 * Each listener block is the single place that declares which channels
 * an event fires on. Adding a new channel means editing the listener
 * block for that event (or the corresponding notify.service method) —
 * never the domain that emits the event.
 *
 * Channels per event:
 *   Bell    — notif.create()         → notifications.notifications table
 *   WA      — notify.*()             → whatsapp.js → Meta Cloud API
 *   Email   — notify.*()             → email.js → Resend
 *   Webhook — notify.orderConfirmed  → webhook.js → tenant.webhook_url
 */

const events  = require('../utils/events');
const notif   = require('./notification.service');
const notify  = require('./notify.service');
const { query } = require('../db/pool');

/* ── Tenant loader — minimal shape for notify.service calls ──────────────── */

async function loadTenantForNotify(tenantId) {
  const res = await query(
    `SELECT r.id, r.slug, r.name,
            r.settings->>'webhook_url' AS webhook_url,
            cl.url AS wa_url
     FROM tenant.restaurants r
     LEFT JOIN brand.contact_links cl
            ON cl.tenant_id = r.id AND cl.platform = 'whatsapp' AND cl.deleted_at IS NULL
     WHERE r.id = $1 AND r.deleted_at IS NULL LIMIT 1`,
    [tenantId]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    tenant_id:   row.id,
    slug:        row.slug,
    name:        row.name,
    webhook_url: row.webhook_url || null,
    wa_number:   row.wa_url ? row.wa_url.replace('https://wa.me/', '') : null,
  };
}

function registerAll() {

  /* ── Orders ──────────────────────────────────────────────────────────────── */

  // Bell: ✅  WA: ✅ (kitchen + customer)  Webhook: ✅
  events.on('order.created', async ({ tenantId, orderId, total, channel }) => {
    const surface = channel === 'qr' ? 'Dine-in' : channel === 'web' ? 'Delivery' : 'Table';

    notif.create({
      tenantId, type: 'order.created', priority: 'SUCCESS',
      title: 'New order received',
      body:  `${surface} order • ₹${Number(total).toFixed(2)}`,
      entityType: 'orders.orders', entityId: orderId, actorType: 'customer',
      metadata: { orderId, total, channel },
    });

    try {
      const [orderRes, tenantObj] = await Promise.all([
        query(
          `SELECT o.*, oi.items_agg
           FROM orders.orders o
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object('name', i.item_name, 'qty', i.quantity, 'price', i.unit_price)) AS items_agg
             FROM orders.order_items i WHERE i.order_id = o.id
           ) oi ON TRUE
           WHERE o.id = $1 AND o.deleted_at IS NULL`,
          [orderId]
        ),
        loadTenantForNotify(tenantId),
      ]);

      if (orderRes.rows.length && tenantObj) {
        const order = orderRes.rows[0];
        const meta  = order.metadata || {};
        notify.orderConfirmed(tenantObj, {
          ...order,
          customer_name:     meta.customer_name,
          customer_phone:    meta.customer_phone,
          order_surface:     order.fulfillment_type === 'delivery' ? 'orders' : 'tables',
          table_identifier:  meta.table_identifier,
          delivery_address:  meta.delivery_address,
          delivery_locality: meta.delivery_locality,
          payment_method:    meta.payment_method,
          total:             Number(order.total_amount),
          subtotal:          Number(order.subtotal_amount),
          delivery_fee:      Number(order.delivery_charge || 0),
          items_json:        JSON.stringify(order.items_agg || []),
        }).catch(err =>
          console.error(JSON.stringify({ level: 'error', event: 'listener.order_notify_failed',
            tenantId, orderId, message: err.message }))
        );
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'listener.order_wa_error',
        tenantId, orderId, message: err.message }));
    }
  });

  // Bell: ✅
  events.on('order.status_updated', ({ tenantId, orderId, status, actorId }) => {
    notif.create({
      tenantId, type: 'order.status_updated',
      priority:   status === 'cancelled' ? 'WARNING' : 'INFO',
      title:      status === 'cancelled' ? 'Order cancelled' : 'Order status updated',
      body:       `Status changed to ${status}`,
      entityType: 'orders.orders', entityId: orderId,
      actorType: actorId ? 'staff' : 'system', actorId,
      metadata: { orderId, status },
    });
  });

  /* ── Dine-in orders ──────────────────────────────────────────────────────── */

  // Bell: ✅
  events.on('dine_in.order_created', ({ tenantId, orderId, sessionId, total }) => {
    notif.create({
      tenantId, type: 'dine_in.order_created', priority: 'INFO',
      title: 'New dine-in order', body: `₹${Number(total).toFixed(2)}`,
      entityType: 'orders.orders', entityId: orderId, actorType: 'customer',
      metadata: { orderId, sessionId, total },
    });
  });

  /* ── Reservations ────────────────────────────────────────────────────────── */

  // Bell: ✅  WA: ✅ (owner)
  events.on('reservation.created', async ({ tenantId, reservationId, partySize, reservationTime, contactName, notes }) => {
    notif.create({
      tenantId, type: 'reservation.created', priority: 'SUCCESS',
      title: 'New reservation',
      body:  `Party of ${partySize} · ${new Date(reservationTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
      entityType: 'dining.reservations', entityId: reservationId, actorType: 'customer',
      metadata: { reservationId, partySize, reservationTime },
    });

    try {
      const tenantObj = await loadTenantForNotify(tenantId);
      if (tenantObj) {
        notify.reservationCreated(tenantObj, {
          id: reservationId, contact_name: contactName,
          party_size: partySize, reservation_time: reservationTime, notes,
        }).catch(err =>
          console.error(JSON.stringify({ level: 'error', event: 'listener.reservation_wa_failed',
            tenantId, reservationId, message: err.message }))
        );
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'listener.reservation_notify_error',
        tenantId, reservationId, message: err.message }));
    }
  });

  // Bell: ✅
  events.on('reservation.status_updated', ({ tenantId, reservationId, status, actorId }) => {
    notif.create({
      tenantId, type: 'reservation.status_updated',
      priority: (status === 'no_show' || status === 'cancelled') ? 'WARNING' : 'INFO',
      title: 'Reservation update',
      body:  `Reservation marked as ${status.replace('_', ' ')}`,
      entityType: 'dining.reservations', entityId: reservationId,
      actorType: 'staff', actorId,
      metadata: { reservationId, status },
    });

    if (status === 'completed') {
      notify.reviewRequest({ tenantId, source: 'reservation', entityId: reservationId });
    }
  });

  /* ── Catering Leads ──────────────────────────────────────────────────────── */

  // Bell: ✅
  events.on('lead.created', ({ tenantId, leadId, contactName, eventType }) => {
    notif.create({
      tenantId, type: 'lead.created', priority: 'SUCCESS',
      title: 'New catering enquiry',
      body:  `${contactName}${eventType ? ` · ${eventType}` : ''}`,
      entityType: 'catering.leads', entityId: leadId, actorType: 'customer',
      metadata: { leadId, contactName, eventType },
    });
  });

  // Bell: ✅
  events.on('lead.status_updated', ({ tenantId, leadId, status, actorId }) => {
    notif.create({
      tenantId, type: 'lead.status_updated',
      priority: status === 'lost' ? 'WARNING' : 'INFO',
      title:    status === 'lost' ? 'Lead lost' : 'Lead status updated',
      body:     `Lead moved to ${status.replace('_', ' ')}`,
      entityType: 'catering.leads', entityId: leadId, actorType: 'staff', actorId,
      metadata: { leadId, status },
    });

    if (status === 'confirmed') {
      notify.reviewRequest({ tenantId, source: 'catering', entityId: leadId });
    }
  });

  // Bell: ✅
  events.on('lead.converted', ({ tenantId, leadId }) => {
    notif.create({
      tenantId, type: 'lead.converted', priority: 'SUCCESS',
      title: 'Catering lead converted',
      body:  'Event record created — check catering pipeline',
      entityType: 'catering.leads', entityId: leadId, actorType: 'system',
      metadata: { leadId },
    });
  });

  /* ── Dine-In Sessions ────────────────────────────────────────────────────── */

  // Bell: ✅  WA: ✅ (owner)
  // Single event: dine_in.bill_requested. bill.requested is removed (was duplicate).
  events.on('dine_in.bill_requested', async ({ tenantId, sessionId, requestedBy }) => {
    try {
      const [tableRes, tenantObj] = await Promise.all([
        query(
          `SELECT t.name AS table_name
           FROM dining.sessions s
           JOIN dining.tables t ON t.id = s.table_id
           WHERE s.id = $1 AND s.tenant_id = $2 LIMIT 1`,
          [sessionId, tenantId]
        ),
        loadTenantForNotify(tenantId),
      ]);

      const tableName = tableRes.rows[0]?.table_name || 'Unknown table';

      notif.create({
        tenantId, type: 'dine_in.bill_requested', priority: 'WARNING',
        title: 'Bill requested',
        body:  `${tableName} is ready to pay`,
        entityType: 'dining.sessions', entityId: sessionId, actorType: 'customer',
        metadata: { sessionId, requestedBy },
      });

      if (tenantObj) {
        notify.billRequested(tenantObj, tableName, sessionId).catch(err =>
          console.error(JSON.stringify({ level: 'error', event: 'listener.bill_wa_failed',
            tenantId, sessionId, message: err.message }))
        );
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'listener.bill_req_failed',
        tenantId, sessionId, message: err.message }));
    }
  });

  // Bell: ✅
  events.on('dine_in.staff_notify', ({ tenantId, tableId, tableName }) => {
    notif.create({
      tenantId, type: 'dine_in.staff_notify', priority: 'WARNING',
      title: 'Guests waiting',
      body:  `${tableName} is waiting — please open their session`,
      entityType: 'dining.tables', entityId: tableId, actorType: 'customer',
      metadata: { tableId, tableName },
    });
  });

  // Bell: ✅
  events.on('session.opened', ({ tenantId, sessionId, tableId, covers }) => {
    notif.create({
      tenantId, type: 'session.opened', priority: 'INFO',
      title: 'Table session started',
      body:  covers ? `${covers} cover${covers > 1 ? 's' : ''}` : null,
      entityType: 'dining.sessions', entityId: sessionId, actorType: 'staff',
      metadata: { sessionId, tableId, covers },
    });
  });

  // Bell: ✅
  events.on('session.closed', ({ tenantId, sessionId, tableId, totalBilled }) => {
    notif.create({
      tenantId, type: 'session.closed', priority: 'INFO',
      title: 'Table session closed',
      body:  totalBilled ? `Total billed: ₹${Number(totalBilled).toFixed(2)}` : null,
      entityType: 'dining.sessions', entityId: sessionId, actorType: 'staff',
      metadata: { sessionId, tableId, totalBilled },
    });
  });

  /* ── Reviews ─────────────────────────────────────────────────────────────── */

  // Bell: ✅
  events.on('review.submitted', ({ tenantId, stars, orderId }) => {
    notif.create({
      tenantId, type: 'review.submitted',
      priority:   stars <= 2 ? 'WARNING' : 'SUCCESS',
      title:      stars <= 2 ? 'Low-rated review received' : 'New review received',
      body:       `${stars} star${stars !== 1 ? 's' : ''}`,
      entityType: orderId ? 'orders.orders' : null, entityId: orderId || null,
      actorType: 'customer', metadata: { stars, orderId },
    });
  });

  /* ── Customer Governance ─────────────────────────────────────────────────── */

  events.on('customer.created', () => {
    // Silent — high volume, no bell notification
  });

  // Bell: ✅
  events.on('customer.export_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId, type: 'customer.export_requested', priority: 'INFO',
      title: 'Customer data export requested',
      entityType: 'customer.customers', entityId: customerId, actorType: 'staff', actorId,
      metadata: { customerId },
    });
  });

  // Bell: ✅
  events.on('customer.delete_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId, type: 'customer.delete_requested', priority: 'WARNING',
      title: 'Customer deletion requested', body: 'DPDP deletion workflow initiated',
      entityType: 'customer.customers', entityId: customerId, actorType: 'staff', actorId,
      metadata: { customerId },
    });
  });

  // Bell: ✅
  events.on('customer.correct_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId, type: 'customer.correct_requested', priority: 'INFO',
      title: 'Customer data corrected',
      entityType: 'customer.customers', entityId: customerId, actorType: 'staff', actorId,
      metadata: { customerId },
    });
  });

  /* ── Governance / Exports ────────────────────────────────────────────────── */

  // Bell: ✅
  events.on('settings.exported', ({ tenantId, jobId, actorId }) => {
    notif.create({
      tenantId, type: 'settings.exported', priority: 'INFO',
      title: 'Restaurant data exported',
      entityType: 'platform.export_jobs', entityId: jobId, actorType: 'staff', actorId,
      metadata: { jobId },
    });
  });

  /* ── Reserved future events (no-op stubs) ────────────────────────────────── */
  const RESERVED = [
    'payment.received', 'payment.failed',
    'subscription.expiring', 'subscription.expired',
    'customer.first_order', 'customer.repeat_visit',
    'menu.item_out_of_stock', 'staff.created', 'staff.invited',
  ];
  for (const type of RESERVED) {
    events.on(type, () => {});
  }

  console.log('[notifications] Listeners registered.');
}

module.exports = { registerAll };
