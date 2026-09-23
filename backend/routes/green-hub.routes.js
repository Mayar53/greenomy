const router = require("express").Router();
const ctrl = require("../controllers/green-hub.controller");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.get("/", c.list);
router.get("/:slug", c.getOne);

module.exports = router;
