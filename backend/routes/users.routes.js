const router = require("express").Router();
const ctrl = require("../controllers/users.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.get("/me", requireAuth, c.getMe);
router.patch("/me", requireAuth, c.updateMe);
router.get("/me/impact", requireAuth, c.getMyImpact);

module.exports = router;
