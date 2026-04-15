/**
 * INTEGRATION — webhook.js
 * Internal outbound webhook dispatcher.
 *
 * Architecture decision:
 * Every confirmed order and every catering lead fires a webhook to the
 * restaurant's configured webhook_url. This is the platform's integration
 * contract: regardless of whether anything currently listens, the event
 * always fires. This makes future integrations (n8n, Zapier, custom scripts)
 * plug-and-play — the pipeline never needs to change.
 *
 * Payload shape (V10 spec):
 *   {
 *     type:     "order.confirmed" | "lead.created",
 *     rest_id:  17,
 *     order_id: 112,         // present for order events
 *     lead_id:  null,        // present for lead events
 *     ts:       1718000000000
 *   }
 *
 * All calls are fire-and-forget. A webhook failure NEVER blocks the
 * response to the customer. Failures are logged for debugging.
 *
 * Called from:
 *   - services/order.service.js  (offline/COD immediate path)
 *   - services/notify.service.js (Razorpay capture path)
 *   - services/lead.service.js
 */

'use strict';

/**
 * fire(webhookUrl, payload)
 * Sends a POST to the restaurant's webhook_url.
 * Non-blocking — returns immediately, errors are logged not thrown.
 *
 * @param {string|null} webhookUrl - from tenant.webhook_url
 * @param {object}      payload    - event payload per spec
 */
function fire(webhookUrl, payload) {
  // No webhook configured — nothing to do. This is normal for most restaurants.
  if (!webhookUrl) return;

  // Intentionally not awaited. Fire-and-forget is the correct pattern here:
  // a slow or unavailable webhook endpoint must never slow down an order flow.
  fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  }).catch(err => {
    // Log but never throw — webhook failure is operational noise, not a crash
    console.error(`[webhook] fire failed → ${webhookUrl} | ${err.message}`);
  });
}

/**
 * orderConfirmed(tenant, orderId)
 * Fires the order.confirmed event.
 *
 * Example payload:
 *   { type: "order.confirmed", rest_id: 17, order_id: 112, ts: 1718000000000 }
 */
function orderConfirmed(tenant, orderId) {
  fire(tenant.webhook_url, {
    type:     'order.confirmed',
    rest_id:  tenant.rest_id,
    order_id: orderId,
    ts:       Date.now(),
  });
}

/**
 * leadCreated(tenant, leadId)
 * Fires the lead.created event.
 *
 * Example payload:
 *   { type: "lead.created", rest_id: 17, lead_id: 8, ts: 1718000000000 }
 */
function leadCreated(tenant, leadId) {
  fire(tenant.webhook_url, {
    type:    'lead.created',
    rest_id: tenant.rest_id,
    lead_id: leadId,
    ts:      Date.now(),
  });
}

module.exports = { fire, orderConfirmed, leadCreated };
