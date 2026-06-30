'use strict';

const { query, getClient } = require('../../db/pool');

function q(client) {
  return client ? client.query.bind(client) : query;
}

/* ── Categories ─────────────────────────────────────────────────────────── */

async function insertCategory(tenantId, menuId, { name, description, position, surfaces }) {
  const res = await query(
    `INSERT INTO menu.categories
       (tenant_id, menu_id, name, description, position, surfaces)
     VALUES ($1, $2, $3, $4,
       COALESCE($5, (SELECT COALESCE(MAX(position), -1) + 1
                    FROM menu.categories WHERE tenant_id = $1 AND deleted_at IS NULL)),
       $6)
     RETURNING id, name, description, position, is_active, surfaces, created_at`,
    [tenantId, menuId, name, description ?? null, position ?? null, surfaces ?? null]
  );
  return res.rows[0];
}

async function updateCategory(tenantId, id, data) {
  const sets = []; const values = []; let idx = 1;
  if (data.name        !== undefined) { sets.push(`name = $${idx++}`);        values.push(data.name); }
  if (data.description !== undefined) { sets.push(`description = $${idx++}`); values.push(data.description); }
  if (data.position    !== undefined) { sets.push(`position = $${idx++}`);    values.push(data.position); }
  if (data.is_active   !== undefined) { sets.push(`is_active = $${idx++}`);   values.push(data.is_active); }
  if (data.surfaces    !== undefined) { sets.push(`surfaces = $${idx++}`);    values.push(data.surfaces ?? null); }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  values.push(id, tenantId);
  const res = await query(
    `UPDATE menu.categories SET ${sets.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING id, name, description, position, is_active, surfaces, updated_at`,
    values
  );
  return res.rows[0] || null;
}

async function softDeleteCategory(client, tenantId, id) {
  const res = await q(client)(
    `UPDATE menu.categories SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

async function softDeleteItemsByCategory(client, tenantId, categoryId) {
  await q(client)(
    `UPDATE menu.menu_items SET deleted_at = NOW()
     WHERE category_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [categoryId, tenantId]
  );
}

/* ── Items ──────────────────────────────────────────────────────────────── */

async function verifyCategory(tenantId, categoryId) {
  const res = await query(
    `SELECT id FROM menu.categories WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [categoryId, tenantId]
  );
  return res.rows[0] || null;
}

async function insertItem(tenantId, d) {
  const res = await query(
    `INSERT INTO menu.menu_items
       (tenant_id, category_id, name, description, price, food_type,
        is_customizable, is_available, sort_order, image_url, tags, surfaces)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
       COALESCE($9, (SELECT COALESCE(MAX(sort_order), -1) + 1
                    FROM menu.menu_items WHERE category_id = $2 AND deleted_at IS NULL)),
       $10,$11,$12)
     RETURNING id, category_id, name, description, price, food_type,
               is_customizable, is_available, sort_order, image_url, tags, surfaces, created_at`,
    [
      tenantId, d.category_id, d.name, d.description ?? null, d.price,
      d.food_type ?? 'veg', d.is_customizable ?? false, d.is_available ?? true,
      d.sort_order ?? null, d.image_url ?? null, d.tags ?? [], d.surfaces ?? null,
    ]
  );
  return res.rows[0];
}

async function updateItem(tenantId, id, d) {
  const sets = []; const values = []; let idx = 1;
  const fields = ['category_id','name','description','price','food_type',
                  'is_customizable','is_available','sort_order','image_url','tags'];
  for (const f of fields) {
    if (d[f] !== undefined) { sets.push(`${f} = $${idx++}`); values.push(d[f]); }
  }
  if (d.surfaces !== undefined) { sets.push(`surfaces = $${idx++}`); values.push(d.surfaces ?? null); }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  values.push(id, tenantId);
  const res = await query(
    `UPDATE menu.menu_items SET ${sets.join(', ')}
     WHERE id = $${idx} AND tenant_id = $${idx + 1} AND deleted_at IS NULL
     RETURNING id, category_id, name, description, price, food_type,
               is_customizable, is_available, sort_order, image_url, tags, surfaces, updated_at`,
    values
  );
  return res.rows[0] || null;
}

async function setItemAvailability(tenantId, id, isAvailable) {
  const res = await query(
    `UPDATE menu.menu_items SET is_available = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
     RETURNING id, name, is_available`,
    [isAvailable, id, tenantId]
  );
  return res.rows[0] || null;
}

async function softDeleteItem(tenantId, id) {
  const res = await query(
    `UPDATE menu.menu_items SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [id, tenantId]
  );
  return res.rows[0] || null;
}

async function setItemFlags(tenantId, itemId, { hasVariants, isCustomizable }) {
  const sets = []; const values = []; let idx = 1;
  if (hasVariants    !== undefined) { sets.push(`has_variants = $${idx++}`);    values.push(hasVariants); }
  if (isCustomizable !== undefined) { sets.push(`is_customizable = $${idx++}`); values.push(isCustomizable); }
  if (!sets.length) return;
  sets.push('updated_at = NOW()');
  values.push(itemId, tenantId);
  await query(
    `UPDATE menu.menu_items SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1}`,
    values
  );
}

/* ── Variants ───────────────────────────────────────────────────────────── */

async function listVariants(tenantId, itemId) {
  const res = await query(
    `SELECT id, name, price, food_type, is_available, sort_order
     FROM menu.item_variants
     WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY sort_order, name`,
    [itemId, tenantId]
  );
  return res.rows.map(r => ({ ...r, price: Number(r.price) }));
}

async function insertVariant(tenantId, itemId, d) {
  const res = await query(
    `INSERT INTO menu.item_variants (tenant_id, menu_item_id, name, price, food_type, is_available, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, name, price, food_type, is_available, sort_order`,
    [tenantId, itemId, d.name, d.price, d.food_type ?? null, d.is_available ?? true, d.sort_order ?? 0]
  );
  return res.rows[0];
}

async function updateVariant(tenantId, variantId, d) {
  const sets = []; const values = []; let idx = 1;
  if (d.name         !== undefined) { sets.push(`name = $${idx++}`);         values.push(d.name); }
  if (d.price        !== undefined) { sets.push(`price = $${idx++}`);        values.push(d.price); }
  if (d.food_type    !== undefined) { sets.push(`food_type = $${idx++}`);    values.push(d.food_type); }
  if (d.is_available !== undefined) { sets.push(`is_available = $${idx++}`); values.push(d.is_available); }
  if (d.sort_order   !== undefined) { sets.push(`sort_order = $${idx++}`);   values.push(d.sort_order); }
  if (!sets.length) return null;
  sets.push('updated_at = NOW()');
  values.push(variantId, tenantId);
  const res = await query(
    `UPDATE menu.item_variants SET ${sets.join(',')}
     WHERE id = $${idx} AND tenant_id = $${idx+1} AND deleted_at IS NULL
     RETURNING id, name, price, food_type, is_available, sort_order`,
    values
  );
  return res.rows[0] || null;
}

async function softDeleteVariant(tenantId, variantId) {
  const res = await query(
    `UPDATE menu.item_variants SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [variantId, tenantId]
  );
  return res.rows[0] || null;
}

async function countVariants(tenantId, itemId) {
  const res = await query(
    `SELECT COUNT(*) AS cnt FROM menu.item_variants
     WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [itemId, tenantId]
  );
  return Number(res.rows[0].cnt);
}

/* ── Customization groups + options ─────────────────────────────────────── */

async function listCustomizationGroups(tenantId, itemId) {
  const res = await query(
    `SELECT id, name, group_type, is_required, min_select, max_select, is_free, position
     FROM menu.customization_groups
     WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY position`,
    [itemId, tenantId]
  );
  return res.rows;
}

async function listCustomizationOptions(tenantId, groupIds) {
  if (!groupIds.length) return [];
  const res = await query(
    `SELECT id, group_id, name, price_modifier, food_type, is_default, is_available, sort_order
     FROM menu.customization_options
     WHERE group_id = ANY($1) AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY group_id, sort_order`,
    [groupIds, tenantId]
  );
  return res.rows.map(r => ({ ...r, price_modifier: Number(r.price_modifier) }));
}

async function insertCustomizationGroup(tenantId, itemId, d) {
  const res = await query(
    `INSERT INTO menu.customization_groups
       (tenant_id, menu_item_id, name, group_type, is_required, min_select, max_select, is_free, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, name, group_type, is_required, min_select, max_select, is_free, position`,
    [tenantId, itemId, d.name, d.group_type, d.is_required, d.min_select, d.max_select, d.is_free, d.position]
  );
  return res.rows[0];
}

async function softDeleteCustomizationOptions(client, tenantId, groupId) {
  await q(client)(
    `UPDATE menu.customization_options SET deleted_at = NOW()
     WHERE group_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [groupId, tenantId]
  );
}

async function softDeleteCustomizationGroup(client, tenantId, groupId) {
  const res = await q(client)(
    `UPDATE menu.customization_groups SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [groupId, tenantId]
  );
  return res.rows[0] || null;
}

async function countCustomizationGroups(tenantId, itemId) {
  const res = await query(
    `SELECT COUNT(*) AS cnt FROM menu.customization_groups
     WHERE menu_item_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
    [itemId, tenantId]
  );
  return Number(res.rows[0].cnt);
}

async function insertCustomizationOption(tenantId, groupId, d) {
  const res = await query(
    `INSERT INTO menu.customization_options
       (tenant_id, group_id, name, price_modifier, food_type, is_default, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, name, price_modifier, food_type, is_default, is_available, sort_order`,
    [tenantId, groupId, d.name, d.price_modifier, d.food_type ?? null, d.is_default, d.sort_order]
  );
  return res.rows[0];
}

async function softDeleteCustomizationOption(tenantId, optionId) {
  const res = await query(
    `UPDATE menu.customization_options SET deleted_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
    [optionId, tenantId]
  );
  return res.rows[0] || null;
}

module.exports = {
  insertCategory, updateCategory, softDeleteCategory, softDeleteItemsByCategory,
  verifyCategory, insertItem, updateItem, setItemAvailability, softDeleteItem, setItemFlags,
  listVariants, insertVariant, updateVariant, softDeleteVariant, countVariants,
  listCustomizationGroups, listCustomizationOptions,
  insertCustomizationGroup, softDeleteCustomizationOptions,
  softDeleteCustomizationGroup, countCustomizationGroups,
  insertCustomizationOption, softDeleteCustomizationOption,
};
