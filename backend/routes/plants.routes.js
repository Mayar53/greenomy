const router = require("express").Router();
const ctrl = require("../controllers/plants.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.use(requireAuth);
router.get("/", c.list);
router.post("/", c.create);
router.get("/:id", c.getOne);
router.patch("/:id", c.update);
router.delete("/:id", c.remove);

module.exports = router;
