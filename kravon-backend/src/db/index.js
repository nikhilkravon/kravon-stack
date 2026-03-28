const { Pool } = require('pg');

/**
 * PostgreSQL connection pool for Kravon.
 *
 * Reads from environment variables (set in .env):
 *   DB_HOST     - database host          (default: localhost)
 *   DB_PORT     - database port          (default: 5432)
 *   DB_USER     - database user
 *   DB_PASSWORD - database password
 *   DB_NAME     - database name
 *   DB_SSL      - enable SSL             ("true" | "false", default: false)
 */
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  // Pool tuning
  max:                    10,
  idleTimeoutMillis:  30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[DB] New client connected to PostgreSQL');
  }
});

pool.on('error', (err) => {
  // Log but don't exit — idle client errors are usually transient (network blip,
  // server-side timeout). The pool will create a new client on next request.
  console.error('[DB] Unexpected error on idle client:', err.message);
});

/**
 * Execute a single parameterised query against the pool.
 *
 * @param {string} text   - SQL string, use $1 $2 … for params
 * @param {Array}  [params] - Parameter values
 * @returns {Promise<import('pg').QueryResult>}
 *
 * @example
 * const { rows } = await query('SELECT * FROM restaurants WHERE id = $1', [id]);
 */
const query = (text, params) => pool.query(text, params);

/**
 * Acquire a dedicated client for multi-statement transactions.
 * Always call client.release() in a finally block.
 *
 * @returns {Promise<import('pg').PoolClient>}
 */
const getClient = () => pool.connect();

/**
 * Run an async callback inside a transaction.
 * Commits on success; rolls back and re-throws on error.
 *
 * @param {function(import('pg').PoolClient): Promise<any>} callback
 * @returns {Promise<any>}
 *
 * @example
 * const result = await withTransaction(async (client) => {
 *   await client.query('INSERT INTO orders ...');
 *   await client.query('UPDATE inventory ...');
 *   return result;
 * });
 */
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, getClient, withTransaction };
