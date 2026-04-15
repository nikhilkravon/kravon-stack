/**
 * ROUTE — config.js
 * GET /v1/restaurants/:slug/config
 *
 * Returns the full CONFIG object for the frontend renderer.
 * This replaces config/config.js in the V7 static files.
 * Public — no authentication required.
 */

'use strict';

const express = require('express');
const { query } = require('../../db/pool');

const router = express.Router();

router.get('/config', async (req, res, next) => {
  try {
    const r  = req.tenant;  // attached by resolveRestaurant middleware
    const id = r.rest_id;

    // Fetch menu categories + items in one query
    const menuRes = await query(`
      SELECT
        c.id       AS cat_id,
        c.name     AS cat_name,
        c.subtitle AS cat_subtitle,
        c.sort_order AS cat_sort,
        i.id          AS item_id,
        i.name        AS item_name,
        i.price_paise  AS item_price,
        i.description AS item_desc,
        i.image,
        i.image_bg,
        i.badge,
        i.badge_style,
        i.customisable,
        i.sort_order   AS item_sort
      FROM menu_categories c
      LEFT JOIN menu_items i ON i.category_id = c.id AND i.active = TRUE
      WHERE c.rest_id = $1 AND c.active = TRUE
      ORDER BY c.sort_order, i.sort_order
    `, [id]);

    const addonsRes = await query(
      'SELECT label, price FROM menu_addons WHERE rest_id=$1 AND active=TRUE ORDER BY sort_order',
      [id]
    );
    const spiceRes = await query(
      'SELECT label FROM spice_levels WHERE rest_id=$1 ORDER BY sort_order',
      [id]
    );

    // Build MENU array (same shape as V7 MENU const)
    const catMap = new Map();
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
        catMap.get(row.cat_id).items.push({
          id:          row.item_id,
          name:        row.item_name,
          price:       Math.round(row.item_price / 100),   // paise → rupees for display
          desc:        row.item_desc,
          image:       row.image,
          imageBg:     row.image_bg,
          badge:       row.badge,
          badgeStyle:  row.badge_style,
          customise:   row.customisable,
        });
      }
    }

    const config = {
      rest_id: r.rest_id,
      slug:          r.slug,

      meta: {
        title:       `${r.name} — Order Direct`,
        description: `${r.name} — ${r.tagline}`,
      },
      brand: {
        name:    r.name,
        tagline: r.tagline,
        year:    r.year,
      },
      contact: {
        phone:        r.phone,
        waNumber:     r.wa_number,
        email:        r.email,
        address:      r.address,
        city:         r.city,
        deliveryZone: r.delivery_zone,
      },
      hours: {
        display:  r.hours_display,
        openUntil: r.open_until,
      },
      products: {
        presence: r.has_presence,
        tables:   r.has_tables,
        orders:   r.has_orders,
        catering: r.has_catering,
        insights: r.has_insights,
      },

      // Tables config — only populated when has_tables is true
      tables: r.has_tables ? {
        paymentMode:      r.razorpay_key_id ? 'razorpay' : 'offline',
        razorpayKeyId:    r.razorpay_key_id  || null,   // public key — safe to expose
        reviewThreshold:  r.review_threshold ?? 4,
        googleReviewUrl:  r.google_review_url || null,
      } : null,

      // Menu data (replaces MENU, ADDONS, SPICE_LEVELS window constants)
      menu:        Array.from(catMap.values()),
      addons:      addonsRes.rows.map(a => ({ label: a.label, price: Math.round(a.price_paise / 100) })),
      spiceLevels: spiceRes.rows.map(s => s.label),
    };

    // Cache control — config changes infrequently
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ ok: true, config });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
