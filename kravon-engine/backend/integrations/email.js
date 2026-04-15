/**
 * INTEGRATION — email.js
 * Transactional email via Resend.
 *
 * Architecture decisions:
 * - Falls back to console.log in development when RESEND_API_KEY is absent.
 * - Routes must never call this module directly. Only notify.service.js uses it.
 * - Email is currently supplementary to WhatsApp. If WA is unavailable,
 *   email provides the fallback notification channel.
 *
 * Exports (V10 spec interface):
 *   sendOrderNotification({ to, subject, html })
 *   sendLeadNotification({ to, subject, html })
 *   send({ to, subject, html })   — low-level direct use
 */

'use strict';

const { Resend } = require('resend');

let _client = null;

function _getClient() {
  if (!_client) _client = new Resend(process.env.RESEND_API_KEY);
  return _client;
}

/**
 * _send({ to, subject, html })
 * Low-level Resend API call.
 */
async function _send({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email:dev] TO=${to} SUBJECT=${subject}`);
    return;
  }
  const resend = _getClient();
  await resend.emails.send({
    from:    process.env.EMAIL_FROM || 'noreply@kravon.in',
    to,
    subject,
    html,
  });
}

/**
 * sendOrderNotification({ to, subject, html })
 * Sends an order confirmation email.
 *
 * Example:
 *   await sendOrderNotification({
 *     to: 'customer@example.com',
 *     subject: 'Order Confirmed — ORD-112',
 *     html: '<p>Your order is confirmed.</p>'
 *   })
 */
async function sendOrderNotification(opts) {
  return _send(opts);
}

/**
 * sendLeadNotification({ to, subject, html })
 * Sends a catering lead notification to the restaurant.
 *
 * Example:
 *   await sendLeadNotification({
 *     to: 'owner@restaurant.in',
 *     subject: 'New Catering Lead — DFC-1A2B',
 *     html: '<p>New lead received.</p>'
 *   })
 */
async function sendLeadNotification(opts) {
  return _send(opts);
}

// send() kept for direct use
const send = _send;

module.exports = { send, sendOrderNotification, sendLeadNotification };
