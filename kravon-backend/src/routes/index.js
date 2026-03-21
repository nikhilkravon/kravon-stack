/**
 * Root route registrar.
 *
 * Register this file in server.js, then uncomment each resource
 * as its route module is created:
 *
 *   fastify.register(require('./src/routes'), { prefix: '/api/v1' });
 *
 * Or register individual resource routers directly in server.js:
 *   fastify.register(require('./src/routes/restaurants'), { prefix: '/api/v1/restaurants' });
 */
async function routes(fastify) {
  // fastify.register(require('./restaurants'), { prefix: '/restaurants' });
  // fastify.register(require('./menus'),       { prefix: '/menus' });
  // fastify.register(require('./orders'),      { prefix: '/orders' });
  // fastify.register(require('./auth'),        { prefix: '/auth' });
}

module.exports = routes;
