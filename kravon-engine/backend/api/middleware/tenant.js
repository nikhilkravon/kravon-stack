/**
 * MIDDLEWARE — tenant.js
 * Resolves every inbound request to a specific restaurant tenant.
 *
 * Resolution order (first match wins):
 *   1. :slug URL parameter   — /v1/restaurants/burgerhouse/...
 *   2. Custom domain         — Host: burgerhouse.in
 *   3. Kravon subdomain      — Host: burgerhouse.kravon.in
 *
 * Attaches req.tenant with shape matching the V10 spec:
 *   {
 *     rest_id:      17,
 *     slug:         "burgerhouse",
 *     domain:       "burgerhouse.in",
 *     has_presence: true,
 *     has_tables:   true,
 *     has_orders:   false,
 *     has_catering: true,
 *     has_insights: false,
 *     ...full restaurant row
 *   }
 *
 * NOTE: V10 — the database now uses rest_id (renamed from restaurant_id via v10-column-rename migration).
 * All queries use rest_id directly.
 * 
 *
 * Cache: 1-minute in-memory TTL keyed by slug.
 * Trade-off: a newly-added restaurant appears within 60s.
 * Acceptable for the current scale. Invalidate by restarting the process.
 */

'use strict';

const { query } = require('../../db/pool');

// Simple in-process cache. Keyed by slug.
const _cache  = new Map();
const TTL_MS  = 60 * 1000; // 1 minute

/**
 * Build the req.tenant object from a DB restaurant row.
 * This is the single place where DB column names map to spec names.
 *
 * @param {object} publicRow - raw Postgres row from public.restaurants
 * @param {object} tenantRow - raw Postgres row from tenant.restaurants (optional)
 * @returns {object} tenant object per V10 spec + tenant_id
 */
function buildTenant(publicRow, tenantRow = null) {
  return {
    // V10 spec name (rest_id) ← DB column (rest_id)
    rest_id:      publicRow.rest_id,

    // New: tenant UUID from tenant.restaurants (null if not found)
    tenant_id:    tenantRow?.id || null,

    // Core identity
    slug:         publicRow.slug,
    domain:       publicRow.domain       || null,
    name:         publicRow.name,
    tagline:      publicRow.tagline,

    // Product flags — routes check these before executing
    has_presence: publicRow.has_presence,
    has_tables:   publicRow.has_tables,
    has_orders:   publicRow.has_orders,
    has_catering: publicRow.has_catering,
    has_insights: publicRow.has_insights,

    // Contact
    phone:        publicRow.phone,
    wa_number:    publicRow.wa_number,
    email:        publicRow.email,
    address:      publicRow.address,
    city:         publicRow.city,

    // Payment
    razorpay_key_id:     publicRow.razorpay_key_id,
    razorpay_key_secret: publicRow.razorpay_key_secret,

    // Tables config
    review_threshold:  publicRow.review_threshold,
    google_review_url: publicRow.google_review_url,

    // Delivery config
    delivery_fee:        publicRow.delivery_fee,
    free_delivery_above: publicRow.free_delivery_above,

    // Webhook
    webhook_url:  publicRow.webhook_url,

    // Hours
    hours_display: publicRow.hours_display,
    open_until:    publicRow.open_until,

    // Story
    story_headline: publicRow.story_headline,

    // Raw row kept for any fields not explicitly mapped above
    _row: publicRow,
  };

}

/**
 * extractSlug(req)
 * Determines the restaurant slug from the request using three sources.
 * Returns null if no slug can be found.
 */
function extractSlug(req) {
  // Source 1: URL parameter (most explicit — always wins)
  if (req.params && req.params.slug) {
    return req.params.slug;
  }

  const host = (req.headers.host || '').toLowerCase().split(':')[0]; // strip port

  // Source 2: Kravon subdomain — burgerhouse.kravon.in
  const KRAVON_DOMAIN = (process.env.KRAVON_DOMAIN || 'kravon.in').toLowerCase();
  if (host.endsWith(`.${KRAVON_DOMAIN}`)) {
    return host.slice(0, -(KRAVON_DOMAIN.length + 1)); // strip .kravon.in
  }

  // Source 3: Custom domain — burgerhouse.in (looked up by domain column)
  // Return the full host so the DB lookup can match against the domain column.
  // We signal this with a special prefix so the caller knows it's a domain, not a slug.
  return `__domain__:${host}`;
}

/**
 * resolveRestaurant(req, res, next)
 * Main middleware. Resolves tenant and attaches req.tenant.
 *
 * Example: GET /v1/restaurants/burgerhouse/config
 *   → req.params.slug = "burgerhouse"
 *   → DB lookup → req.tenant = { rest_id: 17, slug: "burgerhouse", ... }
 */
async function resolveRestaurant(req, res, next) {
  const raw = extractSlug(req);

  if (!raw) {
    return res.status(400).json({ error: 'Cannot resolve restaurant: no slug, domain, or subdomain found.' });
  }

  // Check cache first
  const cached = _cache.get(raw);
  if (cached && (Date.now() - cached.ts) < TTL_MS) {
    req.tenant = cached.tenant;
    return next();
  }

  try {
    let publicRow, tenantRow;

    if (raw.startsWith('__domain__:')) {
      // Domain resolution — look up by domain column
      const domain = raw.slice('__domain__:'.length);
      const result = await query(
        'SELECT * FROM restaurants WHERE domain = $1 LIMIT 1',
        [domain]
      );
      publicRow = result.rows[0];
    } else {
      // Slug resolution
      const result = await query(
        'SELECT * FROM restaurants WHERE slug = $1 LIMIT 1',
        [raw]
      );
      publicRow = result.rows[0];
    }

    if (!publicRow) {
      return res.status(404).json({ error: 'Restaurant not found.' });
    }

    // Also fetch tenant data if available
    if (publicRow.slug) {
      const tenantResult = await query(
        'SELECT id FROM tenant.restaurants WHERE slug = $1 LIMIT 1',
        [publicRow.slug]
      );
      tenantRow = tenantResult.rows[0];
    }

    const tenant = buildTenant(publicRow, tenantRow);
    _cache.set(raw, { tenant, ts: Date.now() });
    req.tenant = tenant;
    next();

  } catch (err) {
    next(err);
  }
}

// Keep backward-compat alias — old code referencing resolveRestaurant still works
module.exports = { resolveRestaurant, buildTenant };
