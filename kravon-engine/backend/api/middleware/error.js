/**
 * MIDDLEWARE — error.js
 * Global Express error handler. Never leaks stack traces in production.
 */

'use strict';

// Standard error codes by HTTP status — used when err.code is not set explicitly.
const STATUS_CODES = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'validation_error',
  429: 'rate_limited',
  500: 'internal_error',
};

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const code   = err.code || STATUS_CODES[status] || 'internal_error';
  const msg    = process.env.NODE_ENV === 'production'
    ? (status < 500 ? err.message : 'Internal server error')
    : err.message;

  if (status >= 500) {
    if (process.env.NODE_ENV === 'production') {
      console.error(JSON.stringify({
        level: 'error', event: 'unhandled_error', reqId: req.id,
        method: req.method, path: req.path, status,
        message: err.message, stack: err.stack,
      }));
    } else {
      console.error(`[error] ${req.method} ${req.path}:`, err);
    }
  }

  res.status(status).json({ error: msg, code, reqId: req.id });
}

module.exports = { errorHandler };
