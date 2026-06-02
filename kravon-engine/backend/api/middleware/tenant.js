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
 * Presence marketing content comes from brand.assets + brand.announcements + settings.
 *
 * Cache: 1-minute in-memory TTL keyed by slug.
 */

'use strict';

const { query } = require('../../db/pool');

const _cache   = new Map();
const TTL_MS   = 60 * 1000;
const MAX_SIZE = 500;

/**
 * buildTenant — assembles req.tenant from v12 schema rows.
 */
function buildTenant(tenantRow, locationRow, integrations, contactLinks, seoRow, assets, announcements) {
  const s       = tenantRow.settings || {};
  const loc     = locationRow        || {};
  const seo     = seoRow             || {};
  // Presence content: consolidated owner is settings.presence.
  // Fallback to scattered legacy keys so existing DB rows still work.
  const pres    = s.presence        || {};
  const presSt  = pres.story        || {};

  const razorpay = integrations.find(r => r.provider === 'razorpay');
  const webhook  = integrations.find(r => r.provider === 'webhook');
  const waLink   = contactLinks.find(r => r.platform === 'whatsapp');

  // https://wa.me/912267891234 → 912267891234
  const wa_number = waLink?.url?.replace(/^https?:\/\/wa\.me\//, '') || s.wa_number || null;

  // Presence — hero image + logo (from brand.assets)
  const bannerAssets  = assets.filter(a => a.type === 'banner').sort((a, b) => (a.metadata?.order || 0) - (b.metadata?.order || 0));
  const bannerAsset   = bannerAssets[0] || null;
  const logoAsset     = assets.find(a => a.type === 'logo');
  const storyAsset    = assets.find(a => a.type === 'story');
  const galleryAssets = assets.filter(a => a.type === 'gallery');

  return {
    tenant_id: tenantRow.id,

    slug:   tenantRow.slug,
    name:   tenantRow.name,
    domain: s.domain || null,

    // Feature flags
    has_presence: tenantRow.has_presence,
    has_tables:   tenantRow.has_tables,
    has_orders:   tenantRow.has_orders,
    has_catering: tenantRow.has_catering,
    has_insights: tenantRow.has_insights,

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

    // Payment
    razorpay_key_id:     razorpay?.config?.key_id     || s.razorpay_key_id     || null,
    razorpay_key_secret: razorpay?.config?.key_secret || s.razorpay_key_secret || null,
    webhook_url: webhook?.config?.url || s.webhook_url || null,

    // Operational config — settings JSONB
    delivery_fee:        s.delivery_fee        ?? null,
    free_delivery_above: s.free_delivery_above ?? null,
    review_threshold:    s.review_threshold    ?? 4,
    google_review_url:   s.google_review_url   || null,
    hours_display:       s.hours_display        || null,
    open_until:          s.open_until           || null,
    delivery_zone:       s.delivery_zone        || null,
    map_url:             s.map_url              || null,
    story_headline:      presSt.headline         || s.story_headline || null,
    story_body:          presSt.body             || s.story_body     || [],
    story_facts:         presSt.facts            || s.story_facts    || [],

    // Presence marketing — brand.assets
    logo_url:    logoAsset?.url          || null,
    hero_image:  bannerAsset?.url        || null,
    hero_images: bannerAssets.map(a => a.url),
    story_image: storyAsset?.url        || null,
    gallery: {
      food:     galleryAssets.filter(a => a.metadata?.category === 'food')    .map(a => a.url),
      ambience: galleryAssets.filter(a => a.metadata?.category === 'ambience').map(a => a.url),
      people:   galleryAssets.filter(a => a.metadata?.category === 'people')  .map(a => a.url),
    },

    // Presence marketing — brand.announcements
    featured: announcements.map(a => ({
      id:          a.id,
      title:       a.title,
      description: a.body,
      image:       a.image_url   || null,
      ctaLabel:    a.cta_label   || null,
      ctaUrl:      a.cta_url     || null,
      active:      a.is_active,
    })),

    timeline:         pres.timeline         || s.timeline         || [],
    signature_dishes: pres.signature_dishes || s.signature_dishes || [],

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

    const [locRes, integRes, contactRes, seoRes, assetRes, annRes] = await Promise.all([
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
      query(
        `SELECT type, url, alt_text, metadata
         FROM brand.assets
         WHERE tenant_id = $1 AND type IN ('banner', 'logo', 'gallery', 'story') AND deleted_at IS NULL
         ORDER BY created_at`,
        [tenantId]
      ),
      query(
        `SELECT id, title, body, image_url, cta_label, cta_url, is_active
         FROM brand.announcements
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY created_at`,
        [tenantId]
      ),
    ]);

    const tenant = buildTenant(
      tenantRow,
      locRes.rows[0]  || null,
      integRes.rows,
      contactRes.rows,
      seoRes.rows[0]  || null,
      assetRes.rows,
      annRes.rows,
    );

    if (_cache.size >= MAX_SIZE) {
      // Evict the oldest entry (Map preserves insertion order)
      _cache.delete(_cache.keys().next().value);
    }
    _cache.set(raw, { tenant, ts: Date.now() });
    req.tenant = tenant;
    next();

  } catch (err) {
    next(err);
  }
}

module.exports = { resolveRestaurant, buildTenant };
