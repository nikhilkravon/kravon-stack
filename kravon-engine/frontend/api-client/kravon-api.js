/**
 * API CLIENT — kravon-api.js
 * The single module all frontend products use to talk to kravon-core.
 *
 * Loaded before any product script. Exposes window.KravonAPI.
 *
 * V9 additions:
 *   - createOrder() now supports order_surface: 'tables' | 'orders'
 *   - submitReview() — new, used by Tables post-order review prompt
 */

'use strict';

const KravonAPI = (() => {

  const API_BASE = typeof KRAVON_API_URL !== 'undefined'
    ? KRAVON_API_URL
    : 'https://api.kravon.in';

  const RESTAURANT_SLUG = typeof RESTAURANT_SLUG_ENV !== 'undefined'
    ? RESTAURANT_SLUG_ENV
    : (() => { throw new Error('RESTAURANT_SLUG is not defined'); })();

  let _config = null;

  function _url(path) {
    return `${API_BASE}/v1/restaurants/${RESTAURANT_SLUG}${path}`;
  }

  async function _post(path, body) {
    const res = await fetch(_url(path), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
    return data;
  }

  /* ── Config ─────────────────────────────────────────────────────────── */
  async function loadConfig() {
    const res = await fetch(_url('/config'));
    if (!res.ok) throw new Error('Failed to load restaurant config');
    const data = await res.json();
    _config = data.config;

    window.CONFIG       = _config;
    window.MENU         = _config.menu.items || _config.menu;  // flat item array for renderer
    window.ADDONS       = _config.addons;
    window.SPICE_LEVELS = _config.spiceLevels;

    return _config;
  }

  function getConfig() {
    if (!_config) throw new Error('Config not loaded. Call loadConfig() first.');
    return _config;
  }

  /* ── Orders ──────────────────────────────────────────────────────────── */
  /**
   * createOrder(orderData) → { order_id, razorpay_order_id, razorpay_key_id, total }
   *
   * Tables surface:
   *   { order_surface: 'tables', customer_name, customer_phone,
   *     table_identifier?, items, payment_method: 'offline'|'razorpay', special_notes? }
   *
   * Orders (delivery) surface:
   *   { order_surface: 'orders', customer_name, customer_phone,
   *     delivery_address, delivery_locality?, delivery_landmark?,
   *     items, delivery_type: 'standard'|'express',
   *     payment_method: 'upi'|'card'|'cod', special_notes? }
   */
  async function createOrder(orderData) {
    return _post('/orders', orderData);
  }

  /* ── Reviews ─────────────────────────────────────────────────────────── */
  /**
   * submitReview(reviewData) → { ok, above_threshold, google_review_url }
   *
   *   { order_id?, stars, feedback?, order_surface?, table_identifier? }
   *
   * google_review_url is only present when stars >= restaurant's review_threshold.
   * Frontend uses this to decide whether to show the Google review nudge.
   */
  async function submitReview(reviewData) {
    return _post('/reviews', reviewData);
  }

  /* ── Catering leads ──────────────────────────────────────────────────── */
  /**
   * submitLead(leadData) → { ref, tier }
   *
   *   { name, company, email, phone, budget?, pax?, event_type?,
   *     date_start?, date_end?, notes? }
   */
  async function submitLead(leadData) {
    return _post('/leads', leadData);
  }

  return { loadConfig, getConfig, createOrder, submitReview, submitLead };

})();

window.KravonAPI = KravonAPI;
