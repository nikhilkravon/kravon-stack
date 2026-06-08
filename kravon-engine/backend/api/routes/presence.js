'use strict';

const express          = require('express');
const { z }            = require('zod');
const presenceService  = require('../../domains/presence/service');
const { requireRestaurantAuth } = require('../middleware/auth');
const { bustConfigCache } = require('./config');
const multer           = require('multer');
const { uploadImage }  = require('../../lib/s3');

const router = express.Router();

/* ── Validation helpers ─────────────────────────────────────────────────── */

// Accepts http(s) URLs or empty string (to clear a field).
const urlOrEmpty = z.string().max(2048).refine(
  v => v === '' || /^https?:\/\/.+/.test(v),
  { message: 'Must be a valid http(s) URL or empty string' }
).optional();

const PresencePatchSchema = z.object({
  basics: z.object({
    name:         z.string().min(1).max(120).optional(),
    tagline:      z.string().max(300).optional(),
    city:         z.string().max(100).optional(),
    hours:        z.string().max(200).optional(),
    deliveryZone: z.string().max(200).optional(),
  }).optional(),

  contact: z.object({
    phone:         z.string().max(30).optional(),
    whatsapp:      z.string().max(30).optional(),
    email:         z.string().email().max(120).optional().or(z.literal('')),
    address:       z.string().max(300).optional(),
    googleMapsUrl: urlOrEmpty,
  }).optional(),

  social: z.record(
    z.enum(['instagram', 'facebook', 'google', 'zomato', 'swiggy', 'tripadvisor', 'youtube', 'twitter']),
    z.string().max(2048).refine(
      v => v === '' || /^https?:\/\/.+/.test(v),
      { message: 'Must be a valid http(s) URL or empty string' }
    )
  ).optional(),

  branding: z.object({
    logoUrl:   urlOrEmpty,
    heroImage: urlOrEmpty,
  }).optional(),

  hero: z.object({
    headline:    z.string().max(200).optional(),
    subheadline: z.string().max(300).optional(),
    heroImage:   urlOrEmpty,
  }).optional(),

  story: z.object({
    title: z.string().max(200).optional(),
    body:  z.string().max(10_000).optional(),
    image: urlOrEmpty,
  }).optional(),

  gallery: z.object({
    food:     z.array(z.string().url()).max(30).optional(),
    ambience: z.array(z.string().url()).max(30).optional(),
    people:   z.array(z.string().url()).max(30).optional(),
  }).optional(),

  featured: z.array(z.object({
    title:       z.string().max(200).optional().default(''),
    description: z.string().max(1000).optional().default(''),
    image:       urlOrEmpty,
    ctaLabel:    z.string().max(80).optional(),
    ctaUrl:      urlOrEmpty,
    active:      z.boolean().optional().default(true),
  })).max(20).optional(),

  signatureDishes: z.array(z.object({
    name:  z.string().max(120),
    desc:  z.string().max(500).optional(),
    image: urlOrEmpty,
    price: z.number().min(0).optional(),
  })).max(30).optional(),

  timeline: z.array(z.object({
    year:  z.union([z.string().max(10), z.number()]),
    event: z.string().max(300),
  })).max(50).optional(),
}).strict();

/* ── GET /presence ──────────────────────────────────────────────────────── */
router.get('/', requireRestaurantAuth, async (req, res, next) => {
  try {
    const content = await presenceService.getContent(req.tenant);
    res.json({ ok: true, content });
  } catch (err) { next(err); }
});

/* ── PATCH /presence ────────────────────────────────────────────────────── */
router.patch('/', requireRestaurantAuth, async (req, res, next) => {
  const parsed = PresencePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'Validation failed', details: parsed.error.flatten() });
  }

  try {
    await presenceService.updateContent(req.tenant.tenant_id, parsed.data);
    bustConfigCache(req.tenant.tenant_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ── POST /presence/images ──────────────────────────────────────────────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'));
    cb(null, true);
  },
});

router.post('/images', requireRestaurantAuth, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const url = await uploadImage(
      req.file,
      `restaurants/${req.tenant.tenant_id}/${req.tenant.slug}/images`
    );
    res.json({ ok: true, url });
  } catch (err) { next(err); }
});

module.exports = router;
