'use strict';

const { query } = require('../../db/pool');

const VALID_SURFACES = new Set(['delivery', 'pickup', 'dine_in', 'catering']);

async function getMenuData(tenantId, surface) {
  const validSurface      = VALID_SURFACES.has(surface) ? surface : null;
  const catChannelFilter  = validSurface ? `AND (c.surfaces IS NULL OR $2 = ANY(c.surfaces))` : '';
  const itemChannelFilter = validSurface ? `AND (i.surfaces IS NULL OR $2 = ANY(i.surfaces))` : '';
  const params            = validSurface ? [tenantId, validSurface] : [tenantId];

  const res = await query(`
    SELECT
      c.id          AS cat_id,
      c.name        AS cat_name,
      c.description AS cat_subtitle,
      c.position    AS cat_sort,
      c.surfaces    AS cat_surfaces,
      i.id          AS item_id,
      i.name        AS item_name,
      i.price       AS item_price,
      i.description AS item_desc,
      i.image_url   AS image,
      i.surfaces    AS item_surfaces,
      i.is_customizable OR EXISTS (
        SELECT 1 FROM menu.customization_groups g
        WHERE g.menu_item_id = i.id AND g.tenant_id = i.tenant_id AND g.deleted_at IS NULL
      ) AS is_customizable,
      i.has_variants OR EXISTS (
        SELECT 1 FROM menu.item_variants v
        WHERE v.menu_item_id = i.id AND v.tenant_id = i.tenant_id AND v.deleted_at IS NULL
      ) AS has_variants,
      i.sort_order  AS item_sort,
      i.tags,
      i.food_type
    FROM menu.categories c
    LEFT JOIN menu.menu_items i
           ON i.category_id = c.id
          AND i.is_available = TRUE
          AND i.deleted_at IS NULL
          ${itemChannelFilter}
    WHERE c.tenant_id = $1
      AND c.is_active = TRUE
      AND c.deleted_at IS NULL
      ${catChannelFilter}
    ORDER BY c.position, i.sort_order
  `, params);

  const catMap    = new Map();
  const flatItems = [];

  for (const row of res.rows) {
    if (!catMap.has(row.cat_id)) {
      catMap.set(row.cat_id, {
        id:       row.cat_id,
        name:     row.cat_name,
        subtitle: row.cat_subtitle,
        surfaces: row.cat_surfaces || null,
        items:    [],
      });
    }
    if (row.item_id) {
      const item = {
        id:              row.item_id,
        name:            row.item_name,
        price:           Number(row.item_price),
        desc:            row.item_desc,
        image:           row.image,
        imageBg:         null,
        badge:           null,
        badgeStyle:      null,
        badgeClass:      '',
        is_customizable: row.is_customizable,
        customise:       row.is_customizable,
        has_variants:    row.has_variants,
        food_type:       row.food_type,
        tags:            row.tags || [],
        surfaces:        row.item_surfaces || null,
      };
      catMap.get(row.cat_id).items.push(item);
      flatItems.push(item);
    }
  }

  return { categories: Array.from(catMap.values()), flatItems };
}

async function getItemDetail(tenantId, itemId) {
  const itemRes = await query(`
    SELECT id, name, price, description, is_customizable, has_variants
    FROM menu.menu_items
    WHERE id = $1 AND tenant_id = $2 AND is_available = TRUE AND deleted_at IS NULL
  `, [itemId, tenantId]);

  if (!itemRes.rows.length) return null;
  const item = itemRes.rows[0];

  const [variantsRes, groupsRes] = await Promise.all([
    query(`
      SELECT id, name, price
      FROM menu.item_variants
      WHERE menu_item_id = $1 AND is_available = TRUE AND deleted_at IS NULL
      ORDER BY sort_order
    `, [itemId]),
    query(`
      SELECT id, name, group_type, is_required, min_select, max_select
      FROM menu.customization_groups
      WHERE menu_item_id = $1 AND deleted_at IS NULL
      ORDER BY position
    `, [itemId]),
  ]);

  const variants = variantsRes.rows.map(v => ({ id: v.id, name: v.name, price: Number(v.price) }));

  const customizations = await Promise.all(
    groupsRes.rows.map(async (group) => {
      const optRes = await query(`
        SELECT id, name, price_modifier, is_default
        FROM menu.customization_options
        WHERE group_id = $1 AND is_available = TRUE AND deleted_at IS NULL
        ORDER BY sort_order
      `, [group.id]);
      return {
        id:          group.id,
        name:        group.name,
        group_type:  group.group_type,
        is_required: group.is_required,
        min_select:  group.min_select,
        max_select:  group.max_select,
        options:     optRes.rows.map(o => ({
          id:             o.id,
          name:           o.name,
          price_modifier: Number(o.price_modifier),
          is_default:     o.is_default,
        })),
      };
    })
  );

  return {
    id:              item.id,
    name:            item.name,
    price:           Number(item.price),
    description:     item.description,
    has_variants:    item.has_variants,
    is_customizable: item.is_customizable,
    variants,
    customizations,
  };
}

module.exports = { getMenuData, getItemDetail };
