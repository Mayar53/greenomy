// routes/admin.routes.js — the admin dashboard's resources.
//
// Two gates, not one: `requireRole` decides whether you are staff at all, and
// `requirePermission` is the finer check for the part of the dashboard each route
// belongs to. A `super_admin` passes both (it holds every permission). Mounted at
// /api/admin, alongside the existing /api/admin/verifications queue.
const router = require("express").Router();
const { requireAuth, requireRole, requirePermission } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const users = wrapController(require("../controllers/admin-users.controller"));
const admins = wrapController(require("../controllers/admin-admins.controller"));
const rewards = wrapController(require("../controllers/admin-rewards.controller"));
const content = wrapController(require("../controllers/admin-content.controller"));
const analytics = wrapController(require("../controllers/admin-analytics.controller"));
const partners = wrapController(require("../controllers/partners.controller"));

router.use(requireAuth, requireRole("admin", "super_admin"));

// Who may see this catalogue: any staff member, so the dashboard can hide what it
// cannot use. It is the permission keys, not anyone's data.
router.get("/permissions", admins.catalogue);

router.get("/admins", requirePermission("admins.manage"), admins.list);
router.post("/admins", requirePermission("admins.manage"), admins.create);
router.patch("/admins/:id", requirePermission("admins.manage"), admins.update);
router.delete("/admins/:id", requirePermission("admins.manage"), admins.remove);

router.get("/users", requirePermission("users.manage"), users.list);
router.patch("/users/:id", requirePermission("users.manage"), users.update);

router.get("/partners", requirePermission("partners.manage"), partners.listAll);
router.post("/partners", requirePermission("partners.manage"), partners.create);
router.patch("/partners/:id", requirePermission("partners.manage"), partners.update);

router.get("/rewards", requirePermission("rewards.manage"), rewards.list);
router.post("/rewards", requirePermission("rewards.manage"), rewards.create);
router.patch("/rewards/:id", requirePermission("rewards.manage"), rewards.update);

router.get("/content", requirePermission("content.manage"), content.list);
router.post("/content", requirePermission("content.manage"), content.create);
router.patch("/content/:id", requirePermission("content.manage"), content.update);
router.delete("/content/:id", requirePermission("content.manage"), content.remove);

router.get("/analytics", requirePermission("analytics.view"), analytics.summary);

module.exports = router;
