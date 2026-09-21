const router = require("express").Router();
const ctrl = require("../controllers/verifications.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.use(requireAuth);
router.post("/", ctrl.submit);
router.get("/history", ctrl.history);
router.get("/:id", ctrl.getOne);

module.exports = router;
