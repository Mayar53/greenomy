const router = require("express").Router();
const ctrl = require("../controllers/notifications.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.use(requireAuth);
router.get("/", c.list);
router.get("/unread-count", c.unreadCount);
router.post("/read-all", c.markAllRead);
router.post("/register-device", c.registerDevice);
router.post("/unregister-device", c.unregisterDevice);
router.patch("/:id/read", c.markRead);

module.exports = router;
