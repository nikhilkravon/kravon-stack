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

/* ── Zod schemas ─────────────────────────────────────────────────────────── */

const CategoryCreateSchema = z.object({
  name:        z.string().min(1).max(150),
  description: z.string().max(500).nullable().optional(),
  position:    z.number().int().min(0).max(999).optional(),
});

const CategoryUpdateSchema = z.object({
  name:        z.string().min(1).max(150).optional(),
  description: z.string().max(500).nullable().optional(),
  position:    z.number().int().min(0).max(999).optional(),
  is_active:   z.boolean().optional(),
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
         c.id, c.name, c.description, c.position, c.is_active,
         i.id          AS item_id,
         i.name        AS item_name,
         i.description AS item_desc,
         i.price,
         i.food_type,
         i.is_available,
         i.is_customizable,
         i.sort_order,
         i.image_url,
         i.tags
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

    const result = await query(
      `INSERT INTO menu.categories
         (tenant_id, menu_id, name, description, position)
       VALUES ($1, $2, $3, $4, COALESCE($5,
         (SELECT COALESCE(MAX(position), -1) + 1 FROM menu.categories
          WHERE tenant_id = $1 AND deleted_at IS NULL)
       ))
       RETURNING id, name, description, position, is_active, created_at`,
      [tenantId, menuId, name, description ?? null, position ?? null]
    );

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
    setClauses.push(`updated_at = NOW()`);

    values.push(id, tenantId);
    const result = await query(
      `UPDATE menu.categories
       SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING id, name, description, position, is_active, updated_at`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Category not found' });
    }
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
          food_type, is_customizable, is_available, sort_order, image_url, tags)
       VALUES ($1,$2,$3,$4,$5, $6,$7,$8,
               COALESCE($9, (SELECT COALESCE(MAX(sort_order), -1) + 1
                             FROM menu.menu_items
                             WHERE category_id = $2 AND deleted_at IS NULL)),
               $10, $11)
       RETURNING id, category_id, name, description, price, food_type,
                 is_customizable, is_available, sort_order, image_url, tags, created_at`,
      [
        tenantId, d.category_id, d.name, d.description ?? null, d.price,
        d.food_type ?? 'veg', d.is_customizable ?? false, d.is_available ?? true,
        d.sort_order ?? null, d.image_url ?? null, d.tags ?? [],
      ]
    );

    const item = result.rows[0];
    if (item.price !== null) item.price = Number(item.price);
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
    setClauses.push(`updated_at = NOW()`);

    values.push(id, tenantId);
    const result = await query(
      `UPDATE menu.menu_items
       SET ${setClauses.join(', ')}
       WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
       RETURNING id, category_id, name, description, price, food_type,
                 is_customizable, is_available, sort_order, image_url, tags, updated_at`,
      values
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const item = result.rows[0];
    if (item.price !== null) item.price = Number(item.price);
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
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
