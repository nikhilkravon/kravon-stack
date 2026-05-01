/**
 * ROUTE — config.js
 * GET /v1/restaurants/:slug/config
 *
 * Returns the full CONFIG object for the frontend renderer.
 * Public — no authentication required.
 *
 * Shape is V7-compatible: includes all renderer-expected fields
 * (hero, story, how, reviews, location, order, menu section labels)
 * with sensible defaults so the renderer never crashes on missing data.
 */

'use strict';

const express = require('express');
const { query } = require('../../db/pool');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const r  = req.tenant;
    const id = r.tenant_id;

    // Fetch menu categories + items
    const menuRes = await query(`
      SELECT
        c.id          AS cat_id,
        c.name        AS cat_name,
        c.subtitle    AS cat_subtitle,
        c.sort_order  AS cat_sort,
        i.id          AS item_id,
        i.name        AS item_name,
        i.price_paise AS item_price,
        i.description AS item_desc,
        i.image,
        i.image_bg,
        i.badge,
        i.badge_style,
        i.customisable AS is_customizable,
        i.sort_order  AS item_sort
      FROM menu_categories c
      LEFT JOIN menu_items i ON i.category_id = c.id AND i.active = TRUE
      WHERE c.tenant_id = $1 AND c.active = TRUE
      ORDER BY c.sort_order, i.sort_order
    `, [id]);

    const addonsRes = await query(
      'SELECT label, price_paise FROM menu_addons WHERE tenant_id=$1 AND active=TRUE ORDER BY sort_order',
      [id]
    );
    const spiceRes = await query(
      'SELECT label FROM spice_levels WHERE tenant_id=$1 ORDER BY sort_order',
      [id]
    );

    // Build categorised map AND flat item list (renderer needs flat)
    const catMap   = new Map();
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
          id:         row.item_id,
          name:       row.item_name,
          price:      Math.round(row.item_price / 100),
          desc:       row.item_desc,
          image:      row.image,
          imageBg:    row.image_bg,
          badge:      row.badge,
          badgeStyle: row.badge_style,
          badgeClass: row.badge_style || '',   // V7 renderer uses badgeClass
          is_customizable: row.is_customizable,
          has_variants: false,
        };
        catMap.get(row.cat_id).items.push(item);
        flatItems.push(item);
      }
    }

    const addons     = addonsRes.rows.map(a => ({ label: a.label, price: Math.round(a.price_paise / 100) }));
    const spiceLevels = spiceRes.rows.map(s => s.label);

    // Build location rows from available DB fields
    const locationRows = [
      r.address      ? { icon: '📍', title: 'Address',       body: r.address,        highlight: false } : null,
      r.phone        ? { icon: '📞', title: 'Phone',          body: r.phone,          highlight: false } : null,
      r.email        ? { icon: '✉️',  title: 'Email',          body: r.email,          highlight: false } : null,
      r.hours_display? { icon: '🕐', title: 'Hours',          body: r.hours_display,  highlight: true  } : null,
      r.delivery_zone? { icon: '🛵', title: 'Delivery Zone',  body: r.delivery_zone,  highlight: false } : null,
    ].filter(Boolean);

    const config = {
      rest_id: r.rest_id,
      slug:    r.slug,

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

      tables: r.has_tables ? {
        paymentMode:     r.razorpay_key_id ? 'razorpay' : 'offline',
        razorpayKeyId:   r.razorpay_key_id  || null,
        reviewThreshold: r.review_threshold ?? 4,
        googleReviewUrl: r.google_review_url || null,
      } : null,

      // ── V7 renderer-expected content fields ──────────────────────────────
      order: {
        currency: '₹',
        minOrder: 0,
        footnote: '',
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
        body:     r._row.story_body  || [],
        facts:    r._row.story_facts || [],
      },

      how: {
        label:    'How It Works',
        headline: 'Order in minutes',
        steps: [
          { title: 'Browse the menu',      body: 'Pick your favourites from our menu.' },
          { title: 'Message on WhatsApp',  body: 'Send your order directly to us.' },
          { title: 'Enjoy your food',      body: 'We handle the rest.' },
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
        mapUrl:   r._row.map_url || null,
        rows:     locationRows,
      },

      // menu: object with section labels + flat items array (V7 renderer shape)
      menu: {
        label:    'Menu',
        headline: 'What we serve',
        waNote:   'Order via WhatsApp',
        items:    flatItems,
      },

      // Categorised menu for Orders / Tables modules
      categories: Array.from(catMap.values()),

      footer: {
        poweredBy:    'Powered by',
        poweredLabel: 'Kravon',
        poweredUrl:   'https://kravon.in',
        privacyNote:  '',
      },

      demo:    null,
      upgrade: null,

      // Kept for backward compat
      addons,
      spiceLevels,
    };

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ ok: true, config });

  } catch (err) {
    console.error('Config route error:', err);
    next(err);
  }
});

// GET /v1/restaurants/:slug/menu/items/:id — Item details with variants & customizations
router.get('/items/:id', async (req, res, next) => {
  try {
    const itemId = req.params.id;
    const tenantId = req.tenant.tenant_id;

    // Fetch item
    const itemRes = await query(`
      SELECT id, name, price_paise, description, customisable
      FROM menu_items
      WHERE id = $1 AND tenant_id = $2 AND active = TRUE
    `, [itemId, tenantId]);

    if (!itemRes.rows.length) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemRes.rows[0];

    // Fetch variants
    const variantsRes = await query(`
      SELECT id, name, price
      FROM item_variants
      WHERE menu_item_id = $1 AND is_available = TRUE
      ORDER BY sort_order
    `, [itemId]);

    const variants = variantsRes.rows.map(v => ({
      id: v.id,
      name: v.name,
      price: Math.round(v.price / 100)
    }));

    // Fetch customizations
    const groupsRes = await query(`
      SELECT id, name, group_type, is_required
      FROM customization_groups
      WHERE menu_item_id = $1
      ORDER BY sort_order
    `, [itemId]);

    const customizations = [];
    for (const group of groupsRes.rows) {
      const optionsRes = await query(`
        SELECT id, name, price_modifier, is_default
        FROM customization_options
        WHERE group_id = $1
        ORDER BY sort_order
      `, [group.id]);

      const options = optionsRes.rows.map(o => ({
        id: o.id,
        name: o.name,
        price_modifier: Math.round(o.price_modifier / 100),
        is_default: o.is_default
      }));

      customizations.push({
        id: group.id,
        name: group.name,
        group_type: group.group_type,
        is_required: group.is_required,
        options
      });
    }

    res.json({
      id: item.id,
      name: item.name,
      price: Math.round(item.price_paise / 100),
      description: item.description,
      has_variants: variants.length > 0,
      is_customizable: item.customisable,
      variants,
      customizations
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
