-- ============================================================
-- MIGRATION v22 — Menu surface visibility
--
-- Adds a `surfaces` TEXT[] column to both categories and items.
-- NULL means "visible on all surfaces" (backwards-compatible default).
-- A non-null array restricts the row to only those surfaces.
--
-- Valid surface values (matches fulfillment_type ENUM):
--   'delivery' | 'pickup' | 'dine_in' | 'catering'
-- ============================================================

ALTER TABLE menu.categories
    ADD COLUMN surfaces TEXT[];

ALTER TABLE menu.menu_items
    ADD COLUMN surfaces TEXT[];

-- Partial index: only rows that actually have restrictions
-- (NULL rows — i.e. visible everywhere — don't need to be indexed)
CREATE INDEX idx_categories_surfaces
    ON menu.categories USING gin(surfaces)
    WHERE surfaces IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_menu_items_surfaces
    ON menu.menu_items USING gin(surfaces)
    WHERE surfaces IS NOT NULL AND deleted_at IS NULL;

-- Record migration
INSERT INTO platform.schema_migrations (version, description)
VALUES ('v22', 'menu-surface-visibility');
