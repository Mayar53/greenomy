const router = require("express").Router();
const ctrl = require("../controllers/verifications.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");
const { upload } = require("../middleware/upload.middleware");

const c = wrapController(ctrl);

router.use(requireAuth);
// A photo may arrive as multipart (preferred) or as a legacy base64 data URL in
// the JSON body — multer ignores a non-multipart request, so both work.
router.post("/", upload.single("image"), c.submit);
router.post("/challenge", c.challenge);
router.get("/history", c.history);
router.get("/:id/image", c.image);
router.get("/:id", c.getOne);

module.exports = router;
