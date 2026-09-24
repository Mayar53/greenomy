const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/ai.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

// Every call costs money at the provider, so this is the tightest limiter here.
// Two windows: a rolling 15-minute cap on total spend, and a per-minute cap so
// a runaway client cannot burn the whole budget in a burst. Neither is a
// "number of questions" limit — a conversation may continue freely within them.
const skipInTests = () => process.env.NODE_ENV === "test";

const aiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, skip: skipInTests });
const aiBurstLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Math.max(1, Number(process.env.AI_RATE_LIMIT_PER_MIN || 12)),
  skip: skipInTests,
});

router.use(requireAuth);
router.post("/identify", aiLimiter, aiBurstLimiter, c.identify);
router.post("/assistant", aiLimiter, aiBurstLimiter, c.assistant);

module.exports = router;
