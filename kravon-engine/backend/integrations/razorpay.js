/**
 * INTEGRATION — razorpay.js
 * Wraps the Razorpay Node SDK for server-side payment order creation.
 *
 * Architecture decisions:
 * - Each restaurant has its own Razorpay key pair stored in the DB.
 * - The key_secret is encrypted at rest (AES-256-GCM via utils/crypto.js).
 * - We instantiate a Razorpay client per-order, not per-process.
 *   This is slightly slower but simpler and fully multi-tenant.
 * - The public key_id is safe to return to the frontend.
 *   The key_secret NEVER leaves this module.
 *
 * Routes must never call this module directly.
 * Only services/order.service.js calls createPayment().
 *
 * Exports (V10 spec interface):
 *   createPayment(tenant, amountPaise) → { razorpayOrderId, razorpayKeyId }
 *   getClient(keyId, keySecret)        → Razorpay instance (for webhook verification)
 */

'use strict';

const Razorpay   = require('razorpay');
const { decrypt } = require('../utils/crypto');

/**
 * createPayment(tenant, amountPaise)
 * Creates a Razorpay order server-side.
 * Returns the order ID and public key needed by the frontend checkout modal.
 *
 * @param {object} tenant      - req.tenant (needs razorpay_key_id + razorpay_key_secret)
 * @param {number} amountPaise      - total in paise (e.g. 49900 = ₹499)
 * @param {number} [internalOrderId] - our DB order id; used as receipt for reconciliation
 * @returns {{ razorpayOrderId: string, razorpayKeyId: string }}
 *
 * Example:
 *   await createPayment(req.tenant, 49900, 112)
 *   → { razorpayOrderId: "order_abc123", razorpayKeyId: "rzp_live_xyz" }
 */
async function createPayment(tenant, amountPaise, internalOrderId) {
  if (!tenant.razorpay_key_id || !tenant.razorpay_key_secret) {
    throw Object.assign(
      new Error('Razorpay not configured for this restaurant.'),
      { status: 400 }
    );
  }

  const secret = decrypt(tenant.razorpay_key_secret);
  const rzp    = getClient(tenant.razorpay_key_id, secret);

  // receipt ties the Razorpay order back to our DB order — unique and traceable.
  // Razorpay caps receipt at 40 chars; rest_id + orderId fits comfortably.
  const receipt = internalOrderId
    ? `kravon_${tenant.rest_id}_${internalOrderId}`
    : `kravon_${tenant.rest_id}_${Date.now()}`;

  const rzpOrder = await rzp.orders.create({
    amount:   amountPaise,
    currency: 'INR',
    receipt,
  });

  return {
    razorpayOrderId: rzpOrder.id,
    razorpayKeyId:   tenant.razorpay_key_id,
  };
}

/**
 * getClient(keyId, keySecret)
 * Returns a Razorpay SDK instance.
 * Used directly in the webhook route for HMAC signature verification.
 *
 * @param {string} keyId     - Razorpay public key
 * @param {string} keySecret - Razorpay secret (plaintext, already decrypted)
 * @returns {Razorpay}
 */
function getClient(keyId, keySecret) {
  if (!keyId || !keySecret) {
    throw Object.assign(
      new Error('Razorpay credentials missing.'),
      { status: 400 }
    );
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

module.exports = { createPayment, getClient };
