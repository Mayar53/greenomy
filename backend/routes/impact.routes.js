const router = require("express").Router();
const ctrl = require("../controllers/impact.controller");

router.get("/", ctrl.getImpact);

module.exports = router;
