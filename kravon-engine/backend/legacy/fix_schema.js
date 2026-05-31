const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { getClient } = require('./pool');

async function fixSchema() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Drop existing menu tables
    await client.query('DROP TABLE IF EXISTS customization_options CASCADE');
    await client.query('DROP TABLE IF EXISTS customization_groups CASCADE');
    await client.query('DROP TABLE IF EXISTS item_variants CASCADE');
    await client.query('DROP TABLE IF EXISTS menu_addons CASCADE');
    await client.query('DROP TABLE IF EXISTS spice_levels CASCADE');
    await client.query('DROP TABLE IF EXISTS menu_items CASCADE');
    await client.query('DROP TABLE IF EXISTS menu_categories CASCADE');

    // Recreate with tenant_id
    await client.query(`
      CREATE TABLE IF NOT EXISTS menu_categories (
        id          SERIAL PRIMARY KEY,
        tenant_id   UUID NOT NULL REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        subtitle    VARCHAR(200),
        sort_order  INT DEFAULT 0,
        active      BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS menu_items (
        id           SERIAL PRIMARY KEY,
        tenant_id    UUID NOT NULL REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
        category_id  INT NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
        name         VARCHAR(150) NOT NULL,
        price_paise  INT NOT NULL,
        description  TEXT,
        image        VARCHAR(20),
        image_bg     VARCHAR(200),
        badge        VARCHAR(50),
        badge_style  VARCHAR(20),
        customisable BOOLEAN DEFAULT FALSE,
        active       BOOLEAN DEFAULT TRUE,
        sort_order   INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS menu_addons (
        id          SERIAL PRIMARY KEY,
        tenant_id   UUID NOT NULL REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
        label       VARCHAR(100) NOT NULL,
        price_paise INT DEFAULT 0,
        active      BOOLEAN DEFAULT TRUE,
        sort_order  INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS spice_levels (
        id         SERIAL PRIMARY KEY,
        tenant_id  UUID NOT NULL REFERENCES tenant.restaurants(id) ON DELETE CASCADE,
        label      VARCHAR(50) NOT NULL,
        sort_order INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS item_variants (
        id          SERIAL PRIMARY KEY,
        item_id     INT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        price_paise INT DEFAULT 0,
        active      BOOLEAN DEFAULT TRUE,
        sort_order  INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS customization_groups (
        id          SERIAL PRIMARY KEY,
        item_id     INT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        type        VARCHAR(20) NOT NULL CHECK (type IN ('single', 'multiple')),
        min_select  INT DEFAULT 0,
        max_select  INT DEFAULT 1,
        sort_order  INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS customization_options (
        id          SERIAL PRIMARY KEY,
        group_id    INT NOT NULL REFERENCES customization_groups(id) ON DELETE CASCADE,
        name        VARCHAR(100) NOT NULL,
        price_paise INT DEFAULT 0,
        active      BOOLEAN DEFAULT TRUE,
        sort_order  INT DEFAULT 0
      );
    `);

    await client.query('COMMIT');
    console.log('Schema fixed');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Fix failed:', err);
  } finally {
    client.release();
  }
}

fixSchema().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });