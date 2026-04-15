/**
 * MIDDLEWARE — error.js
 * Global Express error handler. Never leaks stack traces in production.
 */

'use strict';

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const msg    = process.env.NODE_ENV === 'production'
    ? (status < 500 ? err.message : 'Internal server error')
    : err.message;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.path}:`, err);
  }

  res.status(status).json({ error: msg });
}

module.exports = { errorHandler };
