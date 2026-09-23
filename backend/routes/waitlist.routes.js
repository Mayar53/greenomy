const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/waitlist.controller");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);
const waitlistLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  skip: () => process.env.NODE_ENV === "test",
});

router.post("/", waitlistLimiter, c.join);

module.exports = router;
