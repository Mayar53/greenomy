const router = require("express").Router();
const ctrl = require("../controllers/admin-verifications.controller");
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.use(requireAuth, requireRole("admin", "super_admin"), requirePermission("verifications.review"));
router.get("/", c.queue);
router.post("/:id/approve", c.approve);
router.post("/:id/reject", c.reject);

module.exports = router;
