'use strict';

const { query, getClient } = require('../../db/pool');
const repo = require('./repository');

function _bustConfig(tenantId) {
  try { require('../../api/routes/config').bustConfigCache(tenantId); } catch (_) {}
}

/* ── Menu resolution ────────────────────────────────────────────────────── */

async function getOrCreateMenu(tenantId) {
  const existing = await query(
    `SELECT id FROM menu.menus WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
    [tenantId]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const created = await query(
    `INSERT INTO menu.menus (tenant_id, name, menu_type) VALUES ($1, 'Main Menu', 'main') RETURNING id`,
    [tenantId]
  );
  return created.rows[0].id;
}

/* ── Categories read ────────────────────────────────────────────────────── */

async function getCategoriesWithItems(tenantId) {
  const result = await query(
    `SELECT
       c.id, c.name, c.description, c.position, c.is_active, c.surfaces AS cat_surfaces,
       i.id AS item_id, i.name AS item_name, i.description AS item_desc,
       i.price, i.food_type, i.is_available, i.is_customizable,
       i.sort_order, i.image_url, i.tags, i.surfaces AS item_surfaces
     FROM menu.categories c
     LEFT JOIN menu.menu_items i ON i.category_id = c.id AND i.deleted_at IS NULL
     WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
     ORDER BY c.position, c.name, i.sort_order, i.name`,
    [tenantId]
  );
  const catMap = new Map();
  for (const row of result.rows) {
    if (!catMap.has(row.id)) {
      catMap.set(row.id, {
        id: row.id, name: row.name, description: row.description,
        position: row.position, is_active: row.is_active,
        surfaces: row.cat_surfaces || null, items: [],
      });
    }
    if (row.item_id) {
      catMap.get(row.id).items.push({
        id: row.item_id, name: row.item_name, description: row.item_desc,
        price: row.price !== null ? Number(row.price) : null,
        food_type: row.food_type, is_available: row.is_available,
        is_customizable: row.is_customizable, sort_order: row.sort_order,
        image_url: row.image_url, tags: row.tags || [],
        surfaces: row.item_surfaces || null,
      });
    }
  }
  return [...catMap.values()];
}

/* ── Item price verification (used by ordering domain) ─────────────────── */

async function verifyItemsAvailable(client, tenantId, itemIds) {
  const res = await client.query(
    `SELECT id, name, price FROM menu.menu_items
     WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND is_available = TRUE AND deleted_at IS NULL`,
    [tenantId, itemIds]
  );
  if (res.rows.length !== itemIds.length) {
    throw Object.assign(new Error('One or more items not found or unavailable.'), { status: 400 });
  }
  return new Map(res.rows.map(r => [r.id, { name: r.name, price: Number(r.price) }]));
}

/* ── Categories write ───────────────────────────────────────────────────── */

async function createCategory(tenantId, data) {
  const menuId = await getOrCreateMenu(tenantId);
  const row = await repo.insertCategory(tenantId, menuId, data);
  _bustConfig(tenantId);
  return row;
}

async function updateCategory(tenantId, id, data) {
  const row = await repo.updateCategory(tenantId, id, data);
  if (row) _bustConfig(tenantId);
  return row;
}

async function deleteCategory(tenantId, id) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const row = await repo.softDeleteCategory(client, tenantId, id);
    if (!row) { await client.query('ROLLBACK'); return null; }
    await repo.softDeleteItemsByCategory(client, tenantId, id);
    await client.query('COMMIT');
    _bustConfig(tenantId);
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/* ── Items write ────────────────────────────────────────────────────────── */

async function createItem(tenantId, data) {
  const cat = await repo.verifyCategory(tenantId, data.category_id);
  if (!cat) return null;
  const row = await repo.insertItem(tenantId, data);
  if (row.price !== null) row.price = Number(row.price);
  _bustConfig(tenantId);
  return row;
}

async function updateItem(tenantId, id, data) {
  if (data.category_id) {
    const cat = await repo.verifyCategory(tenantId, data.category_id);
    if (!cat) return null;
  }
  const row = await repo.updateItem(tenantId, id, data);
  if (row) {
    if (row.price !== null) row.price = Number(row.price);
    _bustConfig(tenantId);
  }
  return row;
}

async function setItemAvailability(tenantId, id, isAvailable) {
  const row = await repo.setItemAvailability(tenantId, id, isAvailable);
  if (row) _bustConfig(tenantId);
  return row;
}

async function deleteItem(tenantId, id) {
  const row = await repo.softDeleteItem(tenantId, id);
  if (row) _bustConfig(tenantId);
  return row;
}

/* ── Variants write ─────────────────────────────────────────────────────── */

async function listVariants(tenantId, itemId) {
  return repo.listVariants(tenantId, itemId);
}

async function createVariant(tenantId, itemId, data) {
  const row = await repo.insertVariant(tenantId, itemId, data);
  await repo.setItemFlags(tenantId, itemId, { hasVariants: true, isCustomizable: true });
  return { ...row, price: Number(row.price) };
}

async function updateVariant(tenantId, variantId, data) {
  const row = await repo.updateVariant(tenantId, variantId, data);
  if (row) row.price = Number(row.price);
  return row;
}

async function deleteVariant(tenantId, itemId, variantId) {
  const row = await repo.softDeleteVariant(tenantId, variantId);
  if (!row) return null;
  const remaining = await repo.countVariants(tenantId, itemId);
  if (remaining === 0) {
    const groupCount = await repo.countCustomizationGroups(tenantId, itemId);
    await repo.setItemFlags(tenantId, itemId, {
      hasVariants: false,
      isCustomizable: groupCount > 0,
    });
  }
  return row;
}

/* ── Customizations write ───────────────────────────────────────────────── */

async function listCustomizations(tenantId, itemId) {
  const groups  = await repo.listCustomizationGroups(tenantId, itemId);
  const options = await repo.listCustomizationOptions(tenantId, groups.map(g => g.id));
  const optMap  = new Map();
  for (const o of options) {
    if (!optMap.has(o.group_id)) optMap.set(o.group_id, []);
    optMap.get(o.group_id).push(o);
  }
  return groups.map(g => ({ ...g, options: optMap.get(g.id) || [] }));
}

async function createCustomizationGroup(tenantId, itemId, data) {
  const row = await repo.insertCustomizationGroup(tenantId, itemId, data);
  await repo.setItemFlags(tenantId, itemId, { isCustomizable: true });
  return { ...row, options: [] };
}

async function deleteCustomizationGroup(tenantId, itemId, groupId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await repo.softDeleteCustomizationOptions(client, tenantId, groupId);
    const row = await repo.softDeleteCustomizationGroup(client, tenantId, groupId);
    if (!row) { await client.query('ROLLBACK'); return null; }
    await client.query('COMMIT');

    const remaining = await repo.countCustomizationGroups(tenantId, itemId);
    if (remaining === 0) {
      const variantCount = await repo.countVariants(tenantId, itemId);
      await repo.setItemFlags(tenantId, itemId, { isCustomizable: variantCount > 0 });
    }
    return row;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function createCustomizationOption(tenantId, groupId, data) {
  const row = await repo.insertCustomizationOption(tenantId, groupId, data);
  return { ...row, price_modifier: Number(row.price_modifier) };
}

async function deleteCustomizationOption(tenantId, optionId) {
  return repo.softDeleteCustomizationOption(tenantId, optionId);
}

module.exports = {
  getOrCreateMenu,
  getCategoriesWithItems,
  verifyItemsAvailable,
  createCategory, updateCategory, deleteCategory,
  createItem, updateItem, setItemAvailability, deleteItem,
  listVariants, createVariant, updateVariant, deleteVariant,
  listCustomizations, createCustomizationGroup, deleteCustomizationGroup,
  createCustomizationOption, deleteCustomizationOption,
};
