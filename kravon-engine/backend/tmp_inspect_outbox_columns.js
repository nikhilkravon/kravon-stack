require('dotenv').config();
const { query } = require('./db/pool');
(async () => {
  const res = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
     ORDER BY ordinal_position`,
    ['platform', 'event_outbox']
  );
  console.log(res.rows.map(r => r.column_name).join(', '));
  process.exit(0);
})();
