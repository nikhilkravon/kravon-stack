/**
 * ROUTE — config.js
 * GET   /v1/restaurants/:slug/config          — full config for frontend renderer
 * PATCH /v1/restaurants/:slug/config          — update restaurant settings (admin)
 * GET   /v1/restaurants/:slug/config/items/:id — item detail with variants + customizations
 *
 * Public GET — no authentication required.
 */

'use strict';

const express        = require('express');
const { z }          = require('zod');
const catalogConfig  = require('../../domains/catalog/config-service');
const tenancyService = require('../../domains/tenancy/service');
const { requireRestaurantAuth } = require('../middleware/auth');
const { validateSettingsPatch } = require('../../db/settingsSchema');
const audit          = require('../../utils/audit');
const https          = require('https');
const http           = require('http');

const router = express.Router();

/* ── Config cache ─────────────────────────────────────────────────────────── */
const _configCache = new Map();
const CONFIG_TTL   = 60 * 1000;

function _cacheKey(tenantId, surface) { return `${tenantId}:${surface || 'all'}`; }

function getConfigCached(tenantId, surface) {
  const entry = _configCache.get(_cacheKey(tenantId, surface));
  if (entry && Date.now() - entry.ts < CONFIG_TTL) return entry.data;
  return null;
}

function setConfigCached(tenantId, surface, data) {
  if (_configCache.size > 500) _configCache.delete(_configCache.keys().next().value);
  _configCache.set(_cacheKey(tenantId, surface), { data, ts: Date.now() });
}

function bustConfigCache(tenantId) {
  for (const key of _configCache.keys()) {
    if (key.startsWith(`${tenantId}:`)) _configCache.delete(key);
  }
}

/* ── Google Maps coord extraction ────────────────────────────────────────── */
async function _parseGoogleMapsCoords(rawUrl) {
  let url = rawUrl;
  if (/goo\.gl/.test(url)) {
    try {
      url = await new Promise(resolve => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: 4000 }, res => {
          resolve(res.headers.location || url);
          res.destroy();
        });
        req.on('error', () => resolve(url));
        req.on('timeout', () => { req.destroy(); resolve(url); });
      });
    } catch { /* keep original */ }
  }

  try {
    const u = new URL(url);
    const atMatch = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
    const q = u.searchParams.get('q');
    if (q) { const qm = q.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/); if (qm) return { lat: parseFloat(qm[1]), lng: parseFloat(qm[2]) }; }
    const ll = u.searchParams.get('ll');
    if (ll) { const lm = ll.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/); if (lm) return { lat: parseFloat(lm[1]), lng: parseFloat(lm[2]) }; }
    const center = u.searchParams.get('center');
    if (center) { const cm = center.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/); if (cm) return { lat: parseFloat(cm[1]), lng: parseFloat(cm[2]) }; }
    const placeMatch = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (placeMatch) return await _nominatimGeocode(decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')));
  } catch { /* invalid URL */ }

  return null;
}

function _nominatimGeocode(placeName) {
  return new Promise(resolve => {
    const options = {
      hostname: 'nominatim.openstreetmap.org',
      path:     `/search?q=${encodeURIComponent(placeName)}&format=json&limit=1`,
      headers:  { 'User-Agent': 'kravon-platform/1.0 (settings save)' },
      timeout:  5000,
    };
    const req = https.get(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const results = JSON.parse(body);
          resolve(results[0] ? { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) } : null);
        } catch { resolve(null); }
      });
    });
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/* ── GET /config ──────────────────────────────────────────────────────────── */
const VALID_SURFACES = new Set(['delivery', 'pickup', 'dine_in', 'catering']);

router.get('/', async (req, res, next) => {
  try {
    const r       = req.tenant;
    const id      = r.tenant_id;
    const surface = VALID_SURFACES.has(req.query.surface) ? req.query.surface : null;

    const cached = getConfigCached(id, surface);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(cached);
    }

    const { categories, flatItems } = await catalogConfig.getMenuData(id, surface);

    const locationRows = [
      r.address      ? { icon: '📍', title: 'Address',      body: r.address,       highlight: false } : null,
      r.phone        ? { icon: '📞', title: 'Phone',         body: r.phone,         highlight: false } : null,
      r.email        ? { icon: '✉️',  title: 'Email',         body: r.email,         highlight: false } : null,
      r.hours_display? { icon: '🕐', title: 'Hours',         body: r.hours_display, highlight: true  } : null,
      r.delivery_zone? { icon: '🛵', title: 'Delivery Zone', body: r.delivery_zone, highlight: false } : null,
    ].filter(Boolean);

    const config = {
      tenant_id: id,
      slug:      r.slug,
      meta: {
        title:       `${r.name} — Order Direct`,
        description: `${r.name} — ${r.tagline}`,
      },
      brand: {
        name:    r.name,
        tagline: r.tagline,
        year:    r.year || String(new Date().getFullYear()),
        eyebrow: r.tagline || '',
        logoUrl: r.logo_url || null,
      },
      contact: {
        phone:        r.phone        || '',
        waNumber:     r.wa_number    || '',
        waGreeting:   `Hi! I'd like to order from ${r.name}`,
        email:        r.email        || '',
        address:      r.address      || '',
        city:         r.city         || '',
        deliveryZone: r.delivery_zone || '',
      },
      hours: {
        display:       r.hours_display || '',
        openUntil:     r.open_until    || '',
        navBadge:      r.hours_display || 'Open Now',
        kitchenNote:   r.hours_display || '',
        acceptsOrders: r.accepts_orders !== false,
      },
      reservations: {
        acceptsReservations: r.reservations?.accepts_reservations !== false,
        maxAdvanceDays:      r.reservations?.max_advance_days  ?? 30,
        minAdvanceHours:     r.reservations?.min_advance_hours ?? 2,
        maxPartySize:        r.reservations?.max_party_size    ?? 12,
        slots:               r.reservations?.slots             ?? [],
      },
      capabilities: {
        website:         true,
        orderManagement: !!r.has_orders,
        payments:        !!(r.has_orders && r.razorpay_key_id),
        tables:          !!r.has_tables,
        catering:        !!r.has_catering,
        analytics:       !!r.has_insights,
        checkoutStrategy: r.has_orders ? 'orders' : 'whatsapp',
        plan:             r.plan || 'starter',
      },
      tables: r.has_tables ? {
        paymentMode:     r.razorpay_key_id ? 'razorpay' : 'offline',
        razorpayKeyId:   r.razorpay_key_id  || null,
        reviewThreshold: r.review_threshold ?? 4,
        googleReviewUrl: r.google_review_url || null,
      } : null,
      gst: r.gst ? {
        enabled:   !!r.gst.enabled,
        gstin:     r.gst.gstin     || null,
        cgst_rate: r.gst.cgst_rate ?? 0,
        sgst_rate: r.gst.sgst_rate ?? 0,
        inclusive: !!r.gst.inclusive,
      } : null,
      order: {
        currency:          '₹',
        minOrder:          0,
        deliveryFee:       r.delivery_fee        != null ? r.delivery_fee / 100        : null,
        freeDeliveryAbove: r.free_delivery_above != null ? r.free_delivery_above / 100 : null,
        footnote:          '',
      },
      orders: {
        deliveryStandard:      r.delivery_fee        != null ? r.delivery_fee / 100        : 39,
        deliveryExpress:       r.delivery_fee        != null ? (r.delivery_fee / 100) * 2  : 78,
        freeDeliveryAt:        r.free_delivery_above != null ? r.free_delivery_above / 100 : 399,
        gstRate:               0,
        paymentMethods: r.razorpay_key_id
          ? [
              { id: 'upi',  icon: '📱', label: 'UPI / QR',          sub: 'Google Pay, PhonePe, Paytm' },
              { id: 'card', icon: '💳', label: 'Card',               sub: 'Visa, Mastercard, RuPay'    },
              { id: 'cod',  icon: '💵', label: 'Cash on Delivery',   sub: 'Pay when delivered'         },
            ]
          : [{ id: 'cod', icon: '💵', label: 'Cash on Delivery', sub: 'Pay when delivered' }],
        gatewayNote: r.razorpay_key_id
          ? { label: 'Secured by Razorpay', body: 'PCI-DSS compliant payment gateway.' }
          : null,
        navDirectLabel:        'Order Direct',
        deliveryEta:           '30–45 min',
        deliveryStandardLabel: 'Standard Delivery',
        deliveryStandardSub:   '30–45 min',
        deliveryExpressLabel:  'Express Delivery',
        deliveryExpressSub:    '15–20 min',
        cartEmptyText:         'Your cart is empty',
        termsNote:             'No cancellation once confirmed. Prices inclusive of taxes.',
        confirmHeadline:       'Order Placed!',
        confirmSub:            `We'll prepare your order and send you updates on WhatsApp.`,
        confirmWaNote:         'Order updates will be sent to your WhatsApp.',
        directAdvantages:      [],
        form: {
          namePlaceholder:     'Your name',
          phonePlaceholder:    '10-digit mobile number',
          addressPlaceholder:  'Delivery address',
          localityPlaceholder: 'Area / Locality',
          landmarkPlaceholder: 'Landmark (optional)',
        },
        footerDataNote:  '',
        poweredByText:   'Powered by',
        poweredByLabel:  'Kravon',
        poweredByLink:   'https://kravon.in',
        upgradeBridge:   null,
      },
      hero: {
        eyebrow:  r.tagline || '',
        headline: r.name    || '',
        sub:      r.tagline || '',
        image:    r.hero_image  || null,
        images:   r.hero_images?.length ? r.hero_images : (r.hero_image ? [r.hero_image] : []),
        footnote: r.hours_display || '',
        stats:    [],
      },
      story: {
        label:    'Our Story',
        headline: r.story_headline || `About ${r.name}`,
        body:     r.story_body     || [],
        facts:    r.story_facts    || [],
        image:    r.story_image    || null,
      },
      how: {
        label:    'How It Works',
        headline: 'Order in minutes',
        steps: [
          { title: 'Browse the menu',     body: 'Pick your favourites from our menu.' },
          { title: 'Message on WhatsApp', body: 'Send your order directly to us.'     },
          { title: 'Enjoy your food',     body: 'We handle the rest.'                 },
        ],
        benefits: [],
        waCard: { icon: '💬', title: 'Quick & Easy', ctaLabel: 'Start Order' },
      },
      reviews: { label: 'Reviews', headline: 'What our customers say', items: [] },
      location: {
        label:    r.address || r.city || '',
        mapLabel: `${r.name}${r.city ? ' — ' + r.city : ''}`,
        pinName:  r.name || '',
        pinSub:   r.city || '',
        mapUrl:   r.map_url || null,
        lat:      r.loc_lat  ? Number(r.loc_lat)  : null,
        lng:      r.loc_lng  ? Number(r.loc_lng)  : null,
        rows:     locationRows,
      },
      menu: {
        label:    'Menu',
        headline: 'What we serve',
        waNote:   'Order via WhatsApp',
        items:    flatItems,
      },
      categories,
      footer: {
        poweredBy:    'Powered by',
        poweredLabel: 'Kravon',
        poweredUrl:   'https://kravon.in',
        privacyNote:  '',
      },
      gallery:         r.gallery          || { food: [], ambience: [], people: [] },
      featured:        r.featured         || [],
      signatureDishes: r.signature_dishes || [],
      timeline:        r.timeline         || [],
      ...(r.has_catering ? (r._settings?.catering || {}) : {}),
      demo:    null,
      upgrade: null,
    };

    const payload = { ok: true, config };
    setConfigCached(id, surface, payload);
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(payload);
  } catch (err) {
    console.error('Config route error:', err);
    next(err);
  }
});

/* ── PATCH /config ───────────────────────────────────────────────────────── */
const GstSchema = z.object({
  enabled:   z.boolean(),
  gstin:     z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).optional().nullable(),
  cgst_rate: z.number().min(0).max(14),
  sgst_rate: z.number().min(0).max(14),
  inclusive: z.boolean(),
});

const SettingsUpdateSchema = z.object({
  name:                z.string().min(1).max(150).optional(),
  tagline:             z.string().max(300).optional(),
  hours_display:       z.string().max(100).optional(),
  open_until:          z.string().max(40).optional(),
  accepts_orders:      z.boolean().optional(),
  reservations: z.object({
    accepts_reservations: z.boolean().optional(),
    max_advance_days:     z.number().int().min(1).max(365).optional(),
    min_advance_hours:    z.number().min(0).max(168).optional(),
    max_party_size:       z.number().int().min(1).max(100).optional(),
    slots: z.array(z.object({
      day:        z.number().int().min(0).max(6),
      open:       z.string().regex(/^\d{2}:\d{2}$/),
      close:      z.string().regex(/^\d{2}:\d{2}$/),
      max_covers: z.number().int().min(0).optional(),
    })).optional(),
  }).optional(),
  email:               z.string().email().max(150).optional(),
  phone:               z.string().max(30).optional(),
  wa_number:           z.string().regex(/^\d{10,15}$/).optional(),
  address:             z.string().max(500).optional(),
  city:                z.string().max(100).optional(),
  delivery_fee:        z.number().min(0).optional(),
  free_delivery_above: z.number().min(0).optional(),
  delivery_zone:       z.string().max(200).optional(),
  google_review_url:   z.string().url().max(300).optional(),
  review_threshold:    z.number().int().min(1).max(5).optional(),
  map_url:             z.string().url().max(500).optional(),
  razorpay_key_id:     z.string().max(40).optional(),
  razorpay_key_secret: z.string().max(200).optional(),
  gst:                 GstSchema.optional(),
});

router.patch('/', requireRestaurantAuth, async (req, res, next) => {
  const parsed = SettingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      error:   'Validation failed',
      code:    'validation_error',
      details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(422).json({ error: 'No fields provided' });
  }

  try {
    const tenantId = req.tenant.tenant_id;
    const d        = parsed.data;

    await tenancyService.updateSettings(tenantId, d);

    if (d.map_url) {
      const coords = await _parseGoogleMapsCoords(d.map_url);
      if (coords) await tenancyService.updateLocationCoords(tenantId, coords.lat, coords.lng);
    }

    bustConfigCache(tenantId);
    require('../middleware/tenant').clearTenantCache(req.tenant.slug);

    audit.log(null, {
      tenantId, actorId: req.auth?.staffId, actorType: 'staff',
      action: 'config.update', entityType: 'tenant.restaurant', entityId: tenantId,
      newValue: d, req,
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── GET /items/:id ──────────────────────────────────────────────────────── */
router.get('/items/:id', async (req, res, next) => {
  try {
    const item = await catalogConfig.getItemDetail(req.tenant.tenant_id, req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.bustConfigCache = bustConfigCache;
