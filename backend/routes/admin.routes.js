// routes/admin.routes.js — the admin dashboard's resources, all admin-gated.
// Mounted at /api/admin, alongside the existing /api/admin/verifications queue.
const router = require("express").Router();
const { requireAuth, requireRole } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const users = wrapController(require("../controllers/admin-users.controller"));
const rewards = wrapController(require("../controllers/admin-rewards.controller"));
const content = wrapController(require("../controllers/admin-content.controller"));
const analytics = wrapController(require("../controllers/admin-analytics.controller"));
const partners = wrapController(require("../controllers/partners.controller"));

// One guard for the whole dashboard.
router.use(requireAuth, requireRole("admin", "super_admin"));

router.get("/users", users.list);
router.patch("/users/:id", users.update);

router.get("/partners", partners.listAll);
router.post("/partners", partners.create);
router.patch("/partners/:id", partners.update);

router.get("/rewards", rewards.list);
router.post("/rewards", rewards.create);
router.patch("/rewards/:id", rewards.update);

router.get("/content", content.list);
router.post("/content", content.create);
router.patch("/content/:id", content.update);
router.delete("/content/:id", content.remove);

router.get("/analytics", analytics.summary);

module.exports = router;
