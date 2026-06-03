'use strict';

/**
 * notification.listeners.js — Maps platform events → in-app notifications.
 *
 * Call registerAll() once at server boot. Each listener is a pure mapping:
 * event payload → notificationService.create(). No business logic here.
 *
 * To add a new notification: add one events.on() block below.
 * To add a new channel (email, WhatsApp): create a separate *.listeners.js file.
 * No route code changes required for either.
 */

const events  = require('../utils/events');
const notif   = require('./notification.service');

function registerAll() {
  /* ── Orders ─────────────────────────────────────────────────────────────── */
  events.on('order.created', ({ tenantId, orderId, total, channel }) => {
    const surface = channel === 'qr' ? 'Dine-in' : channel === 'web' ? 'Delivery' : 'Table';
    notif.create({
      tenantId,
      type:       'order.created',
      priority:   'SUCCESS',
      title:      'New order received',
      body:       `${surface} order • ₹${Number(total).toFixed(2)}`,
      entityType: 'orders.orders',
      entityId:   orderId,
      actorType:  'customer',
      metadata:   { orderId, total, channel },
    });
  });

  events.on('order.status_updated', ({ tenantId, orderId, status, actorId }) => {
    const isCancelled = status === 'cancelled';
    notif.create({
      tenantId,
      type:       'order.status_updated',
      priority:   isCancelled ? 'WARNING' : 'INFO',
      title:      isCancelled ? 'Order cancelled' : 'Order status updated',
      body:       `Status changed to ${status}`,
      entityType: 'orders.orders',
      entityId:   orderId,
      actorType:  actorId ? 'staff' : 'system',
      actorId,
      metadata:   { orderId, status },
    });
  });

  /* ── Reservations ────────────────────────────────────────────────────────── */
  events.on('reservation.created', ({ tenantId, reservationId, partySize, reservationTime }) => {
    notif.create({
      tenantId,
      type:       'reservation.created',
      priority:   'SUCCESS',
      title:      'New reservation',
      body:       `Party of ${partySize} · ${new Date(reservationTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
      entityType: 'dining.reservations',
      entityId:   reservationId,
      actorType:  'customer',
      metadata:   { reservationId, partySize, reservationTime },
    });
  });

  events.on('reservation.status_updated', ({ tenantId, reservationId, status, actorId }) => {
    const isWarning = status === 'no_show' || status === 'cancelled';
    notif.create({
      tenantId,
      type:       'reservation.status_updated',
      priority:   isWarning ? 'WARNING' : 'INFO',
      title:      'Reservation update',
      body:       `Reservation marked as ${status.replace('_', ' ')}`,
      entityType: 'dining.reservations',
      entityId:   reservationId,
      actorType:  'staff',
      actorId,
      metadata:   { reservationId, status },
    });
  });

  /* ── Catering Leads ──────────────────────────────────────────────────────── */
  events.on('lead.created', ({ tenantId, leadId, contactName, eventType }) => {
    notif.create({
      tenantId,
      type:       'lead.created',
      priority:   'SUCCESS',
      title:      'New catering enquiry',
      body:       `${contactName}${eventType ? ` · ${eventType}` : ''}`,
      entityType: 'catering.leads',
      entityId:   leadId,
      actorType:  'customer',
      metadata:   { leadId, contactName, eventType },
    });
  });

  events.on('lead.status_updated', ({ tenantId, leadId, status, actorId }) => {
    notif.create({
      tenantId,
      type:       'lead.status_updated',
      priority:   status === 'lost' ? 'WARNING' : 'INFO',
      title:      status === 'lost' ? 'Lead lost' : 'Lead status updated',
      body:       `Lead moved to ${status.replace('_', ' ')}`,
      entityType: 'catering.leads',
      entityId:   leadId,
      actorType:  'staff',
      actorId,
      metadata:   { leadId, status },
    });
  });

  /* ── Dine-In Sessions ────────────────────────────────────────────────────── */
  events.on('session.opened', ({ tenantId, sessionId, tableId, covers }) => {
    notif.create({
      tenantId,
      type:       'session.opened',
      priority:   'INFO',
      title:      'Table session started',
      body:       covers ? `${covers} cover${covers > 1 ? 's' : ''}` : null,
      entityType: 'dining.sessions',
      entityId:   sessionId,
      actorType:  'staff',
      metadata:   { sessionId, tableId, covers },
    });
  });

  events.on('session.closed', ({ tenantId, sessionId, tableId, totalBilled }) => {
    notif.create({
      tenantId,
      type:       'session.closed',
      priority:   'INFO',
      title:      'Table session closed',
      body:       totalBilled ? `Total billed: ₹${Number(totalBilled).toFixed(2)}` : null,
      entityType: 'dining.sessions',
      entityId:   sessionId,
      actorType:  'staff',
      metadata:   { sessionId, tableId, totalBilled },
    });
  });

  events.on('dine_in.order_created', ({ tenantId, orderId, sessionId, total }) => {
    notif.create({
      tenantId,
      type:       'dine_in.order_created',
      priority:   'INFO',
      title:      'New dine-in order',
      body:       `₹${Number(total).toFixed(2)}`,
      entityType: 'orders.orders',
      entityId:   orderId,
      actorType:  'customer',
      metadata:   { orderId, sessionId, total },
    });
  });

  /* ── Reviews ─────────────────────────────────────────────────────────────── */
  events.on('review.submitted', ({ tenantId, stars, orderId }) => {
    const isLow = stars <= 2;
    notif.create({
      tenantId,
      type:       'review.submitted',
      priority:   isLow ? 'WARNING' : 'SUCCESS',
      title:      isLow ? 'Low-rated review received' : 'New review received',
      body:       `${stars} star${stars !== 1 ? 's' : ''}`,
      entityType: orderId ? 'orders.orders' : null,
      entityId:   orderId || null,
      actorType:  'customer',
      metadata:   { stars, orderId },
    });
  });

  /* ── Customer Governance ─────────────────────────────────────────────────── */
  events.on('customer.export_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId,
      type:       'customer.export_requested',
      priority:   'INFO',
      title:      'Customer data export requested',
      entityType: 'customer.customers',
      entityId:   customerId,
      actorType:  'staff',
      actorId,
      metadata:   { customerId },
    });
  });

  events.on('customer.delete_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId,
      type:       'customer.delete_requested',
      priority:   'WARNING',
      title:      'Customer deletion requested',
      body:       'DPDP deletion workflow initiated',
      entityType: 'customer.customers',
      entityId:   customerId,
      actorType:  'staff',
      actorId,
      metadata:   { customerId },
    });
  });

  events.on('customer.correct_requested', ({ tenantId, customerId, actorId }) => {
    notif.create({
      tenantId,
      type:       'customer.correct_requested',
      priority:   'INFO',
      title:      'Customer data corrected',
      entityType: 'customer.customers',
      entityId:   customerId,
      actorType:  'staff',
      actorId,
      metadata:   { customerId },
    });
  });

  /* ── Governance / Exports ────────────────────────────────────────────────── */
  events.on('settings.exported', ({ tenantId, jobId, actorId }) => {
    notif.create({
      tenantId,
      type:       'settings.exported',
      priority:   'INFO',
      title:      'Restaurant data exported',
      entityType: 'platform.export_jobs',
      entityId:   jobId,
      actorType:  'staff',
      actorId,
      metadata:   { jobId },
    });
  });

  /* ── Reserved future events (no-op stubs — prevents accidental crashes) ── */
  const RESERVED = [
    'payment.received', 'payment.failed',
    'subscription.expiring', 'subscription.expired',
    'customer.first_order', 'customer.repeat_visit',
    'menu.item_out_of_stock',
    'staff.created', 'staff.invited',
  ];
  for (const type of RESERVED) {
    events.on(type, () => {});
  }

  console.log('[notifications] Listeners registered.');
}

module.exports = { registerAll };
