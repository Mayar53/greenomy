const router = require("express").Router();
const ctrl = require("../controllers/partners.controller");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");

router.get("/", ctrl.list);
router.post("/", requireAuth, requireRole("admin", "super_admin"), ctrl.create);
router.patch("/:id", requireAuth, requireRole("admin", "super_admin"), ctrl.update);

module.exports = router;
