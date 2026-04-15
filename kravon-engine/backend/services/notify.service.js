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
  const totalRs   = Math.round(order.total_amount / 100);
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
        `*Subtotal:* ₹${Math.round(order.subtotal / 100)}`,
        order.delivery_fee > 0 ? `*Delivery:* ₹${Math.round(order.delivery_fee / 100)}` : null,
        `*Total:* ₹${totalRs}`,
        `*Payment:* ${payment}`,
        `*Order ID:* ${orderId}`,
      ].filter(Boolean).join('\n');
    }

    await whatsapp.sendOrderNotification(tenant.wa_number, kitchenMsg).catch(err =>
      console.error('[notify] kitchen WA failed:', err.message)
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
      console.error('[notify] customer WA failed:', err.message)
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
      console.error('[notify] lead WA failed:', err.message)
    );
  }

  /* ── 2. Outbound webhook ─────────────────────────────────────────────── */
  webhookBus.leadCreated(tenant, lead.id);
}

module.exports = { orderConfirmed, leadReceived };
