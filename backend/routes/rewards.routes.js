const router = require("express").Router();
const ctrl = require("../controllers/rewards.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.get("/", ctrl.list);
router.get("/:id", ctrl.getOne);
router.post("/:id/redeem", requireAuth, ctrl.redeem);

module.exports = router;
