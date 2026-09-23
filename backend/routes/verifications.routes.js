const router = require("express").Router();
const ctrl = require("../controllers/verifications.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.use(requireAuth);
router.post("/", c.submit);
router.get("/history", c.history);
router.get("/:id", c.getOne);

module.exports = router;
