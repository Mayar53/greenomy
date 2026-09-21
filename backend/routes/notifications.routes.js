const router = require("express").Router();
const ctrl = require("../controllers/notifications.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.use(requireAuth);
router.get("/", ctrl.list);
router.patch("/:id/read", ctrl.markRead);

module.exports = router;
