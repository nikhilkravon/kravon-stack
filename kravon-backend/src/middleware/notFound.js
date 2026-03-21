/**
 * 404 handler — catches any request that didn't match a defined route.
 * Register this BEFORE errorHandler in server.js.
 */
const notFound = (req, res, next) => {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.status = 404;
  next(err);
};

module.exports = notFound;
