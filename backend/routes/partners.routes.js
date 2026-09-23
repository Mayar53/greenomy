const router = require("express").Router();
const ctrl = require("../controllers/partners.controller");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.get("/", c.list);
router.post("/", requireAuth, requireRole("admin", "super_admin"), c.create);
router.patch("/:id", requireAuth, requireRole("admin", "super_admin"), c.update);

module.exports = router;
