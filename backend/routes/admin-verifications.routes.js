const router = require("express").Router();
const ctrl = require("../controllers/admin-verifications.controller");
const { requireAuth, requireRole } = require("../middleware/auth.middleware");

router.use(requireAuth, requireRole("admin", "super_admin"));
router.get("/", ctrl.queue);
router.post("/:id/approve", ctrl.approve);
router.post("/:id/reject", ctrl.reject);

module.exports = router;
