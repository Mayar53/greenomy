const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/rewards.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

// Consuming codes is the one endpoint worth throttling on its own: a partner
// terminal scans repeatedly, but a script shouldn't get unlimited guesses.
const validateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  skip: () => process.env.NODE_ENV === "test",
});

router.get("/", c.list);
router.post("/validate", requireAuth, validateLimiter, c.validateRedemption);
router.get("/:id", c.getOne);
router.post("/:id/redeem", requireAuth, c.redeem);

module.exports = router;
