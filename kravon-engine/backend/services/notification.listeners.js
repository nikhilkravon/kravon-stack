'use strict';

/**
 * notification.listeners.js — Maps platform events → in-app notifications + WhatsApp.
 *
 * F09 fix: domain events now trigger both:
 *   1. In-app notification (notif.create → notifications.notifications table)
 *   2. WhatsApp/outbound dispatch via notify.service (Communications platform service)
 *
 * Call registerAll() once at server boot. Each listener is a pure mapping.
 * To add a new notification: add one events.on() block below.
 * To add a new channel: add to the listener block, do not modify domain code.
 */

const events  = require('../utils/events');
const notif   = require('./notification.service');
const notify  = require('./notify.service');
const { query } = require('../db/pool');

/* ── Tenant loader — minimal object for notify.service calls ─────────────── */

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
  /* ── Orders ─────────────────────────────────────────────────────────────── */

  // order.created is emitted for all confirmed online orders (COD/offline).
  // Razorpay orders emit this after payment.captured via webhooks.js.
  events.on('order.created', async ({ tenantId, orderId, total, channel }) => {
    const surface = channel === 'qr' ? 'Dine-in' : channel === 'web' ? 'Delivery' : 'Table';

    // In-app notification
    notif.create({
      tenantId, type: 'order.created', priority: 'SUCCESS',
      title: 'New order received',
      body:  `${surface} order • ₹${Number(total).toFixed(2)}`,
      entityType: 'orders.orders', entityId: orderId, actorType: 'customer',
      metadata: { orderId, total, channel },
    });

    // F09: load the full order for WhatsApp formatting
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
        const orderForNotify = {
          ...order,
          customer_name:    meta.customer_name,
          customer_phone:   meta.customer_phone,
          order_surface:    order.fulfillment_type === 'delivery' ? 'orders' : 'tables',
          table_identifier: meta.table_identifier,
          delivery_address: meta.delivery_address,
          delivery_locality:meta.delivery_locality,
          payment_method:   meta.payment_method,
          total:            Number(order.total_amount),
          subtotal:         Number(order.subtotal_amount),
          delivery_fee:     Number(order.delivery_charge || 0),
          items_json:       JSON.stringify(order.items_agg || []),
        };
        notify.orderConfirmed(tenantObj, orderForNotify).catch(err =>
          console.error(JSON.stringify({ level: 'error', event: 'listener.order_notify_failed',
            tenantId, orderId, message: err.message }))
        );
      }
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', event: 'listener.order_wa_error',
        tenantId, orderId, message: err.message }));
    }
  });

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

  /* ── Dine-in orders (separate event, smaller payload) ────────────────────── */

  events.on('dine_in.order_created', ({ tenantId, orderId, sessionId, total }) => {
    notif.create({
      tenantId, type: 'dine_in.order_created', priority: 'INFO',
      title: 'New dine-in order', body: `₹${Number(total).toFixed(2)}`,
      entityType: 'orders.orders', entityId: orderId, actorType: 'customer',
      metadata: { orderId, sessionId, total },
    });
  });

  /* ── Reservations ────────────────────────────────────────────────────────── */

  events.on('reservation.created', ({ tenantId, reservationId, partySize, reservationTime }) => {
    notif.create({
      tenantId, type: 'reservation.created', priority: 'SUCCESS',
      title: 'New reservation',
      body:  `Party of ${partySize} · ${new Date(reservationTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
      entityType: 'dining.reservations', entityId: reservationId, actorType: 'customer',
      metadata: { reservationId, partySize, reservationTime },
    });
  });

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

  events.on('lead.created', ({ tenantId, leadId, contactName, eventType }) => {
    notif.create({
      tenantId, type: 'lead.created', priority: 'SUCCESS',
      title: 'New catering enquiry',
      body:  `${contactName}${eventType ? ` · ${eventType}` : ''}`,
      entityType: 'catering.leads', entityId: leadId, actorType: 'customer',
      metadata: { leadId, contactName, eventType },
    });
  });

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

  events.on('session.opened', ({ tenantId, sessionId, tableId, covers }) => {
    notif.create({
      tenantId, type: 'session.opened', priority: 'INFO',
      title: 'Table session started',
      body:  covers ? `${covers} cover${covers > 1 ? 's' : ''}` : null,
      entityType: 'dining.sessions', entityId: sessionId, actorType: 'staff',
      metadata: { sessionId, tableId, covers },
    });
  });

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

  events.on('customer.created', ({ tenantId, customerId, phone }) => {
    // Silent — no in-app notification for customer creation (high volume)
  });

  events.on('customer.export_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId, type: 'customer.export_requested', priority: 'INFO',
      title: 'Customer data export requested',
      entityType: 'customer.customers', entityId: customerId, actorType: 'staff', actorId,
      metadata: { customerId },
    });
  });

  events.on('customer.delete_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId, type: 'customer.delete_requested', priority: 'WARNING',
      title: 'Customer deletion requested', body: 'DPDP deletion workflow initiated',
      entityType: 'customer.customers', entityId: customerId, actorType: 'staff', actorId,
      metadata: { customerId },
    });
  });

  events.on('customer.correct_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId, type: 'customer.correct_requested', priority: 'INFO',
      title: 'Customer data corrected',
      entityType: 'customer.customers', entityId: customerId, actorType: 'staff', actorId,
      metadata: { customerId },
    });
  });

  /* ── Governance / Exports ────────────────────────────────────────────────── */

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
