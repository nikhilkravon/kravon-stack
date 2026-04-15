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
    if (req.auth.restaurantId !== req.tenant.rest_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });
}

module.exports = { requireAuth, requireRestaurantAuth };
