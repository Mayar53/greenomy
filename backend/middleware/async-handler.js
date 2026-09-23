// middleware/async-handler.js — Express 4 does not forward rejected promises
// from async route handlers to the error middleware, and modern Node kills the
// process on an unhandled rejection. Wrapping a handler with this turns a
// failure into an ordinary 500 response instead of an outage.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Wraps every handler on a controller module so route files stay simple:
 *   const ctrl = wrapController(require("../controllers/x.controller"));
 * Harmless for synchronous handlers. */
function wrapController(controller) {
  const wrapped = {};
  for (const [name, handler] of Object.entries(controller)) {
    wrapped[name] = typeof handler === "function" ? asyncHandler(handler) : handler;
  }
  return wrapped;
}

module.exports = { asyncHandler, wrapController };
