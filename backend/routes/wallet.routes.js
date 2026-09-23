const router = require("express").Router();
const ctrl = require("../controllers/wallet.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");

const c = wrapController(ctrl);

router.use(requireAuth);
router.get("/", c.getWallet);
router.get("/transactions", c.getTransactions);

module.exports = router;
