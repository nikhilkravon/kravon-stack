/**
 * ROUTE — admin.js
 * POST /v1/admin/restaurants         — onboard new restaurant
 * PUT  /v1/admin/restaurants/:id     — update restaurant
 * GET  /v1/admin/restaurants         — list all restaurants
 *
 * Protected by a single ADMIN_API_KEY header.
 * Used by the Kravon team only — not by restaurant owners.
 */

'use strict';

const express   = require('express');
const { z }     = require('zod');
const { query } = require('../../db/pool');
const { encrypt } = require('../../utils/crypto');

const router = express.Router();

function requireAdminKey(req, res, next) {
  const key = req.headers['x-kravon-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(requireAdminKey);

/* ── Shared validation schema ─────────────────────────────────────────────── */
// slug: URL-safe lowercase identifier; no spaces, no special chars
const SlugSchema = z.string()
  .min(2).max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens only');

const CreateRestaurantSchema = z.object({
  slug:               SlugSchema,
  name:               z.string().min(1).max(120),
  tagline:            z.string().max(200).optional(),
  year:               z.string().max(4).optional(),
  phone:              z.string().max(30).optional(),
  wa_number:          z.string().regex(/^\d{10,15}$/, 'wa_number must be digits only, 10–15 chars').optional(),
  email:              z.string().email().max(120).optional(),
  address:            z.string().max(500).optional(),
  city:               z.string().max(100).optional(),
  delivery_zone:      z.string().max(200).optional(),
  hours_display:      z.string().max(100).optional(),
  open_until:         z.string().max(40).optional(),
  has_presence:       z.boolean().optional(),
  has_tables:         z.boolean().optional(),
  has_orders:         z.boolean().optional(),
  has_catering:       z.boolean().optional(),
  has_insights:       z.boolean().optional(),
  razorpay_key_id:    z.string().max(40).optional(),
  razorpay_key_secret:z.string().max(200).optional(),
  allowed_origin:     z.string().url().max(200).optional(),
  review_threshold:   z.number().int().min(1).max(5).optional(),
  google_review_url:  z.string().url().max(300).optional(),
  webhook_url:        z.string().url().max(300).optional(),
  delivery_fee:       z.number().int().min(0).optional(),
  free_delivery_above:z.number().int().min(0).optional(),
});

// PUT accepts same fields but all optional (patch semantics)
const UpdateRestaurantSchema = CreateRestaurantSchema.partial().omit({ slug: true });

/* ── GET /restaurants ────────────────────────────────────────────────────── */
router.get('/restaurants', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT rest_id, slug, name, tagline, has_presence, has_tables, has_orders, has_catering, has_insights, created_at FROM restaurants ORDER BY rest_id'
    );
    res.json({ ok: true, restaurants: result.rows });
  } catch (err) { next(err); }
});

/* ── POST /restaurants ───────────────────────────────────────────────────── */
router.post('/restaurants', async (req, res, next) => {
  try {
    const parsed = CreateRestaurantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const d = parsed.data;
    const encryptedSecret = d.razorpay_key_secret
      ? encrypt(d.razorpay_key_secret)
      : null;

    const result = await query(`
      INSERT INTO restaurants (
        slug, name, tagline, year, phone, wa_number, email, address, city,
        delivery_zone, hours_display, open_until,
        has_presence, has_tables, has_orders, has_catering, has_insights,
        razorpay_key_id, razorpay_key_secret, allowed_origin,
        review_threshold, google_review_url, webhook_url,
        delivery_fee, free_delivery_above
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
      RETURNING rest_id, slug
    `, [
      d.slug, d.name, d.tagline ?? null, d.year ?? null,
      d.phone ?? null, d.wa_number ?? null, d.email ?? null,
      d.address ?? null, d.city ?? null, d.delivery_zone ?? null,
      d.hours_display ?? null, d.open_until ?? null,
      d.has_presence  ?? true,
      d.has_tables    ?? false,
      d.has_orders    ?? false,
      d.has_catering  ?? false,
      d.has_insights  ?? false,
      d.razorpay_key_id ?? null, encryptedSecret, d.allowed_origin ?? null,
      d.review_threshold    ?? 4,
      d.google_review_url   ?? null,
      d.webhook_url         ?? null,
      d.delivery_fee        ?? 4900,
      d.free_delivery_above ?? 49900,
    ]);

    res.status(201).json({ ok: true, restaurant: result.rows[0] });
  } catch (err) {
    // Unique constraint on slug
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A restaurant with this slug already exists.' });
    }
    next(err);
  }
});

/* ── PUT /restaurants/:id ────────────────────────────────────────────────── */
router.put('/restaurants/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid restaurant id.' });
    }

    const parsed = UpdateRestaurantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const d = parsed.data;
    if (Object.keys(d).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update.' });
    }

    // Build SET clause dynamically from provided fields only (patch semantics)
    const sets   = [];
    const values = [];
    let   idx    = 1;

    const addField = (col, val) => {
      sets.push(`${col} = $${idx++}`);
      values.push(val);
    };

    if (d.name               !== undefined) addField('name',               d.name);
    if (d.tagline            !== undefined) addField('tagline',            d.tagline);
    if (d.year               !== undefined) addField('year',               d.year);
    if (d.phone              !== undefined) addField('phone',              d.phone);
    if (d.wa_number          !== undefined) addField('wa_number',          d.wa_number);
    if (d.email              !== undefined) addField('email',              d.email);
    if (d.address            !== undefined) addField('address',            d.address);
    if (d.city               !== undefined) addField('city',               d.city);
    if (d.delivery_zone      !== undefined) addField('delivery_zone',      d.delivery_zone);
    if (d.hours_display      !== undefined) addField('hours_display',      d.hours_display);
    if (d.open_until         !== undefined) addField('open_until',         d.open_until);
    if (d.has_presence       !== undefined) addField('has_presence',       d.has_presence);
    if (d.has_tables         !== undefined) addField('has_tables',         d.has_tables);
    if (d.has_orders         !== undefined) addField('has_orders',         d.has_orders);
    if (d.has_catering       !== undefined) addField('has_catering',       d.has_catering);
    if (d.has_insights       !== undefined) addField('has_insights',       d.has_insights);
    if (d.razorpay_key_id    !== undefined) addField('razorpay_key_id',    d.razorpay_key_id);
    if (d.razorpay_key_secret !== undefined) {
      addField('razorpay_key_secret', d.razorpay_key_secret ? encrypt(d.razorpay_key_secret) : null);
    }
    if (d.allowed_origin      !== undefined) addField('allowed_origin',      d.allowed_origin);
    if (d.review_threshold    !== undefined) addField('review_threshold',    d.review_threshold);
    if (d.google_review_url   !== undefined) addField('google_review_url',   d.google_review_url);
    if (d.webhook_url         !== undefined) addField('webhook_url',         d.webhook_url);
    if (d.delivery_fee        !== undefined) addField('delivery_fee',        d.delivery_fee);
    if (d.free_delivery_above !== undefined) addField('free_delivery_above', d.free_delivery_above);

    addField('updated_at', 'NOW()');
    // Swap the last entry — updated_at uses NOW() not a param placeholder
    sets[sets.length - 1]   = `updated_at = NOW()`;
    values.splice(values.length - 1, 1);
    idx--;

    values.push(id);

    const result = await query(
      `UPDATE restaurants SET ${sets.join(', ')} WHERE rest_id = $${idx} RETURNING rest_id, slug, name`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Restaurant not found.' });
    }

    res.json({ ok: true, restaurant: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
