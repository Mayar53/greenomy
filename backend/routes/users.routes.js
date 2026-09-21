const router = require("express").Router();
const ctrl = require("../controllers/users.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.get("/me", requireAuth, ctrl.getMe);
router.patch("/me", requireAuth, ctrl.updateMe);
router.get("/me/impact", requireAuth, ctrl.getMyImpact);

module.exports = router;
