const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/ai.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

// Every call costs money at the provider, so this is the tightest limiter here.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  skip: () => process.env.NODE_ENV === "test",
});

router.use(requireAuth);
router.post("/identify", aiLimiter, c.identify);
router.post("/assistant", aiLimiter, c.assistant);

module.exports = router;
