require('dotenv').config();
const { query } = require('./db/pool');
(async () => {
  const tables = [
    ['menu', 'categories'],
    ['menu', 'menu_items'],
  ];
  for (const [schema, table] of tables) {
    const res = await query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [schema, table]
    );
    console.log(`${schema}.${table}:`, res.rows.map(r => r.column_name).join(', '));
  }
  process.exit(0);
})();
