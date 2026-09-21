const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const ctrl = require("../controllers/waitlist.controller");

const waitlistLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

router.post("/", waitlistLimiter, ctrl.join);

module.exports = router;
