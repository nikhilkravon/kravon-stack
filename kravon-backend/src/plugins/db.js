const fp = require('fastify-plugin');
const { pool, query, getClient, withTransaction } = require('../db');

/**
 * Fastify plugin — database decorator.
 *
 * Decorates the Fastify instance with `fastify.db`, exposing:
 *   fastify.db.pool            — raw pg Pool (for advanced use)
 *   fastify.db.query()         — single-query helper
 *   fastify.db.getClient()     — acquire a dedicated pool client
 *   fastify.db.withTransaction() — run a callback inside a transaction
 *
 * Usage in a route handler:
 *   const { rows } = await fastify.db.query('SELECT * FROM restaurants');
 *
 * Wrapped with fastify-plugin so the decorator is available across
 * all scopes (not scoped to the plugin's encapsulation context).
 */
async function dbPlugin(fastify) {
  // Verify the connection is live at start-up
  try {
    const { rows } = await query('SELECT NOW() AS now');
    fastify.log.info(`[DB] Connected to PostgreSQL — server time: ${rows[0].now}`);
  } catch (err) {
    fastify.log.error('[DB] Failed to connect to PostgreSQL:', err.message);
    throw err; // surface the error so Fastify stops cleanly
  }

  fastify.decorate('db', {
    pool,
    query,
    getClient,
    withTransaction,
  });

  // Gracefully close the pool when the server shuts down
  fastify.addHook('onClose', async () => {
    fastify.log.info('[DB] Closing PostgreSQL pool...');
    await pool.end();
  });
}

// fastify-plugin removes the encapsulation boundary so fastify.db
// is visible to all routes, not just those registered after this plugin.
module.exports = fp(dbPlugin, {
  name: 'kravon-db',
  fastify: '5.x',
});
