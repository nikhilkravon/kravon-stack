/**
 * SERVICE — notify.service.js
 * Unified outbound channel dispatcher: WhatsApp, Email, Webhook.
 *
 * Each exported function maps one business event to its channel matrix.
 * Channels are declared per-function — add a channel here, not in listeners.
 *
 * Channel matrix:
 *   orderConfirmed      — WA (kitchen + customer), Webhook
 *   leadReceived        — WA (owner), Webhook
 *   reservationCreated  — WA (owner)
 *   billRequested       — WA (owner)
 *   reviewRequest       — WA (customer)
 *
 * All dispatches are fire-and-forget. A channel failure NEVER crashes the
 * business flow. Failures are logged with structured JSON.
 */

'use strict';

const whatsapp   = require('../integrations/whatsapp');
const email      = require('../integrations/email');
const webhookBus = require('../integrations/webhook');
const { query }  = require('../db/pool');

const FRONTEND_URL = (process.env.KRAVON_FRONTEND_URL || 'https://kravon.in').replace(/\/$/, '');

/* ── Internal helpers ─────────────────────────────────────────────────────── */

function _log(event, extra = {}) {
  console.error(JSON.stringify({ level: 'error', event, ...extra }));
}

function _formatItems(itemsJson) {
  try {
    const items = typeof itemsJson === 'string' ? JSON.parse(itemsJson) : itemsJson;
    return items.map(i => `${i.qty}× ${i.name} — ₹${i.price * i.qty}`).join('\n');
  } catch {
    return '(item details unavailable)';
  }
}

/* ── orderConfirmed ───────────────────────────────────────────────────────── */
/**
 * Channels: WA (kitchen), WA (customer — delivery only), Webhook
 *
 * @param {object} tenant - { tenant_id, slug, name, wa_number, webhook_url }
 * @param {object} order  - order row with flattened metadata fields
 */
async function orderConfirmed(tenant, order) {
  const orderId   = `ORD-${order.id}`;
  const surface   = order.order_surface;
  const table     = order.table_identifier;
  const itemLines = _formatItems(order.items_json);
  const totalRs   = Math.round(order.total ?? order.total_amount ?? 0);
  const payment   = (order.payment_method || '').toUpperCase();

  /* WA — kitchen */
  if (tenant.wa_number) {
    let kitchenMsg;
    if (surface === 'tables') {
      const isDineIn = table && table !== 'takeaway';
      if (isDineIn) {
        kitchenMsg = [
          `🪑 *New Order — ${table} · Dine In*`,
          `─────────────────`,
          itemLines,
          `─────────────────`,
          `*Total:* ₹${totalRs}`,
          `*Payment:* ${payment}`,
          `*Order ID:* ${orderId}`,
        ].join('\n');
      } else {
        kitchenMsg = [
          `🛍 *New Order — Takeaway*`,
          `*Customer:* ${order.customer_name} · ${order.customer_phone}`,
          `─────────────────`,
          itemLines,
          `─────────────────`,
          `*Total:* ₹${totalRs}`,
          `*Payment:* ${payment}`,
          `*Order ID:* ${orderId}`,
        ].join('\n');
      }
    } else {
      kitchenMsg = [
        `📦 *New Delivery Order*`,
        `*Customer:* ${order.customer_name} · ${order.customer_phone}`,
        `*Address:* ${order.delivery_address || '—'}${order.delivery_locality ? ', ' + order.delivery_locality : ''}`,
        `─────────────────`,
        itemLines,
        `─────────────────`,
        `*Subtotal:* ₹${Math.round(order.subtotal ?? 0)}`,
        order.delivery_fee > 0 ? `*Delivery:* ₹${Math.round(order.delivery_fee ?? 0)}` : null,
        `*Total:* ₹${totalRs}`,
        `*Payment:* ${payment}`,
        `*Order ID:* ${orderId}`,
      ].filter(Boolean).join('\n');
    }

    await whatsapp.sendOrderNotification(tenant.wa_number, kitchenMsg).catch(err =>
      _log('notify.kitchen_wa_failed', { tenantId: tenant.tenant_id, orderId: order.id, message: err.message })
    );
  }

  /* WA — customer (delivery only; dine-in guests are present) */
  if (surface === 'orders' && order.customer_phone) {
    const customerMsg = [
      `✅ *Order Confirmed — ${orderId}*`,
      ``,
      `Your order is in the kitchen.`,
      ``,
      `*Total:* ₹${totalRs}`,
      `*Payment:* ${payment}`,
    ].join('\n');

    await whatsapp.sendOrderNotification(order.customer_phone, customerMsg).catch(err =>
      _log('notify.customer_wa_failed', { tenantId: tenant.tenant_id, orderId: order.id, message: err.message })
    );
  }

  /* Webhook */
  webhookBus.orderConfirmed(tenant, order.id);
}

/* ── leadReceived ─────────────────────────────────────────────────────────── */
/**
 * Channels: WA (owner), Webhook
 *
 * @param {object} tenant - { tenant_id, wa_number, webhook_url }
 * @param {object} lead   - { id, ref, tier, score, name, company, phone, email, event_type, headcount, budget }
 */
async function leadReceived(tenant, lead) {
  /* WA — owner */
  if (tenant.wa_number) {
    const tierEmoji = { hot: '🔥', warm: '◎', cool: '○' }[lead.tier] || '';
    const msg = [
      `📋 *New Catering Lead · ${lead.ref}*`,
      ``,
      `*Name:* ${lead.name}`,
      `*Company:* ${lead.company}`,
      `*Phone:* ${lead.phone}`,
      `*Email:* ${lead.email}`,
      ``,
      `*Type:* ${lead.event_type || '—'}`,
      `*Pax:* ${lead.headcount || '—'}`,
      `*Budget:* ${lead.budget || '—'}`,
      ``,
      `*Score:* ${lead.score}/10 · ${tierEmoji} ${lead.tier?.toUpperCase()}`,
    ].filter(Boolean).join('\n');

    await whatsapp.sendLeadNotification(tenant.wa_number, msg).catch(err =>
      _log('notify.lead_wa_failed', { tenantId: tenant.tenant_id, leadId: lead.id, message: err.message })
    );
  }

  /* Webhook */
  webhookBus.leadCreated(tenant, lead.id);
}

/* ── reservationCreated ───────────────────────────────────────────────────── */
/**
 * Channels: WA (owner)
 *
 * @param {object} tenant      - { tenant_id, name, wa_number }
 * @param {object} reservation - { id, contact_name, party_size, reservation_time, notes }
 */
async function reservationCreated(tenant, reservation) {
  if (!tenant.wa_number) return;

  const dt = new Date(reservation.reservation_time).toLocaleString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  const msg = [
    `📅 *New Reservation — ${tenant.name}*`,
    ``,
    `*Guest:* ${reservation.contact_name}`,
    `*Party:* ${reservation.party_size} guest${reservation.party_size !== 1 ? 's' : ''}`,
    `*Time:* ${dt}`,
    reservation.notes ? `*Notes:* ${reservation.notes}` : null,
  ].filter(Boolean).join('\n');

  await whatsapp.send(tenant.wa_number, msg).catch(err =>
    _log('notify.reservation_wa_failed', { tenantId: tenant.tenant_id, reservationId: reservation.id, message: err.message })
  );
}

/* ── billRequested ────────────────────────────────────────────────────────── */
/**
 * Channels: WA (owner)
 *
 * Called from dine_in.bill_requested listener after table name is resolved.
 *
 * @param {object} tenant    - { tenant_id, wa_number }
 * @param {string} tableName - resolved table name e.g. "Table T4"
 * @param {string} sessionId
 */
async function billRequested(tenant, tableName, sessionId) {
  if (!tenant.wa_number) return;

  const msg = [
    `🧾 *Bill Requested — ${tableName}*`,
    ``,
    `Guests are ready to pay.`,
    `Please bring the bill to ${tableName}.`,
  ].join('\n');

  await whatsapp.send(tenant.wa_number, msg).catch(err =>
    _log('notify.bill_wa_failed', { tenantId: tenant.tenant_id, sessionId, message: err.message })
  );
}

/* ── reviewRequest ────────────────────────────────────────────────────────── */
/**
 * Channels: WA (customer)
 *
 * Looks up tenant slug + customer phone from the relevant entity.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {'reservation'|'catering'} opts.source
 * @param {string} opts.entityId
 */
async function reviewRequest({ tenantId, source, entityId }) {
  try {
    const tenantRes = await query(
      `SELECT r.slug, r.name, cl.url AS wa_url
       FROM tenant.restaurants r
       LEFT JOIN brand.contact_links cl
              ON cl.tenant_id = r.id AND cl.platform = 'whatsapp' AND cl.deleted_at IS NULL
       WHERE r.id = $1 LIMIT 1`,
      [tenantId]
    );
    if (!tenantRes.rows.length) return;

    const { slug, name: restaurantName, wa_url } = tenantRes.rows[0];
    const waNumber = wa_url ? wa_url.replace('https://wa.me/', '') : null;
    if (!waNumber) return;

    let customerPhone = null;

    if (source === 'reservation') {
      const res = await query(
        `SELECT c.phone
         FROM dining.reservations rv
         LEFT JOIN customer.customers c ON c.id = rv.customer_id
         WHERE rv.id = $1 AND rv.tenant_id = $2 LIMIT 1`,
        [entityId, tenantId]
      );
      customerPhone = res.rows[0]?.phone || null;
    } else if (source === 'catering') {
      const res = await query(
        `SELECT contact_phone AS phone FROM catering.leads
         WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [entityId, tenantId]
      );
      customerPhone = res.rows[0]?.phone || null;
    }

    if (!customerPhone) return;

    const reviewUrl = `${FRONTEND_URL}/${slug}/review/?slug=${slug}&source=${source}&${source === 'reservation' ? 'reservation' : 'lead'}=${entityId}`;

    const msg = [
      `Hi! Thank you for visiting *${restaurantName}* 🙏`,
      ``,
      `We'd love to know how your experience was.`,
      `It only takes 10 seconds:`,
      ``,
      reviewUrl,
    ].join('\n');

    await whatsapp.sendOrderNotification(customerPhone, msg).catch(err =>
      _log('notify.review_request_failed', { tenantId, source, entityId, message: err.message })
    );
  } catch (err) {
    _log('notify.review_request_error', { tenantId, source, entityId, message: err.message });
  }
}

module.exports = { orderConfirmed, leadReceived, reservationCreated, billRequested, reviewRequest };
