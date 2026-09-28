const router = require("express").Router();
const ctrl = require("../controllers/verifications.controller");
const { requireAuth } = require("../middleware/auth.middleware");
const { wrapController } = require("../middleware/async-handler");
const { upload } = require("../middleware/upload.middleware");
const rateLimit = require("express-rate-limit");

// Test runs submit many photos on purpose, so the limiter is skipped there.
const skipInTests = process.env.NODE_ENV === "test";
// A person photographs a plant a few times a day. A script would want hundreds.
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.VERIFY_SUBMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => skipInTests,
});
const challengeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.VERIFY_CHALLENGE_MAX || 40),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => skipInTests,
});

const c = wrapController(ctrl);

router.use(requireAuth);
// A photo may arrive as multipart (preferred) or as a legacy base64 data URL in
// the JSON body — multer ignores a non-multipart request, so both work.
router.post("/", submitLimiter, upload.single("image"), c.submit);
router.post("/challenge", challengeLimiter, c.challenge);
router.get("/history", c.history);
router.get("/:id/image", c.image);
router.get("/:id", c.getOne);

module.exports = router;
