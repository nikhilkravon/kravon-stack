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

// 60-second per-tenant config cache — matches the Cache-Control max-age.
// Prevents the full menu JOIN running on every concurrent request.
const _configCache = new Map();
const CONFIG_TTL   = 60 * 1000;

function getConfigCached(tenantId) {
  const entry = _configCache.get(tenantId);
  if (entry && Date.now() - entry.ts < CONFIG_TTL) return entry.data;
  return null;
}
function setConfigCached(tenantId, data) {
  if (_configCache.size > 500) _configCache.delete(_configCache.keys().next().value);
  _configCache.set(tenantId, { data, ts: Date.now() });
}

router.get('/', async (req, res, next) => {
  try {
    const r  = req.tenant;
    const id = r.tenant_id;

    const cached = getConfigCached(id);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return res.json(cached);
    }

    // Fetch categories + items in one pass (v12 column names)
    const menuRes = await query(`
      SELECT
        c.id          AS cat_id,
        c.name        AS cat_name,
        c.description AS cat_subtitle,
        c.position    AS cat_sort,
        i.id          AS item_id,
        i.name        AS item_name,
        i.price       AS item_price,
        i.description AS item_desc,
        i.image_url   AS image,
        i.is_customizable,
        i.has_variants,
        i.sort_order  AS item_sort,
        i.tags,
        i.food_type
      FROM menu.categories c
      LEFT JOIN menu.menu_items i
             ON i.category_id = c.id
            AND i.is_available = TRUE
            AND i.deleted_at IS NULL
      WHERE c.tenant_id = $1
        AND c.is_active = TRUE
        AND c.deleted_at IS NULL
      ORDER BY c.position, i.sort_order
    `, [id]);

    // Build categorised map + flat list
    const catMap    = new Map();
    const flatItems = [];

    for (const row of menuRes.rows) {
      if (!catMap.has(row.cat_id)) {
        catMap.set(row.cat_id, {
          id:       row.cat_id,
          name:     row.cat_name,
          subtitle: row.cat_subtitle,
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
          has_variants:    row.has_variants,
          food_type:       row.food_type,
          tags:            row.tags || [],
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
        display:     r.hours_display || '',
        openUntil:   r.open_until    || '',
        navBadge:    r.hours_display || 'Open Now',
        kitchenNote: r.hours_display || '',
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
    setConfigCached(id, payload);
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(payload);

  } catch (err) {
    console.error('Config route error:', err);
    next(err);
  }
});

/* ── PATCH /config — update restaurant settings (admin) ──────────────────── */
const SettingsUpdateSchema = z.object({
  name:                z.string().min(1).max(150).optional(),
  tagline:             z.string().max(300).optional(),
  hours_display:       z.string().max(100).optional(),
  open_until:          z.string().max(40).optional(),
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

    // ── Bust cache + audit ───────────────────────────────────────────────────
    _configCache.delete(tenantId);
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
  _configCache.delete(tenantId);
}

module.exports = router;
module.exports.bustConfigCache = bustConfigCache;
