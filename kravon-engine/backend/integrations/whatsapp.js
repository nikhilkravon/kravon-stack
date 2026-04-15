/**
 * INTEGRATION — whatsapp.js
 * Sends WhatsApp messages via the Meta Cloud API.
 *
 * Architecture decisions:
 * - Falls back to console.log in development when credentials are absent.
 *   This means the full order flow works locally without a WA account.
 * - To swap provider (e.g. Twilio), replace the _send() implementation only.
 *   The exported interface stays the same.
 * - Routes must never call this module. Only notify.service.js uses it.
 *
 * Exports (V10 spec interface):
 *   sendOrderNotification(to, message)  — kitchen + customer order alerts
 *   sendLeadNotification(to, message)   — catering lead alerts
 *   send(to, message)                   — low-level, used by notify.service.js
 */

'use strict';

/**
 * _send(to, message)
 * Low-level Meta Cloud API call. All exported functions go through this.
 *
 * @param {string} to      - phone number, digits only, country code first (e.g. 917208400844)
 * @param {string} message - plain text message body
 */
async function _send(to, message) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    // Development fallback — log instead of sending
    console.log(`[whatsapp:dev] TO=${to}\n${message}\n`);
    return;
  }

  const url = `https://graph.facebook.com/v18.0/${phoneId}/messages`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API error: ${err}`);
  }
}

/**
 * sendOrderNotification(to, message)
 * Sends an order-related alert (kitchen ticket, customer confirmation).
 *
 * Example:
 *   await sendOrderNotification('917208400844', '🪑 New Order — Table T4\n...')
 */
async function sendOrderNotification(to, message) {
  return _send(to, message);
}

/**
 * sendLeadNotification(to, message)
 * Sends a catering lead alert to the restaurant owner.
 *
 * Example:
 *   await sendLeadNotification('917208400844', '📋 New Lead · DFC-1A2B\n...')
 */
async function sendLeadNotification(to, message) {
  return _send(to, message);
}

// send() kept for direct use in notify.service.js (surface-aware formatting lives there)
const send = _send;

module.exports = { send, sendOrderNotification, sendLeadNotification };
