// middleware/security-headers.js — response hardening for the API.
//
// Content-Security-Policy is deliberately NOT set here: the API only returns
// JSON. CSP protects HTML documents, which are served by the static host, so
// it belongs there — docs/DEPLOYMENT.md carries the recommended policy.
module.exports = function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  // The web app reads geolocation and the camera; nothing needs the microphone.
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(self), microphone=()");

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
};
