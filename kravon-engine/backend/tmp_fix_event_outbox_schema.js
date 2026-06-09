require('dotenv').config();
const { query } = require('./db/pool');
(async () => {
  console.log('Patching platform.event_outbox schema...');
  await query(`ALTER TABLE platform.event_outbox
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await query(`UPDATE platform.event_outbox
    SET attempts = COALESCE(retry_count, 0),
        last_error = COALESCE(error_detail, last_error)
    WHERE retry_count IS NOT NULL OR error_detail IS NOT NULL`);
  await query(`CREATE INDEX IF NOT EXISTS idx_event_outbox_poll
    ON platform.event_outbox (next_attempt_at, status)
    WHERE status IN ('pending', 'failed')`);
  console.log('Schema patch complete.');
  process.exit(0);
})();
