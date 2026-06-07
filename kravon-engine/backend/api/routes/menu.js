/**
 * ROUTE — menu.js
 *
 * Public (no auth):
 *   GET  /v1/restaurants/:slug/menu/categories     — list categories + items
 *
 * Admin (requireRestaurantAuth — JWT must match tenant):
 *   POST   /v1/restaurants/:slug/menu/categories
 *   PUT    /v1/restaurants/:slug/menu/categories/:id
 *   DELETE /v1/restaurants/:slug/menu/categories/:id
 *
 *   POST   /v1/restaurants/:slug/menu/items
 *   PUT    /v1/restaurants/:slug/menu/items/:id
 *   DELETE /v1/restaurants/:slug/menu/items/:id
 *   PATCH  /v1/restaurants/:slug/menu/items/:id/availability
 *
 * All writes are scoped to req.tenant.tenant_id — a write can never touch
 * a row belonging to a different tenant (tenant_id is in every WHERE clause).
 *
 * Schema: menu.menus / menu.categories / menu.menu_items  (v12 multi-schema)
 * Soft deletes: deleted_at = NOW() — nothing is hard-deleted here.
 */

'use strict';

const express = require('express');
const { z }   = require('zod');
const { query, getClient } = require('../../db/pool');
const { requireRestaurantAuth } = require('../middleware/auth');

const router = express.Router();

// bustConfigCache is lazy-required to avoid circular dependency at module load
function _bustConfig(tenantId) {
  try { require('./config').bustConfigCache(tenantId); } catch (_) {}
}

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

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Returns the tenant's primary menu ID, creating one if none exists.
 * Every category must belong to a menu.menu_id row.
 */
async function getOrCreateMenu(tenantId) {
  const existing = await query(
    `SELECT id FROM menu.menus
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY created_at
     LIMIT 1`,
    [tenantId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const created = await query(
    `INSERT INTO menu.menus (tenant_id, name, menu_type)
     VALUES ($1, 'Main Menu', 'main')
     RETURNING id`,
    [tenantId]
  );
  return created.rows[0].id;
}

function validationError(res, issues) {
  return res.status(422).json({
    error:  'Validation failed',
    issues: issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  });
}

/* ══════════════════════════════════════════════════════════
   CATEGORIES
   ══════════════════════════════════════════════════════════ */

/* GET /categories — public */
router.get('/categories', async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;

    const result = await query(
      `SELECT
         c.id, c.name, c.description, c.position, c.is_active, c.surfaces AS cat_surfaces,
         i.id          AS item_id,
         i.name        AS item_name,
         i.description AS item_desc,
         i.price,
         i.food_type,
         i.is_available,
         i.is_customizable,
         i.sort_order,
         i.image_url,
         i.tags,
         i.surfaces    AS item_surfaces
       FROM menu.categories c
       LEFT JOIN menu.menu_items i
              ON i.category_id = c.id
             AND i.deleted_at IS NULL
       WHERE c.tenant_id = $1
         AND c.deleted_at IS NULL
       ORDER BY c.position, c.name, i.sort_order, i.name`,
      [tenantId]
    );

    const catMap = new Map();
    for (const row of result.rows) {
      if (!catMap.has(row.id)) {
        catMap.set(row.id, {
          id:          row.id,
          name:        row.name,
          description: row.description,
          position:    row.position,
          is_active:   row.is_active,
          surfaces:    row.cat_surfaces || null,
          items:       [],
        });
      }
      if (row.item_id) {
        catMap.get(row.id).items.push({
          id:              row.item_id,
          name:            row.item_name,
          description:     row.item_desc,
          price:           row.price !== null ? Number(row.price) : null,
          food_type:       row.food_type,
          is_available:    row.is_available,
          is_customizable: row.is_customizable,
          sort_order:      row.sort_order,
          image_url:       row.image_url,
          tags:            row.tags || [],
          surfaces:        row.item_surfaces || null,
        });
      }
    }

    res.json({ ok: true, categories: [...catMap.values()] });
  } catch (err) {
    next(err);
  }
});

/* POST /categories */
router.post('/categories', requireRestaurantAuth, async (req, res, next) => {
  const parsed = CategoryCreateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);

  try {
    const tenantId = req.tenant.tenant_id;
    const { name, description, position } = parsed.data;
    const menuId = await getOrCreateMenu(tenantId);

    const { surfaces } = parsed.data;
    const result = await query(
      `INSERT INTO menu.categories
         (tenant_id, menu_id, name, description, position, surfaces)
       VALUES ($1, $2, $3, $4, COALESCE($5,
         (SELECT COALESCE(MAX(position), -1) + 1 FROM menu.categories
          WHERE tenant_id = $1 AND deleted_at IS NULL)
       ), $6)
       RETURNING id, name, description, position, is_active, surfaces, created_at`,
      [tenantId, menuId, name, description ?? null, position ?? null, surfaces ?? null]
    );

    _bustConfig(tenantId);
    res.status(201).json({ ok: true, category: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/* PUT /categories/:id */
router.put('/categories/:id', requireRestaurantAuth, async (req, res, next) => {
  const parsed = CategoryUpdateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);
  if (Object.keys(parsed.data).length === 0) {
    return res.status(422).json({ error: 'No fields provided to update' });
  }

  try {
    const tenantId = req.tenant.tenant_id;
    const { id }   = req.params;
    const data     = parsed.data;

    const setClauses = [];
    const values     = [];
    let   idx        = 1;

    if (data.name        !== undefined) { setClauses.push(`name = $${idx++}`);        values.push(data.name); }
    if (data.description !== undefined) { setClauses.push(`description = $${idx++}`); values.push(data.description); }
    if (data.position    !== undefined) { setClauses.push(`position = $${idx++}`);    values.push(data.position); }
    if (data.is_active   !== undefined) { setClauses.push(`is_active = $${idx++}`);   values.push(data.is_active); }
    if (data.surfaces    !== undefined) { setClauses.push(`surfaces = $${idx++}`);    values.push(data.surfaces ?? null); }
    setClauses.push(`updated_at = NOW()`);

    values.push(id, tenantId);
    const result = await query(
      `UPDATE menu.categories
       SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING id, name, description, position, is_active, surfaces, updated_at`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Category not found' });
    }
    _bustConfig(tenantId);
    res.json({ ok: true, category: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/* DELETE /categories/:id — soft delete, also soft-deletes child items */
router.delete('/categories/:id', requireRestaurantAuth, async (req, res, next) => {
  const client = await getClient();
  try {
    const tenantId = req.tenant.tenant_id;
    const { id }   = req.params;

    await client.query('BEGIN');

    // Soft-delete the category (tenant_id guard prevents cross-tenant writes)
    const catResult = await client.query(
      `UPDATE menu.categories
       SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [id, tenantId]
    );
    if (!catResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Category not found' });
    }

    // Soft-delete all items in this category for the same tenant
    await client.query(
      `UPDATE menu.menu_items
       SET deleted_at = NOW()
       WHERE category_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId]
    );

    await client.query('COMMIT');
    _bustConfig(tenantId);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/* ══════════════════════════════════════════════════════════
   ITEMS
   ══════════════════════════════════════════════════════════ */

/* POST /items */
router.post('/items', requireRestaurantAuth, async (req, res, next) => {
  const parsed = ItemCreateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);

  try {
    const tenantId = req.tenant.tenant_id;
    const d        = parsed.data;

    // Verify category belongs to this tenant
    const catCheck = await query(
      `SELECT id FROM menu.categories
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [d.category_id, tenantId]
    );
    if (!catCheck.rows.length) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const result = await query(
      `INSERT INTO menu.menu_items
         (tenant_id, category_id, name, description, price,
          food_type, is_customizable, is_available, sort_order, image_url, tags, surfaces)
       VALUES ($1,$2,$3,$4,$5, $6,$7,$8,
               COALESCE($9, (SELECT COALESCE(MAX(sort_order), -1) + 1
                             FROM menu.menu_items
                             WHERE category_id = $2 AND deleted_at IS NULL)),
               $10, $11, $12)
       RETURNING id, category_id, name, description, price, food_type,
                 is_customizable, is_available, sort_order, image_url, tags, surfaces, created_at`,
      [
        tenantId, d.category_id, d.name, d.description ?? null, d.price,
        d.food_type ?? 'veg', d.is_customizable ?? false, d.is_available ?? true,
        d.sort_order ?? null, d.image_url ?? null, d.tags ?? [], d.surfaces ?? null,
      ]
    );

    const item = result.rows[0];
    if (item.price !== null) item.price = Number(item.price);
    _bustConfig(tenantId);
    res.status(201).json({ ok: true, item });
  } catch (err) {
    next(err);
  }
});

/* PUT /items/:id */
router.put('/items/:id', requireRestaurantAuth, async (req, res, next) => {
  const parsed = ItemUpdateSchema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);
  if (Object.keys(parsed.data).length === 0) {
    return res.status(422).json({ error: 'No fields provided to update' });
  }

  try {
    const tenantId = req.tenant.tenant_id;
    const { id }   = req.params;
    const d        = parsed.data;

    // If moving to a different category, verify new category belongs to tenant
    if (d.category_id) {
      const catCheck = await query(
        `SELECT id FROM menu.categories
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [d.category_id, tenantId]
      );
      if (!catCheck.rows.length) {
        return res.status(404).json({ error: 'Category not found' });
      }
    }

    const setClauses = [];
    const values     = [];
    let   idx        = 1;

    const fields = ['category_id','name','description','price','food_type',
                    'is_customizable','is_available','sort_order','image_url','tags'];
    for (const f of fields) {
      if (d[f] !== undefined) {
        setClauses.push(`${f} = $${idx++}`);
        values.push(d[f]);
      }
    }
    if (d.surfaces !== undefined) {
      setClauses.push(`surfaces = $${idx++}`);
      values.push(d.surfaces ?? null);
    }
    setClauses.push(`updated_at = NOW()`);

    values.push(id, tenantId);
    const result = await query(
      `UPDATE menu.menu_items
       SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING id, category_id, name, description, price, food_type,
                 is_customizable, is_available, sort_order, image_url, tags, surfaces, updated_at`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const item = result.rows[0];
    if (item.price !== null) item.price = Number(item.price);
    _bustConfig(tenantId);
    res.json({ ok: true, item });
  } catch (err) {
    next(err);
  }
});

/* PATCH /items/:id/availability — quick toggle for the owner dashboard */
router.patch('/items/:id/availability', requireRestaurantAuth, async (req, res, next) => {
  const schema = z.object({ is_available: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);

  try {
    const tenantId = req.tenant.tenant_id;
    const result   = await query(
      `UPDATE menu.menu_items
       SET is_available = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
       RETURNING id, name, is_available`,
      [parsed.data.is_available, req.params.id, tenantId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Item not found' });
    }
    _bustConfig(tenantId);
    res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

/* DELETE /items/:id */
router.delete('/items/:id', requireRestaurantAuth, async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const result   = await query(
      `UPDATE menu.menu_items
       SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [req.params.id, tenantId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Item not found' });
    }
    _bustConfig(tenantId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ══════════════════════════════════════════════════════════
   VARIANTS
   ══════════════════════════════════════════════════════════ */

/* GET /items/:id/variants */
router.get('/items/:id/variants', requireRestaurantAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, price, food_type, is_available, sort_order
       FROM menu.item_variants
       WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       ORDER BY sort_order, name`,
      [req.params.id, req.tenant.tenant_id]
    );
    res.json({ ok: true, variants: result.rows.map(r => ({ ...r, price: Number(r.price) })) });
  } catch (err) { next(err); }
});

/* POST /items/:id/variants */
router.post('/items/:id/variants', requireRestaurantAuth, async (req, res, next) => {
  const schema = z.object({
    name:         z.string().min(1).max(150),
    price:        z.number().min(0),
    food_type:    z.enum(['veg','non_veg','egg','vegan']).optional(),
    is_available: z.boolean().optional(),
    sort_order:   z.number().int().min(0).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);

  try {
    const tenantId = req.tenant.tenant_id;
    const d        = parsed.data;
    const result   = await query(
      `INSERT INTO menu.item_variants (tenant_id, menu_item_id, name, price, food_type, is_available, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, price, food_type, is_available, sort_order`,
      [tenantId, req.params.id, d.name, d.price, d.food_type ?? null, d.is_available ?? true, d.sort_order ?? 0]
    );
    await query(
      `UPDATE menu.menu_items SET has_variants = TRUE, is_customizable = TRUE, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );
    const v = result.rows[0];
    res.status(201).json({ ok: true, variant: { ...v, price: Number(v.price) } });
  } catch (err) { next(err); }
});

/* PUT /items/:id/variants/:vid */
router.put('/items/:id/variants/:vid', requireRestaurantAuth, async (req, res, next) => {
  const schema = z.object({
    name:         z.string().min(1).max(150).optional(),
    price:        z.number().min(0).optional(),
    food_type:    z.enum(['veg','non_veg','egg','vegan']).optional(),
    is_available: z.boolean().optional(),
    sort_order:   z.number().int().min(0).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);

  try {
    const d = parsed.data; const sets = []; const values = []; let idx = 1;
    if (d.name         !== undefined) { sets.push(`name = $${idx++}`);         values.push(d.name); }
    if (d.price        !== undefined) { sets.push(`price = $${idx++}`);        values.push(d.price); }
    if (d.food_type    !== undefined) { sets.push(`food_type = $${idx++}`);    values.push(d.food_type); }
    if (d.is_available !== undefined) { sets.push(`is_available = $${idx++}`); values.push(d.is_available); }
    if (d.sort_order   !== undefined) { sets.push(`sort_order = $${idx++}`);   values.push(d.sort_order); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    sets.push('updated_at = NOW()');
    values.push(req.params.vid, req.tenant.tenant_id);
    const result = await query(
      `UPDATE menu.item_variants SET ${sets.join(',')}
       WHERE id = $${idx} AND tenant_id = $${idx+1} AND deleted_at IS NULL
       RETURNING id, name, price, food_type, is_available, sort_order`, values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Variant not found' });
    const v = result.rows[0];
    res.json({ ok: true, variant: { ...v, price: Number(v.price) } });
  } catch (err) { next(err); }
});

/* DELETE /items/:id/variants/:vid */
router.delete('/items/:id/variants/:vid', requireRestaurantAuth, async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const result = await query(
      `UPDATE menu.item_variants SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.vid, tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Variant not found' });
    // If no variants remain, clear has_variants (keep is_customizable if groups exist)
    const remaining = await query(
      `SELECT COUNT(*) FROM menu.item_variants
       WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [req.params.id, tenantId]
    );
    if (Number(remaining.rows[0].count) === 0) {
      const groups = await query(
        `SELECT COUNT(*) FROM menu.customization_groups
         WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [req.params.id, tenantId]
      );
      await query(
        `UPDATE menu.menu_items SET has_variants = FALSE, is_customizable = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [Number(groups.rows[0].count) > 0, req.params.id, tenantId]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ══════════════════════════════════════════════════════════
   CUSTOMIZATION GROUPS + OPTIONS
   ══════════════════════════════════════════════════════════ */

/* GET /items/:id/customizations */
router.get('/items/:id/customizations', requireRestaurantAuth, async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    const groups   = await query(
      `SELECT id, name, group_type, is_required, min_select, max_select, is_free, position
       FROM menu.customization_groups
       WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       ORDER BY position`,
      [req.params.id, tenantId]
    );
    const groupIds = groups.rows.map(g => g.id);
    let options = { rows: [] };
    if (groupIds.length) {
      options = await query(
        `SELECT id, group_id, name, price_modifier, food_type, is_default, is_available, sort_order
         FROM menu.customization_options
         WHERE group_id = ANY($1) AND tenant_id = $2 AND deleted_at IS NULL
         ORDER BY group_id, sort_order`,
        [groupIds, tenantId]
      );
    }
    const optMap = new Map();
    for (const o of options.rows) {
      if (!optMap.has(o.group_id)) optMap.set(o.group_id, []);
      optMap.get(o.group_id).push({ ...o, price_modifier: Number(o.price_modifier) });
    }
    res.json({ ok: true, groups: groups.rows.map(g => ({ ...g, options: optMap.get(g.id) || [] })) });
  } catch (err) { next(err); }
});

/* POST /items/:id/customizations/groups */
router.post('/items/:id/customizations/groups', requireRestaurantAuth, async (req, res, next) => {
  const schema = z.object({
    name:        z.string().min(1).max(100),
    group_type:  z.enum(['radio','checkbox']).default('checkbox'),
    is_required: z.boolean().default(false),
    min_select:  z.number().int().min(0).default(0),
    max_select:  z.number().int().min(1).default(1),
    is_free:     z.boolean().default(false),
    position:    z.number().int().min(0).default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);

  try {
    const tenantId = req.tenant.tenant_id;
    const d = parsed.data;
    const result = await query(
      `INSERT INTO menu.customization_groups
         (tenant_id, menu_item_id, name, group_type, is_required, min_select, max_select, is_free, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, group_type, is_required, min_select, max_select, is_free, position`,
      [tenantId, req.params.id, d.name, d.group_type, d.is_required, d.min_select, d.max_select, d.is_free, d.position]
    );
    await query(
      `UPDATE menu.menu_items SET is_customizable = TRUE, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    );
    res.status(201).json({ ok: true, group: { ...result.rows[0], options: [] } });
  } catch (err) { next(err); }
});

/* DELETE /items/:id/customizations/groups/:gid */
router.delete('/items/:id/customizations/groups/:gid', requireRestaurantAuth, async (req, res, next) => {
  try {
    const tenantId = req.tenant.tenant_id;
    await query(
      `UPDATE menu.customization_options SET deleted_at = NOW()
       WHERE group_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [req.params.gid, tenantId]
    );
    const result = await query(
      `UPDATE menu.customization_groups SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.gid, tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Group not found' });
    // If no groups remain, reset is_customizable (keep TRUE if variants still exist)
    const remaining = await query(
      `SELECT COUNT(*) FROM menu.customization_groups
       WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [req.params.id, tenantId]
    );
    if (Number(remaining.rows[0].count) === 0) {
      const variants = await query(
        `SELECT COUNT(*) FROM menu.item_variants
         WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [req.params.id, tenantId]
      );
      await query(
        `UPDATE menu.menu_items SET is_customizable = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [Number(variants.rows[0].count) > 0, req.params.id, tenantId]
      );
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* POST /items/:id/customizations/groups/:gid/options */
router.post('/items/:id/customizations/groups/:gid/options', requireRestaurantAuth, async (req, res, next) => {
  const schema = z.object({
    name:           z.string().min(1).max(100),
    price_modifier: z.number().min(0).default(0),
    food_type:      z.enum(['veg','non_veg','egg','vegan']).optional(),
    is_default:     z.boolean().default(false),
    sort_order:     z.number().int().min(0).default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return validationError(res, parsed.error.issues);

  try {
    const d = parsed.data;
    const result = await query(
      `INSERT INTO menu.customization_options
         (tenant_id, group_id, name, price_modifier, food_type, is_default, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, price_modifier, food_type, is_default, is_available, sort_order`,
      [req.tenant.tenant_id, req.params.gid, d.name, d.price_modifier, d.food_type ?? null, d.is_default, d.sort_order]
    );
    const o = result.rows[0];
    res.status(201).json({ ok: true, option: { ...o, price_modifier: Number(o.price_modifier) } });
  } catch (err) { next(err); }
});

/* DELETE /items/:id/customizations/options/:oid */
router.delete('/items/:id/customizations/options/:oid', requireRestaurantAuth, async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE menu.customization_options SET deleted_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [req.params.oid, req.tenant.tenant_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Option not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
