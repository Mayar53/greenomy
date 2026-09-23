const router = require("express").Router();
const ctrl = require("../controllers/impact.controller");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.get("/", c.getImpact);

module.exports = router;
