/**
 * ROUTE — admin.js
 * POST /v1/admin/restaurants         — onboard new restaurant
 * PUT  /v1/admin/restaurants/:slug   — update restaurant
 * GET  /v1/admin/restaurants         — list all restaurants
 * POST /v1/admin/staff               — create owner staff member
 *
 * Protected by a single ADMIN_API_KEY header.
 */

'use strict';

const express         = require('express');
const { z }           = require('zod');
const tenancyService  = require('../../domains/tenancy/service');
const { validateSettingsPatch } = require('../../db/settingsSchema');

const router = express.Router();

function requireAdminKey(req, res, next) {
  const key = req.headers['x-kravon-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(requireAdminKey);

const SlugSchema = z.string()
  .min(2).max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase alphanumeric with hyphens only');

const CreateRestaurantSchema = z.object({
  slug:                SlugSchema,
  name:                z.string().min(1).max(120),
  tagline:             z.string().max(300).optional(),
  year:                z.string().max(4).optional(),
  phone:               z.string().max(30).optional(),
  wa_number:           z.string().regex(/^\d{10,15}$/, 'wa_number must be digits only, 10–15 chars').optional(),
  email:               z.string().email().max(120).optional(),
  address:             z.string().max(500).optional(),
  city:                z.string().max(100).optional(),
  delivery_zone:       z.string().max(200).optional(),
  hours_display:       z.string().max(100).optional(),
  open_until:          z.string().max(40).optional(),
  accepts_orders:      z.boolean().optional(),
  has_presence:        z.boolean().optional(),
  has_tables:          z.boolean().optional(),
  has_orders:          z.boolean().optional(),
  has_catering:        z.boolean().optional(),
  has_insights:        z.boolean().optional(),
  razorpay_key_id:     z.string().max(40).optional(),
  razorpay_key_secret: z.string().max(200).optional(),
  review_threshold:    z.number().int().min(1).max(5).optional(),
  google_review_url:   z.string().url().max(300).optional(),
  webhook_url:         z.string().url().max(300).optional(),
  delivery_fee:        z.number().min(0).optional(),
  free_delivery_above: z.number().min(0).optional(),
  domain:              z.string().max(200).optional(),
  map_url:             z.string().url().max(500).optional(),
  plan:                z.enum(['starter', 'growth', 'pro', 'enterprise']).optional(),
});

const UpdateRestaurantSchema = CreateRestaurantSchema.partial().omit({ slug: true });

const CreateStaffSchema = z.object({
  slug:     z.string().min(2).max(80),
  name:     z.string().min(1).max(120),
  email:    z.string().email().max(120),
  password: z.string().min(8).max(200),
  phone:    z.string().max(30).optional(),
});

/* ── GET /restaurants ────────────────────────────────────────────────────── */
router.get('/restaurants', async (req, res, next) => {
  try {
    const restaurants = await tenancyService.listRestaurants();
    res.json({ ok: true, restaurants });
  } catch (err) { next(err); }
});

/* ── POST /restaurants ───────────────────────────────────────────────────── */
router.post('/restaurants', async (req, res, next) => {
  try {
    const parsed = CreateRestaurantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const restaurant = await tenancyService.createRestaurant(parsed.data);
    res.status(201).json({ ok: true, restaurant });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A restaurant with this slug already exists.' });
    }
    next(err);
  }
});

/* ── PUT /restaurants/:slug ──────────────────────────────────────────────── */
router.put('/restaurants/:slug', async (req, res, next) => {
  try {
    const parsed = UpdateRestaurantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return res.status(400).json({ error: 'No fields provided to update.' });
    }

    const SETTINGS_FIELDS = [
      'tagline','year','email','delivery_zone','hours_display','open_until','accepts_orders',
      'review_threshold','google_review_url',
      'delivery_fee','free_delivery_above','domain','map_url','webhook_url',
    ];
    const settingsPatch = {};
    for (const f of SETTINGS_FIELDS) {
      if (parsed.data[f] !== undefined) settingsPatch[f] = parsed.data[f];
    }
    if (Object.keys(settingsPatch).length) {
      const unknown = validateSettingsPatch(settingsPatch);
      if (unknown.length) {
        return res.status(422).json({ error: `Unknown settings keys: ${unknown.join(', ')}` });
      }
    }

    const restaurant = await tenancyService.updateRestaurant(req.params.slug, parsed.data);
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found.' });
    res.json({ ok: true, restaurant });
  } catch (err) { next(err); }
});

/* ── POST /staff ─────────────────────────────────────────────────────────── */
router.post('/staff', async (req, res, next) => {
  try {
    const parsed = CreateStaffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    }

    const { slug, ...staffData } = parsed.data;
    const staff = await tenancyService.createOwnerStaff(slug, staffData);
    if (!staff) return res.status(404).json({ error: 'Restaurant not found.' });
    res.status(201).json({ ok: true, staff });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A staff member with this email already exists for this restaurant.' });
    }
    next(err);
  }
});

module.exports = router;
