const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);
// Test runs make many auth calls, so the limiter is skipped there rather than
// forcing the assertions around it.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: () => process.env.NODE_ENV === "test",
});

router.post("/signup", authLimiter, c.signup);
router.post("/login", authLimiter, c.login);
router.post("/logout", requireAuth, c.logout);
router.post("/forgot-password", authLimiter, c.forgotPassword);
router.post("/reset-password", authLimiter, c.resetPassword);
router.post("/change-password", requireAuth, c.changePassword);
router.get("/me", requireAuth, c.me);

module.exports = router;
