'use strict';

const express        = require('express');
const { z }          = require('zod');
const multer         = require('multer');
const catalogService = require('../../domains/catalog/service');
const { requireRestaurantAuth } = require('../middleware/auth');
const { bustConfigCache } = require('./config');
const { uploadImage } = require('../../lib/s3');

const router = express.Router();

/* ── Image upload ────────────────────────────────────────────────────────── */

const _upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files allowed'));
    cb(null, true);
  },
});

router.post('/images', requireRestaurantAuth, _upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const url = await uploadImage(
      req.file,
      `restaurants/${req.tenant.tenant_id}/${req.tenant.slug}/menu-items`
    );
    res.json({ ok: true, url });
  } catch (err) { next(err); }
});

/* ── Zod schemas ─────────────────────────────────────────────────────────── */

const VALID_SURFACES = ['delivery', 'pickup', 'dine_in', 'catering'];
const SurfacesSchema = z.array(z.enum(VALID_SURFACES)).min(1).max(4).nullable().optional();

const CategoryCreateSchema = z.object({
  name:        z.string().min(1).max(150),
  description: z.string().max(500).nullable().optional(),
  position:    z.number().int().min(0).max(999).optional(),
  surfaces:    SurfacesSchema,
});

const CategoryUpdateSchema = z.object({
  name:        z.string().min(1).max(150).optional(),
  description: z.string().max(500).nullable().optional(),
  position:    z.number().int().min(0).max(999).optional(),
  is_active:   z.boolean().optional(),
  surfaces:    SurfacesSchema,
});

const ItemCreateSchema = z.object({
  category_id:     z.string().uuid(),
  name:            z.string().min(1).max(150),
  description:     z.string().max(500).nullable().optional(),
  price:           z.number().min(0),
  food_type:       z.enum(['veg', 'non_veg', 'egg', 'vegan']).optional(),
  is_customizable: z.boolean().optional(),
  is_available:    z.boolean().optional(),
  sort_order:      z.number().int().min(0).max(999).optional(),
  image_url:       z.string().url().max(500).nullable().optional(),
  tags:            z.array(z.string().max(50)).max(20).optional(),
  surfaces:        SurfacesSchema,
});

const ItemUpdateSchema = z.object({
  category_id:     z.string().uuid().optional(),
  name:            z.string().min(1).max(150).optional(),
  description:     z.string().max(500).nullable().optional(),
  price:           z.number().min(0).optional(),
  food_type:       z.enum(['veg', 'non_veg', 'egg', 'vegan']).optional(),
  is_customizable: z.boolean().optional(),
  is_available:    z.boolean().optional(),
  sort_order:      z.number().int().min(0).max(999).optional(),
  image_url:       z.string().url().max(500).nullable().optional(),
  tags:            z.array(z.string().max(50)).max(20).optional(),
  surfaces:        SurfacesSchema,
});

const VariantSchema = z.object({
  name:         z.string().min(1).max(150),
  price:        z.number().min(0),
  food_type:    z.enum(['veg','non_veg','egg','vegan']).optional(),
  is_available: z.boolean().optional(),
  sort_order:   z.number().int().min(0).optional(),
});

const VariantUpdateSchema = VariantSchema.partial();

const CustomizationGroupSchema = z.object({
  name:        z.string().min(1).max(100),
  group_type:  z.enum(['radio','checkbox']).default('checkbox'),
  is_required: z.boolean().default(false),
  min_select:  z.number().int().min(0).default(0),
  max_select:  z.number().int().min(1).default(1),
  is_free:     z.boolean().default(false),
  position:    z.number().int().min(0).default(0),
});

const CustomizationOptionSchema = z.object({
  name:           z.string().min(1).max(100),
  price_modifier: z.number().min(0).default(0),
  food_type:      z.enum(['veg','non_veg','egg','vegan']).optional(),
  is_default:     z.boolean().default(false),
  sort_order:     z.number().int().min(0).default(0),
});

function fail(res, parsed) {
  return res.status(422).json({
    error:  'Validation failed',
    issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  });
}

/* ══════════════════════════════════════════════════════════
   CATEGORIES
   ══════════════════════════════════════════════════════════ */

router.get('/categories', async (req, res, next) => {
  try {
    const categories = await catalogService.getCategoriesWithItems(req.tenant.tenant_id);
    res.json({ ok: true, categories });
  } catch (err) { next(err); }
});

router.post('/categories', requireRestaurantAuth, async (req, res, next) => {
  const parsed = CategoryCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  try {
    const category = await catalogService.createCategory(req.tenant.tenant_id, parsed.data);
    res.status(201).json({ ok: true, category });
  } catch (err) { next(err); }
});

router.put('/categories/:id', requireRestaurantAuth, async (req, res, next) => {
  const parsed = CategoryUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  if (!Object.keys(parsed.data).length) return res.status(422).json({ error: 'No fields provided to update' });
  try {
    const category = await catalogService.updateCategory(req.tenant.tenant_id, req.params.id, parsed.data);
    if (!category) return res.status(404).json({ error: 'Category not found' });
    res.json({ ok: true, category });
  } catch (err) { next(err); }
});

router.delete('/categories/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const row = await catalogService.deleteCategory(req.tenant.tenant_id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Category not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   ITEMS
   ══════════════════════════════════════════════════════════ */

router.post('/items', requireRestaurantAuth, async (req, res, next) => {
  const parsed = ItemCreateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  try {
    const item = await catalogService.createItem(req.tenant.tenant_id, parsed.data);
    if (!item) return res.status(404).json({ error: 'Category not found' });
    res.status(201).json({ ok: true, item });
  } catch (err) { next(err); }
});

router.put('/items/:id', requireRestaurantAuth, async (req, res, next) => {
  const parsed = ItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  if (!Object.keys(parsed.data).length) return res.status(422).json({ error: 'No fields provided to update' });
  try {
    const item = await catalogService.updateItem(req.tenant.tenant_id, req.params.id, parsed.data);
    if (!item) return res.status(404).json({ error: 'Item or category not found' });
    res.json({ ok: true, item });
  } catch (err) { next(err); }
});

router.patch('/items/:id/availability', requireRestaurantAuth, async (req, res, next) => {
  const parsed = z.object({ is_available: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  try {
    const item = await catalogService.setItemAvailability(req.tenant.tenant_id, req.params.id, parsed.data.is_available);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true, item });
  } catch (err) { next(err); }
});

router.delete('/items/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const row = await catalogService.deleteItem(req.tenant.tenant_id, req.params.id);
    if (!row) return res.status(404).json({ error: 'Item not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   VARIANTS
   ══════════════════════════════════════════════════════════ */

router.get('/items/:id/variants', requireRestaurantAuth, async (req, res, next) => {
  try {
    const variants = await catalogService.listVariants(req.tenant.tenant_id, req.params.id);
    res.json({ ok: true, variants });
  } catch (err) { next(err); }
});

router.post('/items/:id/variants', requireRestaurantAuth, async (req, res, next) => {
  const parsed = VariantSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  try {
    const variant = await catalogService.createVariant(req.tenant.tenant_id, req.params.id, parsed.data);
    bustConfigCache(req.tenant.tenant_id);
    res.status(201).json({ ok: true, variant });
  } catch (err) { next(err); }
});

router.put('/items/:id/variants/:vid', requireRestaurantAuth, async (req, res, next) => {
  const parsed = VariantUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  if (!Object.keys(parsed.data).length) return res.status(400).json({ error: 'Nothing to update' });
  try {
    const variant = await catalogService.updateVariant(req.tenant.tenant_id, req.params.vid, parsed.data);
    if (!variant) return res.status(404).json({ error: 'Variant not found' });
    bustConfigCache(req.tenant.tenant_id);
    res.json({ ok: true, variant });
  } catch (err) { next(err); }
});

router.delete('/items/:id/variants/:vid', requireRestaurantAuth, async (req, res, next) => {
  try {
    const row = await catalogService.deleteVariant(req.tenant.tenant_id, req.params.id, req.params.vid);
    if (!row) return res.status(404).json({ error: 'Variant not found' });
    bustConfigCache(req.tenant.tenant_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   CUSTOMIZATION GROUPS + OPTIONS
   ══════════════════════════════════════════════════════════ */

router.get('/items/:id/customizations', requireRestaurantAuth, async (req, res, next) => {
  try {
    const groups = await catalogService.listCustomizations(req.tenant.tenant_id, req.params.id);
    res.json({ ok: true, groups });
  } catch (err) { next(err); }
});

router.post('/items/:id/customizations/groups', requireRestaurantAuth, async (req, res, next) => {
  const parsed = CustomizationGroupSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  try {
    const group = await catalogService.createCustomizationGroup(req.tenant.tenant_id, req.params.id, parsed.data);
    bustConfigCache(req.tenant.tenant_id);
    res.status(201).json({ ok: true, group });
  } catch (err) { next(err); }
});

router.delete('/items/:id/customizations/groups/:gid', requireRestaurantAuth, async (req, res, next) => {
  try {
    const row = await catalogService.deleteCustomizationGroup(req.tenant.tenant_id, req.params.id, req.params.gid);
    if (!row) return res.status(404).json({ error: 'Group not found' });
    bustConfigCache(req.tenant.tenant_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/items/:id/customizations/groups/:gid/options', requireRestaurantAuth, async (req, res, next) => {
  const parsed = CustomizationOptionSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, parsed);
  try {
    const option = await catalogService.createCustomizationOption(req.tenant.tenant_id, req.params.gid, parsed.data);
    bustConfigCache(req.tenant.tenant_id);
    res.status(201).json({ ok: true, option });
  } catch (err) { next(err); }
});

router.delete('/items/:id/customizations/options/:oid', requireRestaurantAuth, async (req, res, next) => {
  try {
    const row = await catalogService.deleteCustomizationOption(req.tenant.tenant_id, req.params.oid);
    if (!row) return res.status(404).json({ error: 'Option not found' });
    bustConfigCache(req.tenant.tenant_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
