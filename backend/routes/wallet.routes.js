const router = require("express").Router();
const ctrl = require("../controllers/wallet.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.use(requireAuth);
router.get("/", ctrl.getWallet);
router.get("/transactions", ctrl.getTransactions);

module.exports = router;
