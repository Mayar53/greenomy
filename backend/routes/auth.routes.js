const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/auth.controller");
const { requireAuth } = require("../middleware/auth.middleware");

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/signup", authLimiter, ctrl.signup);
router.post("/login", authLimiter, ctrl.login);
router.post("/logout", requireAuth, ctrl.logout);
router.post("/forgot-password", authLimiter, ctrl.forgotPassword);
router.post("/reset-password", authLimiter, ctrl.resetPassword);
router.get("/me", requireAuth, ctrl.me);

module.exports = router;
