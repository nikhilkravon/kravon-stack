require('dotenv').config();
const { query } = require('./db/pool');
(async () => {
  console.log('Adding missing surfaces columns to menu.categories and menu.menu_items...');
  await query(`ALTER TABLE menu.categories
    ADD COLUMN IF NOT EXISTS surfaces TEXT[]`);
  await query(`ALTER TABLE menu.menu_items
    ADD COLUMN IF NOT EXISTS surfaces TEXT[]`);
  await query(`CREATE INDEX IF NOT EXISTS idx_categories_surfaces ON menu.categories USING gin(surfaces)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_menu_items_surfaces ON menu.menu_items USING gin(surfaces)`);
  console.log('Surfaces columns and indexes added.');
  process.exit(0);
})();
