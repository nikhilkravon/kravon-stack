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
const { query } = require('../../db/pool');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const r  = req.tenant;
    const id = r.tenant_id;

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
          price:           Number(row.item_price),   // already in rupees
          desc:            row.item_desc,
          image:           row.image,
          imageBg:         null,
          badge:           null,
          badgeStyle:      null,
          badgeClass:      '',
          is_customizable: row.is_customizable,
          customisable:    row.is_customizable,  // compat alias for presence + tables renderer
          customise:       row.is_customizable,  // compat alias for orders ui.js
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
      rest_id:   id,   // backward-compat alias
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

      products: {
        presence: r.has_presence,
        tables:   r.has_tables,
        orders:   r.has_orders,
        catering: r.has_catering,
        insights: r.has_insights,
      },

      // Capability model — replaces raw product booleans for frontend logic.
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
        deliveryFee:        r.delivery_fee        ?? null,
        freeDeliveryAbove:  r.free_delivery_above ?? null,
        footnote:           '',
      },

      // orders — used by the Orders standalone product module
      orders: {
        // Dynamic: delivery pricing from tenant config
        deliveryStandard:   r.delivery_fee        ?? 39,
        deliveryExpress:    (r.delivery_fee ?? 39) * 2,
        freeDeliveryAt:     r.free_delivery_above ?? 399,
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
        ctaLabel: 'Order on WhatsApp',
        footnote: r.hours_display || '',
        stats:    [],
      },

      story: {
        label:    'Our Story',
        headline: r.story_headline || `About ${r.name}`,
        body:     r.story_body     || [],
        facts:    r.story_facts    || [],
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

      demo:    null,
      upgrade: null,

      // v12 has no addons/spice_levels tables yet — return empty
      addons:      [],
      spiceLevels: [],
    };

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ ok: true, config });

  } catch (err) {
    console.error('Config route error:', err);
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

module.exports = router;
