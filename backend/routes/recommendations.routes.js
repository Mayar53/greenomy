// routes/recommendations.routes.js — the "what should I plant?" surface.
// Mounted at /api rather than a single resource path because it exposes two
// related reads: the ranked recommendations and the catalog behind them.
const router = require("express").Router();
const ctrl = require("../controllers/recommendations.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.get("/recommendations", requireAuth, c.list);
router.get("/catalog", c.catalog);
// /catalog/search must be matched before /catalog/:slug, or it would be read as
// a slug named "search".
router.get("/catalog/search", c.search);
router.get("/catalog/:slug", c.detail);

module.exports = router;
