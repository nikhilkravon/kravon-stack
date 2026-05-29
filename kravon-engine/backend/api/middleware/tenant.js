/**
 * MIDDLEWARE — tenant.js
 * Resolves every inbound request to a specific restaurant tenant.
 *
 * Resolution order (first match wins):
 *   1. :slug URL parameter   — /v1/restaurants/burgerhouse/...
 *   2. Kravon subdomain      — Host: burgerhouse.kravon.in
 *   3. Custom domain         — Host: burgerhouse.in (stored in settings.domain)
 *
 * Uses v12 multi-schema: tenant.restaurants is primary source.
 * Operational config (delivery_fee, hours_display, story, etc.) lives in settings JSONB.
 * Contact details come from tenant.locations + brand.contact_links.
 * Payment credentials come from tenant.integrations (provider='razorpay').
 *
 * Cache: 1-minute in-memory TTL keyed by slug.
 */

'use strict';

const { query } = require('../../db/pool');

const _cache = new Map();
const TTL_MS = 60 * 1000;

/**
 * buildTenant — assembles req.tenant from v12 schema rows.
 */
function buildTenant(tenantRow, locationRow, integrations, contactLinks, seoRow) {
  const s    = tenantRow.settings || {};
  const loc  = locationRow        || {};
  const seo  = seoRow             || {};

  const razorpay = integrations.find(r => r.provider === 'razorpay');
  const webhook  = integrations.find(r => r.provider === 'webhook');
  const waLink   = contactLinks.find(r => r.platform === 'whatsapp');

  // https://wa.me/912267891234 → 912267891234
  const wa_number = waLink?.url?.replace(/^https?:\/\/wa\.me\//, '') || s.wa_number || null;

  return {
    tenant_id: tenantRow.id,

    // Backward-compat alias — routes/config that still reference rest_id get the UUID
    rest_id: tenantRow.id,

    slug:   tenantRow.slug,
    name:   tenantRow.name,
    domain: s.domain || null,

    // Feature flags
    has_presence: tenantRow.has_presence,
    has_tables:   tenantRow.has_tables,
    has_orders:   tenantRow.has_orders,
    has_catering: tenantRow.has_catering,
    has_insights: tenantRow.has_insights,

    // Subscription plan — drives the capabilities block in config.js
    plan: tenantRow.plan || 'starter',

    // Contact — primary location row + contact_links
    phone:    loc.phone   || s.phone   || null,
    address:  loc.address || s.address || null,
    city:     loc.city    || s.city    || null,
    email:    s.email     || loc.metadata?.email || null,
    wa_number,

    // SEO / brand
    tagline: seo.meta_description || s.tagline || tenantRow.name,
    year:    s.year || null,

    // Payment — tenant.integrations provider='razorpay'
    razorpay_key_id:     razorpay?.config?.key_id     || s.razorpay_key_id     || null,
    razorpay_key_secret: razorpay?.config?.key_secret || s.razorpay_key_secret || null,

    // Webhook
    webhook_url: webhook?.config?.url || s.webhook_url || null,

    // Operational config — all live in settings JSONB
    delivery_fee:        s.delivery_fee        ?? null,
    free_delivery_above: s.free_delivery_above ?? null,
    review_threshold:    s.review_threshold    ?? 4,
    google_review_url:   s.google_review_url   || null,
    hours_display:       s.hours_display        || null,
    open_until:          s.open_until           || null,
    delivery_zone:       s.delivery_zone        || null,
    map_url:             s.map_url              || null,
    story_headline:      s.story_headline       || null,
    story_body:          s.story_body           || [],
    story_facts:         s.story_facts          || [],

    // Keep settings ref for any caller that needs unlisted fields
    _settings: s,
  };
}

function extractSlug(req) {
  if (req.params && req.params.slug) return req.params.slug;

  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  const KRAVON_DOMAIN = (process.env.KRAVON_DOMAIN || 'kravon.in').toLowerCase();

  if (host.endsWith(`.${KRAVON_DOMAIN}`)) {
    return host.slice(0, -(KRAVON_DOMAIN.length + 1));
  }

  return `__domain__:${host}`;
}

async function resolveRestaurant(req, res, next) {
  const raw = extractSlug(req);

  if (!raw) {
    return res.status(400).json({ error: 'Cannot resolve restaurant: no slug, domain, or subdomain found.' });
  }

  const cached = _cache.get(raw);
  if (cached && (Date.now() - cached.ts) < TTL_MS) {
    req.tenant = cached.tenant;
    return next();
  }

  try {
    let tenantRow;

    if (raw.startsWith('__domain__:')) {
      const domain = raw.slice('__domain__:'.length);
      const result = await query(
        `SELECT id, slug, name, has_presence, has_orders, has_tables, has_catering, has_insights, plan, settings
         FROM tenant.restaurants
         WHERE settings->>'domain' = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [domain]
      );
      tenantRow = result.rows[0];
    } else {
      const result = await query(
        `SELECT id, slug, name, has_presence, has_orders, has_tables, has_catering, has_insights, plan, settings
         FROM tenant.restaurants
         WHERE slug = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [raw]
      );
      tenantRow = result.rows[0];
    }

    if (!tenantRow) {
      return res.status(404).json({ error: 'Restaurant not found.' });
    }

    const tenantId = tenantRow.id;

    // Parallel secondary lookups
    const [locRes, integRes, contactRes, seoRes] = await Promise.all([
      query(
        `SELECT phone, address, city, state, metadata
         FROM tenant.locations
         WHERE tenant_id = $1 AND is_active = TRUE AND deleted_at IS NULL
         ORDER BY created_at LIMIT 1`,
        [tenantId]
      ),
      query(
        `SELECT provider, config
         FROM tenant.integrations
         WHERE tenant_id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
        [tenantId]
      ),
      query(
        `SELECT platform, url
         FROM brand.contact_links
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY position`,
        [tenantId]
      ),
      query(
        `SELECT meta_title, meta_description
         FROM brand.seo
         WHERE tenant_id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [tenantId]
      ),
    ]);

    const tenant = buildTenant(
      tenantRow,
      locRes.rows[0] || null,
      integRes.rows,
      contactRes.rows,
      seoRes.rows[0] || null
    );

    _cache.set(raw, { tenant, ts: Date.now() });
    req.tenant = tenant;
    next();

  } catch (err) {
    next(err);
  }
}

module.exports = { resolveRestaurant, buildTenant };
