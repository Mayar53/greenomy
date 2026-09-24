// middleware/upload.middleware.js — multipart photo upload.
//
// Memory storage: the bytes are measured and hashed by services/image.service
// before anything is written, and a rejected upload never touches disk. Only
// images are accepted, and the size limit is shared with the image service so
// the two cannot disagree.
const multer = require("multer");
const { MAX_BYTES } = require("../services/image.service");

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/tiff",
  "image/heic",
  "image/heif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(String(file.mimetype || "").toLowerCase())) {
      const err = new Error("Unsupported image type — use JPEG, PNG, WebP or HEIC");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

module.exports = { upload, ALLOWED_MIME };
