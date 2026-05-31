const { Client } = require('pg');
const client = new Client(process.env.DATABASE_URL);
(async () => {
  try {
    await client.connect();

    const restaurants = ['spice-of-india', 'dead-flat-co'];

    for (const slug of restaurants) {
      console.log(`\n=== RESTAURANT: ${slug.toUpperCase()} ===`);

      const tenant = await client.query(`
        SELECT id, slug, name, has_presence, has_tables, has_orders
        FROM tenant.restaurants
        WHERE slug = $1
      `, [slug]);
      console.table(tenant.rows);

      const publicRest = await client.query(`
        SELECT rest_id, slug, name, has_presence, has_tables, has_orders
        FROM public.restaurants
        WHERE slug = $1
      `, [slug]);
      console.log(`PUBLIC RESTAURANT RECORD FOR ${slug}:`);
      console.table(publicRest.rows);

      const tenantId = tenant.rows[0]?.id;
      if (tenantId) {
        const menuItems = await client.query(`
          SELECT id, name, price_paise, customisable, active
          FROM public.menu_items
          WHERE tenant_id = $1
          LIMIT 5
        `, [tenantId]);
        console.log(`\n=== MENU ITEMS for ${slug} ===`);
        console.table(menuItems.rows);

        const tableCount = await client.query(`
          SELECT COUNT(*) AS tables
          FROM dining.tables
          WHERE tenant_id = $1
        `, [tenantId]);
        console.log(`${slug}: tables = ${tableCount.rows[0].tables}`);
      } else {
        console.log(`${slug}: no tenant record found`);
      }

      const orderCount = await client.query(`
        SELECT COUNT(*) AS orders
        FROM public.orders
        WHERE rest_id = (
          SELECT rest_id FROM public.restaurants WHERE slug = $1
        )
      `, [slug]);
      console.log(`${slug}: orders = ${orderCount.rows[0].orders}`);
    }

    console.log('\n=== GLOBAL COUNTS ===');
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM public.restaurants) AS restaurants,
        (SELECT COUNT(*) FROM public.orders) AS total_orders,
        (SELECT COUNT(*) FROM dining.reservations) AS reservations,
        (SELECT COUNT(*) FROM dining.tables) AS tables
    `);
    console.table(counts.rows);
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
})();
