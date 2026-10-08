// Central error handler - keep controllers thin by throwing / calling next(err)
function errorHandler(err, req, res, next) {
  const status =
    err.status ||
    { P2002: 409, P2003: 409, P2025: 404, P2034: 409 }[err.code] ||
    500;
  const message = err.code
    ? {
        P2002: "Record already exists",
        P2003: "Related record conflict",
        P2025: "Record not found",
        P2034: "Concurrent update; please retry",
      }[err.code] || "Database operation failed"
    : status === 500
    ? "Internal server error"
    : err.message;

  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
}

// Wrap async controller functions so thrown errors reach errorHandler
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { errorHandler, asyncHandler };
