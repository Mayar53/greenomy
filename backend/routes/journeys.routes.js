const router = require("express").Router();
const ctrl = require("../controllers/journeys.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.use(requireAuth);
router.get("/", c.list);
router.post("/", c.create);
router.get("/:id", c.getOne);
router.post("/:id/milestones/:milestoneId/complete", c.completeMilestone);

module.exports = router;
