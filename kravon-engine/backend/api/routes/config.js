/**
 * ROUTE — config.js
 * GET /v1/restaurants/:slug/config
 *
 * Returns the full CONFIG object for the frontend renderer.
 * Public — no authentication required.
 * Uses v12 multi-schema: menu.categories, menu.menu_items, etc.
 */

'use strict';

const express = require('express');
const { z }   = require('zod');
const { query } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');
const { validateSettingsPatch } = require('../../db/settingsSchema');
const audit   = require('../../utils/audit');

const router = express.Router();
const https  = require('https');
const http   = require('http');

/**
 * Parse lat/lng from any Google Maps URL an owner might paste.
 *
 * Handles:
 *   https://maps.google.com/?q=19.0654,72.8343
 *   https://www.google.com/maps/place/Name/@19.0654,72.8343,17z
 *   https://maps.google.com/maps?ll=19.0654,72.8343
 *   https://www.google.com/maps/place/Address/data=...  (no coords — geocode place name)
 *   https://maps.app.goo.gl/abc123  (shortened — follow redirect first)
 *
 * Returns { lat, lng } or null.
 */
async function _parseGoogleMapsCoords(rawUrl) {
  let url = rawUrl;

  // Follow redirect for shortened links (goo.gl, maps.app.goo.gl)
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

    // Format 1: @lat,lng,zoom in the path  (/maps/place/Name/@19.06,72.83,17z)
    const atMatch = u.pathname.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };

    // Format 2: ?q=lat,lng
    const q = u.searchParams.get('q');
    if (q) {
      const qm = q.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (qm) return { lat: parseFloat(qm[1]), lng: parseFloat(qm[2]) };
    }

    // Format 3: ?ll=lat,lng
    const ll = u.searchParams.get('ll');
    if (ll) {
      const lm = ll.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (lm) return { lat: parseFloat(lm[1]), lng: parseFloat(lm[2]) };
    }

    // Format 4: ?center=lat,lng
    const center = u.searchParams.get('center');
    if (center) {
      const cm = center.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (cm) return { lat: parseFloat(cm[1]), lng: parseFloat(cm[2]) };
    }

    // Format 5: /maps/place/Address/data=... — no coords, geocode the place name
    const placeMatch = u.pathname.match(/\/maps\/place\/([^/]+)/);
    if (placeMatch) {
      const placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '));
      return await _nominatimGeocode(placeName);
    }
  } catch { /* invalid URL */ }

  return null;
}

/**
 * Geocode a place name using Nominatim (OpenStreetMap).
 * Rate-limit safe: only called on settings save, not on every request.
 */
function _nominatimGeocode(query) {
  return new Promise(resolve => {
    const encoded = encodeURIComponent(query);
    const options = {
      hostname: 'nominatim.openstreetmap.org',
      path:     `/search?q=${encoded}&format=json&limit=1`,
      headers:  { 'User-Agent': 'kravon-platform/1.0 (settings save)' },
      timeout:  5000,
    };
    const req = https.get(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const results = JSON.parse(body);
          if (results[0]) {
            resolve({ lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// 60-second per-tenant+surface config cache — matches the Cache-Control max-age.
// Prevents the full menu JOIN running on every concurrent request.
// Cache key format: "<tenantId>:<surface>" where surface is 'all' when no ?surface param.
const _configCache = new Map();
const CONFIG_TTL   = 60 * 1000;

const VALID_SURFACES = new Set(['delivery', 'pickup', 'dine_in', 'catering']);

function _cacheKey(tenantId, surface) {
  return `${tenantId}:${surface || 'all'}`;
}
function getConfigCached(tenantId, surface) {
  const entry = _configCache.get(_cacheKey(tenantId, surface));
  if (entry && Date.now() - entry.ts < CONFIG_TTL) return entry.data;
  return null;
}
function setConfigCached(tenantId, surface, data) {
  if (_configCache.size > 500) _configCache.delete(_configCache.keys().next().value);
  _configCache.set(_cacheKey(tenantId, surface), { data, ts: Date.now() });
}

router.get('/', async (req, res, next) => {
  try {
    const r  = req.tenant;
    const id = r.tenant_id;

    // Optional ?surface=delivery|pickup|dine_in|catering
    // When provided, categories and items whose surfaces array does NOT include
    // this surface are excluded. NULL surfaces = visible on all surfaces.
    const rawSurface = req.query.surface;
    const surface    = VALID_SURFACES.has(rawSurface) ? rawSurface : null;

    const cached = getConfigCached(id, surface);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(cached);
    }

    // NULL surfaces = no restriction = always included.
    // Non-null surfaces = must contain the requested surface.
    const catChannelFilter  = surface ? `AND (c.surfaces IS NULL OR $2 = ANY(c.surfaces))` : '';
    const itemChannelFilter = surface ? `AND (i.surfaces IS NULL OR $2 = ANY(i.surfaces))` : '';
    const queryParams       = surface ? [id, surface] : [id];

    // Fetch categories + items in one pass.
    // has_variants and is_customizable are derived live from child rows so they
    // stay accurate even if the flags on menu_items were never backfilled.
    const menuRes = await query(`
      SELECT
        c.id          AS cat_id,
        c.name        AS cat_name,
        c.description AS cat_subtitle,
        c.position    AS cat_sort,
        c.surfaces    AS cat_surfaces,
        i.id          AS item_id,
        i.name        AS item_name,
        i.price       AS item_price,
        i.description AS item_desc,
        i.image_url   AS image,
        i.surfaces    AS item_surfaces,
        i.is_customizable OR EXISTS (
          SELECT 1 FROM menu.customization_groups g
          WHERE g.menu_item_id = i.id AND g.tenant_id = i.tenant_id AND g.deleted_at IS NULL
        ) AS is_customizable,
        i.has_variants OR EXISTS (
          SELECT 1 FROM menu.item_variants v
          WHERE v.menu_item_id = i.id AND v.tenant_id = i.tenant_id AND v.deleted_at IS NULL
        ) AS has_variants,
        i.sort_order  AS item_sort,
        i.tags,
        i.food_type
      FROM menu.categories c
      LEFT JOIN menu.menu_items i
             ON i.category_id = c.id
            AND i.is_available = TRUE
            AND i.deleted_at IS NULL
            ${itemChannelFilter}
      WHERE c.tenant_id = $1
        AND c.is_active = TRUE
        AND c.deleted_at IS NULL
        ${catChannelFilter}
      ORDER BY c.position, i.sort_order
    `, queryParams);

    // Build categorised map + flat list
    const catMap    = new Map();
    const flatItems = [];

    for (const row of menuRes.rows) {
      if (!catMap.has(row.cat_id)) {
        catMap.set(row.cat_id, {
          id:       row.cat_id,
          name:     row.cat_name,
          subtitle: row.cat_subtitle,
          surfaces: row.cat_surfaces || null,
          items:    [],
        });
      }
      if (row.item_id) {
        const item = {
          id:              row.item_id,
          name:            row.item_name,
          price:           Number(row.item_price),
          desc:            row.item_desc,
          image:           row.image,
          imageBg:         null,
          badge:           null,
          badgeStyle:      null,
          badgeClass:      '',
          is_customizable: row.is_customizable,
          customise:       row.is_customizable, // alias expected by orders/tables renderer
          has_variants:    row.has_variants,
          food_type:       row.food_type,
          tags:            row.tags || [],
          surfaces:        row.item_surfaces || null,
        };
        catMap.get(row.cat_id).items.push(item);
        flatItems.push(item);
      }
    }

    // Build location rows for frontend
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
        acceptsOrders: r.accepts_orders !== false, // default true; explicit false = closed
      },

      reservations: {
        acceptsReservations: r.reservations?.accepts_reservations !== false,
        maxAdvanceDays:      r.reservations?.max_advance_days  ?? 30,
        minAdvanceHours:     r.reservations?.min_advance_hours ?? 2,
        maxPartySize:        r.reservations?.max_party_size    ?? 12,
        slots:               r.reservations?.slots             ?? [],
      },

      // Capability model — single source for frontend feature gating.
      // Frontend reads CONFIG.capabilities.* instead of CONFIG.products.*.
      // checkoutStrategy tells Presence which checkout path to use:
      //   'whatsapp'  — Starter: cart + WhatsApp message (no payment gateway)
      //   'orders'    — Growth/Pro: route to Orders product (Razorpay + DB)
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
        currency:           '₹',
        minOrder:           0,
        deliveryFee:        r.delivery_fee        != null ? r.delivery_fee / 100        : null,
        freeDeliveryAbove:  r.free_delivery_above != null ? r.free_delivery_above / 100 : null,
        footnote:           '',
      },

      // orders — used by the Orders standalone product module
      orders: {
        // delivery_fee and free_delivery_above are stored in paise in the DB;
        // divide by 100 to convert to rupees for the frontend cart engine.
        deliveryStandard:   r.delivery_fee        != null ? r.delivery_fee / 100        : 39,
        deliveryExpress:    r.delivery_fee        != null ? (r.delivery_fee / 100) * 2  : 78,
        freeDeliveryAt:     r.free_delivery_above != null ? r.free_delivery_above / 100 : 399,
        gstRate:            0,   // inclusive pricing; set >0 if you add GST line

        // Payment methods — offer Razorpay only when keys are configured
        paymentMethods: r.razorpay_key_id
          ? [
              { id: 'upi',  icon: '📱', label: 'UPI / QR',    sub: 'Google Pay, PhonePe, Paytm' },
              { id: 'card', icon: '💳', label: 'Card',         sub: 'Visa, Mastercard, RuPay'    },
              { id: 'cod',  icon: '💵', label: 'Cash on Delivery', sub: 'Pay when delivered'    },
            ]
          : [{ id: 'cod', icon: '💵', label: 'Cash on Delivery', sub: 'Pay when delivered' }],

        gatewayNote: r.razorpay_key_id
          ? { label: 'Secured by Razorpay', body: 'PCI-DSS compliant payment gateway.' }
          : null,

        // Static UI strings — consistent across all restaurants
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
        waCard: {
          icon:     '💬',
          title:    'Quick & Easy',
          ctaLabel: 'Start Order',
        },
      },

      reviews: {
        label:    'Reviews',
        headline: 'What our customers say',
        items:    [],
      },

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

      categories: Array.from(catMap.values()),

      footer: {
        poweredBy:    'Powered by',
        poweredLabel: 'Kravon',
        poweredUrl:   'https://kravon.in',
        privacyNote:  '',
      },

      // Presence marketing — assembled from brand.assets, brand.announcements, settings
      gallery:         r.gallery          || { food: [], ambience: [], people: [] },
      featured:        r.featured         || [],
      signatureDishes: r.signature_dishes || [],
      timeline:        r.timeline         || [],

      // Catering — content stored in settings.catering (only when has_catering)
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

/* ── PATCH /config — update restaurant settings (admin) ──────────────────── */
const GstSchema = z.object({
  enabled:   z.boolean(),
  gstin:     z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format').optional().nullable(),
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
  wa_number:           z.string().regex(/^\d{10,15}$/, 'wa_number must be digits only, 10–15 chars').optional(),
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

    // Fields that go to tenant.restaurants.name column
    const { name, phone, address, city, wa_number, razorpay_key_id, razorpay_key_secret, ...settingsFields } = d;

    // ── 1. Update tenant.restaurants ────────────────────────────────────────
    const setClauses = [];
    const values     = [];
    let   idx        = 1;

    if (name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      values.push(name);
    }
    if (Object.keys(settingsFields).length) {
      setClauses.push(`settings = settings || $${idx++}::jsonb`);
      values.push(JSON.stringify(settingsFields));
    }
    if (setClauses.length) {
      setClauses.push('updated_at = NOW()');
      values.push(tenantId);
      await query(
        `UPDATE tenant.restaurants SET ${setClauses.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL`,
        values
      );
    }

    // ── 2. Update tenant.locations (phone / address / city) ─────────────────
    if (phone !== undefined || address !== undefined || city !== undefined) {
      const locRes = await query(
        'SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
        [tenantId]
      );
      const locSets = []; const locVals = []; let li = 1;
      if (phone   !== undefined) { locSets.push(`phone = $${li++}`);   locVals.push(phone); }
      if (address !== undefined) { locSets.push(`address = $${li++}`); locVals.push(address); }
      if (city    !== undefined) { locSets.push(`city = $${li++}`);    locVals.push(city); }
      if (locRes.rows.length) {
        locVals.push(locRes.rows[0].id);
        await query(`UPDATE tenant.locations SET ${locSets.join(', ')}, updated_at = NOW() WHERE id = $${li}`, locVals);
      } else {
        await query(
          `INSERT INTO tenant.locations (tenant_id, name, address, city, phone, is_active) VALUES ($1,'Main',$2,$3,$4,true)`,
          [tenantId, address ?? null, city ?? null, phone ?? null]
        );
      }
    }

    // ── 2b. Extract lat/lng from map_url and persist to tenant.locations ────────
    if (d.map_url) {
      const coords = await _parseGoogleMapsCoords(d.map_url);
      if (coords) {
        const locRow = await query(
          'SELECT id FROM tenant.locations WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1',
          [tenantId]
        );
        if (locRow.rows.length) {
          await query(
            'UPDATE tenant.locations SET lat = $1, lng = $2, updated_at = NOW() WHERE id = $3',
            [coords.lat, coords.lng, locRow.rows[0].id]
          );
        } else {
          await query(
            'INSERT INTO tenant.locations (tenant_id, name, lat, lng, is_active) VALUES ($1, $2, $3, $4, true)',
            [tenantId, 'Main', coords.lat, coords.lng]
          );
        }
      }
    }

    // ── 3. Update WhatsApp contact link ──────────────────────────────────────
    if (wa_number !== undefined) {
      const waUrl = `https://wa.me/${wa_number}`;
      const existing = await query(
        `SELECT id FROM brand.contact_links WHERE tenant_id = $1 AND platform = 'whatsapp' AND deleted_at IS NULL LIMIT 1`,
        [tenantId]
      );
      if (existing.rows.length) {
        await query(`UPDATE brand.contact_links SET url = $1, updated_at = NOW() WHERE id = $2`, [waUrl, existing.rows[0].id]);
      } else {
        await query(
          `INSERT INTO brand.contact_links (tenant_id, platform, url, display_label, position) VALUES ($1,'whatsapp',$2,'WhatsApp',1)`,
          [tenantId, waUrl]
        );
      }
    }

    // ── 4. Update Razorpay integration ───────────────────────────────────────
    if (razorpay_key_id !== undefined || razorpay_key_secret !== undefined) {
      const { encrypt } = require('../../utils/crypto');
      const existingInteg = await query(
        `SELECT id, config FROM tenant.integrations WHERE tenant_id = $1 AND provider = 'razorpay' AND deleted_at IS NULL LIMIT 1`,
        [tenantId]
      );
      const keyId     = razorpay_key_id     ?? existingInteg.rows[0]?.config?.key_id;
      const rawSecret = razorpay_key_secret ?? null;
      const keySecret = rawSecret ? encrypt(rawSecret) : existingInteg.rows[0]?.config?.key_secret;
      if (keyId && keySecret) {
        if (existingInteg.rows.length) {
          await query(
            `UPDATE tenant.integrations SET config = $1, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify({ key_id: keyId, key_secret: keySecret }), existingInteg.rows[0].id]
          );
        } else {
          await query(
            `INSERT INTO tenant.integrations (tenant_id, provider, config, is_active) VALUES ($1,'razorpay',$2,true)`,
            [tenantId, JSON.stringify({ key_id: keyId, key_secret: keySecret })]
          );
        }
      }
    }

    // ── Bust both caches (all surface variants) ──────────────────────────────
    bustConfigCache(tenantId);
    require('../middleware/tenant').clearTenantCache(req.tenant.slug);
    audit.log(null, {
      tenantId, actorId: req.auth?.staffId, actorType: 'staff',
      action: 'config.update', entityType: 'tenant.restaurant', entityId: tenantId,
      newValue: d, req,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /v1/restaurants/:slug/menu/items/:id
router.get('/items/:id', async (req, res, next) => {
  try {
    const itemId  = req.params.id;
    const tenantId = req.tenant.tenant_id;

    const itemRes = await query(`
      SELECT id, name, price, description, is_customizable, has_variants
      FROM menu.menu_items
      WHERE id = $1 AND tenant_id = $2 AND is_available = TRUE AND deleted_at IS NULL
    `, [itemId, tenantId]);

    if (!itemRes.rows.length) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemRes.rows[0];

    const [variantsRes, groupsRes] = await Promise.all([
      query(`
        SELECT id, name, price
        FROM menu.item_variants
        WHERE menu_item_id = $1 AND is_available = TRUE AND deleted_at IS NULL
        ORDER BY sort_order
      `, [itemId]),
      query(`
        SELECT id, name, group_type, is_required, min_select, max_select
        FROM menu.customization_groups
        WHERE menu_item_id = $1 AND deleted_at IS NULL
        ORDER BY position
      `, [itemId]),
    ]);

    const variants = variantsRes.rows.map(v => ({
      id:    v.id,
      name:  v.name,
      price: Number(v.price),
    }));

    const customizations = await Promise.all(
      groupsRes.rows.map(async (group) => {
        const optRes = await query(`
          SELECT id, name, price_modifier, is_default
          FROM menu.customization_options
          WHERE group_id = $1 AND is_available = TRUE AND deleted_at IS NULL
          ORDER BY sort_order
        `, [group.id]);

        return {
          id:          group.id,
          name:        group.name,
          group_type:  group.group_type,
          is_required: group.is_required,
          min_select:  group.min_select,
          max_select:  group.max_select,
          options:     optRes.rows.map(o => ({
            id:             o.id,
            name:           o.name,
            price_modifier: Number(o.price_modifier),
            is_default:     o.is_default,
          })),
        };
      })
    );

    res.json({
      id:              item.id,
      name:            item.name,
      price:           Number(item.price),
      description:     item.description,
      has_variants:    item.has_variants,
      is_customizable: item.is_customizable,
      variants,
      customizations,
    });

  } catch (err) {
    next(err);
  }
});

function bustConfigCache(tenantId) {
  // Delete all surface-keyed variants for this tenant (e.g. "id:all", "id:dine_in", etc.)
  for (const key of _configCache.keys()) {
    if (key.startsWith(`${tenantId}:`)) _configCache.delete(key);
  }
}

module.exports = router;
module.exports.bustConfigCache = bustConfigCache;
