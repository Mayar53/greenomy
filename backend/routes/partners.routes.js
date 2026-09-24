const router = require("express").Router();
const ctrl = require("../controllers/partners.controller");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

// Editing partner businesses is its own capability; reading the public list is not.
const manage = [requireAuth, requireRole("admin", "super_admin"), requirePermission("partners.manage")];

router.get("/", c.list);
router.post("/", manage, c.create);
router.patch("/:id", manage, c.update);

module.exports = router;
