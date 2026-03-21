/**
 * Central error-handling middleware.
 * Must be registered LAST in server.js (after all routes).
 *
 * Usage — throw or pass errors like:
 *   const err = new Error('Not found');
 *   err.status = 404;
 *   next(err);
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  console.error(`[${new Date().toISOString()}] ${status} — ${message}`, err.stack);

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
