/**
 * SERVICE — notify.service.js
 * Dispatches WhatsApp notifications and outbound webhooks after order/lead events.
 *
 * Called from:
 *   - services/order.service.js  (offline/COD immediate path)
 *   - api/routes/webhooks.js     (Razorpay payment.captured path)
 *   - services/lead.service.js   (catering lead creation)
 *
 * All dispatches are async — a notification failure NEVER crashes the order flow.
 *
 * Architecture:
 * - This service owns message formatting (surface-aware: Tables vs Orders).
 * - It calls integrations/whatsapp.js and integrations/webhook.js.
 * - It never calls external APIs directly.
 *
 * V10 changes from V9:
 *   - Uses req.tenant shape (rest_id instead of id)
 *   - Outbound webhook moved to integrations/webhook.js (isolated module)
 *   - leadReceived now also fires outbound webhook
 */

'use strict';

const whatsapp      = require('../integrations/whatsapp');
const webhookBus    = require('../integrations/webhook');
const { query }     = require('../db/pool');

const FRONTEND_URL  = (process.env.KRAVON_FRONTEND_URL || 'https://kravon.in').replace(/\/$/, '');

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function formatItems(itemsJson) {
  let items;
  try {
    items = typeof itemsJson === 'string' ? JSON.parse(itemsJson) : itemsJson;
  } catch {
    return '(item details unavailable)';
  }
  return items.map(i => `${i.qty}× ${i.name} — ₹${i.price * i.qty}`).join('\n');
}

/* ── orderConfirmed ───────────────────────────────────────────────────────── */
/**
 * Fires after order confirmation (Razorpay capture OR offline/COD).
 *
 * Sends:
 *   1. Kitchen WhatsApp (always, when wa_number configured)
 *   2. Customer WhatsApp (delivery orders only — Tables customers are present)
 *   3. Outbound webhook to tenant.webhook_url (always fires per spec)
 *
 * @param {object} tenant - req.tenant shape ({ rest_id, wa_number, webhook_url, ... })
 * @param {object} order  - confirmed order row from DB
 */
async function orderConfirmed(tenant, order) {
  const orderId   = `ORD-${order.id}`;
  const surface   = order.order_surface;
  const table     = order.table_identifier;
  const itemLines = formatItems(order.items_json);
  // DB stores rupees (NUMERIC). Use total field directly — no paise conversion.
  const totalRs   = Math.round(order.total ?? order.total_amount ?? 0);
  const payment   = (order.payment_method || '').toUpperCase();

  /* ── 1. Kitchen WhatsApp ─────────────────────────────────────────────── */
  if (tenant.wa_number) {
    let kitchenMsg;

    if (surface === 'tables') {
      const isDineIn = table && table !== 'takeaway';
      if (isDineIn) {
        kitchenMsg = [
          `🪑 *New Order — Table ${table} · Dine In*`,
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
      // Delivery order
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
      console.error(JSON.stringify({ level: 'error', event: 'notify.kitchen_wa_failed',
        tenantId: tenant.tenant_id, orderId: order.id, message: err.message }))
    );
  }

  /* ── 2. Customer WhatsApp (delivery only) ────────────────────────────── */
  // Tables customers are physically present — no confirmation WA needed.
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
      console.error(JSON.stringify({ level: 'error', event: 'notify.customer_wa_failed',
        tenantId: tenant.tenant_id, orderId: order.id, message: err.message }))
    );
  }

  /* ── 3. Outbound webhook ─────────────────────────────────────────────── */
  // Fire-and-forget via webhook.js. Even if webhook_url is null, the call is safe.
  webhookBus.orderConfirmed(tenant, order.id);
}

/* ── leadReceived ─────────────────────────────────────────────────────────── */
/**
 * Fires after a catering lead is saved.
 *
 * Sends:
 *   1. WhatsApp to restaurant owner
 *   2. Outbound webhook to tenant.webhook_url
 *
 * @param {object} tenant - req.tenant shape
 * @param {object} lead   - { ref, tier, score, name, company, phone, email, ... }
 */
async function leadReceived(tenant, lead) {
  /* ── 1. Owner WhatsApp ───────────────────────────────────────────────── */
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
      console.error(JSON.stringify({ level: 'error', event: 'notify.lead_wa_failed',
        tenantId: tenant.tenant_id, leadId: lead.id, message: err.message }))
    );
  }

  /* ── 2. Outbound webhook ─────────────────────────────────────────────── */
  webhookBus.leadCreated(tenant, lead.id);
}

/* ── reviewRequest ────────────────────────────────────────────────────────── */
/**
 * Sends a WhatsApp review request to a customer after a completed experience.
 *
 * Called from notification.listeners.js when:
 *   - reservation.status_updated → status === 'completed'
 *   - lead.status_updated        → status === 'converted'
 *
 * Looks up:
 *   - tenant slug (to build the review URL)
 *   - customer phone (from reservation or lead row)
 *   - restaurant WhatsApp number (to send from)
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {'reservation'|'catering'} opts.source
 * @param {string} opts.entityId  — reservationId or leadId
 */
async function reviewRequest({ tenantId, source, entityId }) {
  try {
    // Load tenant slug and wa_number
    const tenantRes = await query(
      `SELECT r.slug, cl.url AS wa_url
       FROM tenant.restaurants r
       LEFT JOIN brand.contact_links cl
              ON cl.tenant_id = r.id AND cl.platform = 'whatsapp' AND cl.deleted_at IS NULL
       WHERE r.id = $1 LIMIT 1`,
      [tenantId]
    );
    if (!tenantRes.rows.length) return;

    const { slug, wa_url } = tenantRes.rows[0];

    // Extract wa_number from the WhatsApp contact link URL (https://wa.me/91XXXXXXXXXX)
    const waNumber = wa_url ? wa_url.replace('https://wa.me/', '') : null;
    if (!waNumber) return; // no WhatsApp configured — nothing to send

    // Load customer phone from the relevant entity
    let customerPhone = null;
    let restaurantName = slug;

    if (source === 'reservation') {
      const res = await query(
        `SELECT c.phone, r.name AS restaurant_name
         FROM dining.reservations rv
         LEFT JOIN customer.customers c ON c.id = rv.customer_id
         JOIN tenant.restaurants r ON r.id = rv.tenant_id
         WHERE rv.id = $1 AND rv.tenant_id = $2 LIMIT 1`,
        [entityId, tenantId]
      );
      if (!res.rows.length) return;
      customerPhone  = res.rows[0].phone;
      restaurantName = res.rows[0].restaurant_name;
    } else if (source === 'catering') {
      const res = await query(
        `SELECT l.contact_phone, r.name AS restaurant_name
         FROM catering.leads l
         JOIN tenant.restaurants r ON r.id = l.tenant_id
         WHERE l.id = $1 AND l.tenant_id = $2 LIMIT 1`,
        [entityId, tenantId]
      );
      if (!res.rows.length) return;
      customerPhone  = res.rows[0].contact_phone;
      restaurantName = res.rows[0].restaurant_name;
    }

    if (!customerPhone) return;

    // Build review link
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
      console.error(JSON.stringify({ level: 'error', event: 'notify.review_request_failed',
        tenantId, source, entityId, message: err.message }))
    );

  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'notify.review_request_error',
      tenantId, source, entityId, message: err.message }));
  }
}

module.exports = { orderConfirmed, leadReceived, reviewRequest };
