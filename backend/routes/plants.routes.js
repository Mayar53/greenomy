const router = require("express").Router();
const ctrl = require("../controllers/plants.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.use(requireAuth);
router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.get("/:id", ctrl.getOne);
router.patch("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

module.exports = router;
