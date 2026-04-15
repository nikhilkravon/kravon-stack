/**
 * MIDDLEWARE — feature.js
 * Enforces product availability flags before a route executes.
 *
 * Usage in server.js:
 *   app.use('/v1/restaurants/:slug/orders',
 *     resolveTenant,
 *     requireFeature('has_orders'),
 *     orderRoutes
 *   );
 *
 * If the restaurant does not have the product enabled, the request is
 * rejected with 403 before any service or DB code runs.
 *
 * This is a server-side enforcement layer. The frontend also hides
 * disabled products — but we never trust the frontend alone.
 *
 * Why a factory function?
 * requireFeature('has_tables') returns a middleware fn bound to that flag.
 * This keeps route declarations readable and avoids repeating the check
 * inside every route handler.
 *
 * Presence note:
 * has_presence is intentionally NOT gated here. Presence is a static HTML
 * product — it has no API routes of its own. /config is always public
 * because every product needs it to boot. has_presence is tracked in the DB
 * for billing records only.
 */

'use strict';

/**
 * requireFeature(flag)
 * Returns an Express middleware that checks req.tenant[flag].
 *
 * @param {string} flag - one of: has_tables, has_orders, has_catering, has_insights
 * @returns {Function} Express middleware
 *
 * Example:
 *   requireFeature('has_orders')
 *   → checks req.tenant.has_orders === true
 *   → 403 if false, next() if true
 */
function requireFeature(flag) {
  return function featureGate(req, res, next) {
    // req.tenant must be populated by resolveTenant middleware before this runs
    if (!req.tenant) {
      return res.status(500).json({ error: 'Tenant not resolved. Check middleware order in server.js.' });
    }

    if (!req.tenant[flag]) {
      return res.status(403).json({
        error: `This product is not enabled for ${req.tenant.slug}.`,
        product: flag,
      });
    }

    next();
  };
}

module.exports = { requireFeature };
