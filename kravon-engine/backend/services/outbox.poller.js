'use strict';

/**
 * Outbox poller — delivers events from platform.event_outbox durably.
 *
 * Events written inside a DB transaction to platform.event_outbox are
 * guaranteed to survive a process crash. This poller picks them up and
 * fires them onto the in-process event bus so all existing listeners work
 * without modification.
 *
 * Retry schedule (exponential back-off):
 *   attempt 1 → immediate
 *   attempt 2 → +30s
 *   attempt 3 → +2m
 *   attempt 4 → +10m
 *   attempt 5+ → +1h  (give up after 5 attempts, mark failed)
 *
 * The poller uses SELECT ... FOR UPDATE SKIP LOCKED so multiple Node
 * processes (horizontal scaling) never double-deliver an event.
 */

const { getClient } = require('../db/pool');
const events        = require('../utils/events');

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE       = 50;
const MAX_ATTEMPTS     = 5;

function nextDelay(attempts) {
  const delays = [0, 30, 120, 600, 3600]; // seconds
  return (delays[attempts] ?? 3600) * 1000;
}

async function pollOnce() {
  let client;
  try {
    client = await getClient();
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'outbox.connect_failed', error: err.message }));
    return;
  }
  try {
    await client.query('BEGIN');

    const res = await client.query(
      `SELECT id, tenant_id, event_type, payload, attempts
       FROM platform.event_outbox
       WHERE status IN ('pending', 'failed')
         AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );

    for (const row of res.rows) {
      try {
        events.emit(row.event_type, { ...row.payload, _outboxId: row.id });

        await client.query(
          `UPDATE platform.event_outbox
           SET status = 'delivered', delivered_at = NOW(), attempts = attempts + 1
           WHERE id = $1`,
          [row.id]
        );
      } catch (err) {
        const newAttempts = row.attempts + 1;
        const failed      = newAttempts >= MAX_ATTEMPTS;
        const nextAt      = new Date(Date.now() + nextDelay(newAttempts)).toISOString();

        await client.query(
          `UPDATE platform.event_outbox
           SET status = $1, attempts = $2, last_error = $3, next_attempt_at = $4
           WHERE id = $5`,
          [failed ? 'failed' : 'pending', newAttempts, err.message, nextAt, row.id]
        );

        console.error(JSON.stringify({
          level: 'error', event: 'outbox.delivery_failed',
          outboxId: row.id, eventType: row.event_type, attempt: newAttempts,
          error: err.message,
        }));
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(JSON.stringify({ level: 'error', event: 'outbox.poll_failed', error: err.message }));
  } finally {
    if (client) client.release();
  }
}

let _timer = null;

function start() {
  if (_timer) return;
  _timer = setInterval(pollOnce, POLL_INTERVAL_MS);
  _timer.unref(); // don't prevent process exit
  pollOnce(); // deliver any backlog immediately on startup
  console.log(JSON.stringify({ level: 'info', event: 'outbox.poller_started', intervalMs: POLL_INTERVAL_MS }));
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, pollOnce };
