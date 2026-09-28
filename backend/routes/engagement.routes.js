const router = require("express").Router();
const ctrl = require("../controllers/engagement.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.use(requireAuth);
router.get("/", c.summary);
router.post("/care", c.care);
router.post("/mystery/:grantId/claim", c.claimMystery);
router.post("/challenges/:challengeId/claim", c.claimChallenge);

module.exports = router;
