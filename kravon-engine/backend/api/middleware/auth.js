/**
 * MIDDLEWARE — auth.js
 * JWT validation for admin / insight routes.
 * Public routes (config, order create, lead create) do not use this.
 */

'use strict';

const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * requireRestaurantAuth
 * Ensures the JWT subject matches the requested restaurant_id.
 * Prevents a restaurant admin from reading another tenant's data.
 */
function requireRestaurantAuth(req, res, next) {
  requireAuth(req, res, () => {
    if (req.auth.tenantId !== req.tenant.tenant_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });
}

/**
 * requireRole(...roles)
 * Returns middleware that allows only staff whose JWT roles array contains
 * at least one of the specified roles. Must run after requireRestaurantAuth.
 *
 * Usage: router.post('/export', requireRole('owner', 'admin'), handler)
 */
function requireRole(...allowed) {
  return (req, res, next) => {
    const staffRoles = req.auth?.roles || [];
    if (!allowed.some(r => staffRoles.includes(r))) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRestaurantAuth, requireRole };
