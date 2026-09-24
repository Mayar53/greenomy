// services/image.service.js — the single place an uploaded photo is measured.
//
// Everything here is computed SERVER-SIDE from the actual bytes. The browser's
// canvas measurements are no longer trusted for scoring: they are easy to fake,
// and a perceptual hash taken from them would be worthless for duplicate
// detection.
//
//   sha256    exact-identity hash (cross-user duplicate detection)
//   aHash     average hash
//   dHash     difference hash
//   pHash     DCT hash — survives resizing, recompression and mild brightness
//             changes, which a plain sha256 does not
//   stats     green ratio / brightness / sharpness, re-derived here
//
// Images are stored content-addressed (sha256 + extension) under
// IMAGE_STORAGE_DIR, so identical bytes never produce a second file and the
// filename cannot be used for path traversal.
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const STORAGE_DIR = process.env.IMAGE_STORAGE_DIR
  ? path.resolve(process.env.IMAGE_STORAGE_DIR)
  : path.join(__dirname, "..", "uploads");

const MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES || 8 * 1024 * 1024);
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "tiff", "heif", "heic"]);
const EXTENSION = { jpeg: "jpg", png: "png", webp: "webp", avif: "avif", tiff: "tiff", heif: "heif", heic: "heic" };

/** An error the client caused, so the controller can answer 400 rather than 500. */
function badImage(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

const sha256Of = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/** 64 bits packed into 16 hex characters, so a hash is a compact text column. */
function bitsToHex(bits) {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4).join(""), 2).toString(16);
  }
  return hex;
}

/** A square greyscale bitmap, the input every perceptual hash works from. */
async function greyscaleRaw(buffer, width, height) {
  return sharp(buffer)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
}

function averageHash(raw) {
  let sum = 0;
  for (const value of raw) sum += value;
  const mean = sum / raw.length;
  const bits = [];
  for (const value of raw) bits.push(value >= mean ? 1 : 0);
  return bitsToHex(bits);
}

function differenceHash(raw, width = 9, height = 8) {
  const bits = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      bits.push(raw[y * width + x] < raw[y * width + x + 1] ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

/** The top-left 8×8 of the 2-D DCT — the low frequencies that describe the
 * image's structure rather than its exact pixels. */
function perceptualHash(raw, size = 32) {
  const cosines = Array.from({ length: 8 }, (_, u) =>
    Array.from({ length: size }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size)))
  );

  const coefficients = [];
  for (let u = 0; u < 8; u += 1) {
    for (let v = 0; v < 8; v += 1) {
      let sum = 0;
      for (let x = 0; x < size; x += 1) {
        for (let y = 0; y < size; y += 1) {
          sum += raw[x * size + y] * cosines[u][x] * cosines[v][y];
        }
      }
      const cu = u === 0 ? 1 / Math.SQRT2 : 1;
      const cv = v === 0 ? 1 / Math.SQRT2 : 1;
      coefficients.push(0.25 * cu * cv * sum);
    }
  }

  const ac = coefficients.slice(1);
  const sorted = [...ac].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const bits = coefficients.map((value, index) => (index === 0 ? 0 : value > median ? 1 : 0));
  return bitsToHex(bits);
}

/** Luminance variance of one horizontal band — the building block of the
 * screenshot check. Low variance means a flat, uniform strip. */
function varianceOfBand(luminance, width, height, fromRow, toRow) {
  const first = Math.max(0, Math.min(height - 1, fromRow));
  const last = Math.max(first + 1, Math.min(height, toRow));
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let y = first; y < last; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = luminance[y * width + x];
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }

  if (!count) return 0;
  const mean = sum / count;
  return Number(Math.max(0, sumSquares / count - mean * mean).toFixed(2));
}

/**
 * Everything that can be measured from one decode of the pixels:
 *
 *   stats  green ratio / brightness / sharpness — the integrity score
 *   bands  luminance variance of the top, middle and bottom strips. A screen
 *          shot usually carries near-uniform UI bars there, but a real photo of
 *          a plant against a plain wall can look similar — so this is one weak
 *          signal among several and never a rejection on its own.
 */
async function measurePixels(buffer) {
  const { data, info } = await sharp(buffer)
    .resize(160, 160, { fit: "inside" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const luminance = new Float32Array(width * height);
  let green = 0;
  let luminanceSum = 0;

  for (let i = 0, p = 0; i < data.length; i += channels, p += 1) {
    const r = data[i];
    const g = channels > 1 ? data[i + 1] : r;
    const b = channels > 1 ? data[i + 2] : r;
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminance[p] = value;
    luminanceSum += value;
    if (g > 40 && g > r * 1.08 && g > b * 1.05) green += 1;
  }

  let gradient = 0;
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const i = y * width + x;
      gradient += Math.abs(luminance[i] - luminance[i - 1]) + Math.abs(luminance[i] - luminance[i - width]);
    }
  }

  const total = width * height;
  const edges = (width - 1) * (height - 1);
  const strip = Math.max(1, Math.round(height * 0.12));

  return {
    stats: {
      greenRatio: Number((green / total).toFixed(4)),
      brightness: Number((luminanceSum / total / 255).toFixed(4)),
      sharpness: Number((gradient / edges).toFixed(2)),
    },
    bands: {
      top: varianceOfBand(luminance, width, height, 0, strip),
      bottom: varianceOfBand(luminance, width, height, height - strip, height),
      center: varianceOfBand(luminance, width, height, Math.round(height * 0.25), Math.round(height * 0.75)),
    },
  };
}

// Human-readable runs inside EXIF/XMP/IPTC buffers (camera make, editor
// software, "screenshot"). Read with a plain scan rather than a metadata
// parser: the values are ASCII, and a substring is all the signal we need.
// Never treated as proof — metadata is trivially edited or stripped.
const PRINTABLE_RUN = /[\x20-\x7e]{4,}/g;
const METADATA_SCAN_LIMIT = 262144;

function textFromMetadata(buffer) {
  if (!buffer || !buffer.length) return "";
  const slice = buffer.length > METADATA_SCAN_LIMIT ? buffer.subarray(0, METADATA_SCAN_LIMIT) : buffer;
  const runs = slice.toString("latin1").match(PRINTABLE_RUN);
  return runs ? runs.join(" ").toLowerCase() : "";
}

/** The metadata facts the provenance layer uses — not the raw blobs. */
function metadataSummary(metadata) {
  return {
    format: metadata.format,
    width: metadata.width || null,
    height: metadata.height || null,
    hasExif: Boolean(metadata.exif && metadata.exif.length),
    hasXmp: Boolean(metadata.xmp && metadata.xmp.length),
    hasIptc: Boolean(metadata.iptc && metadata.iptc.length),
    hasIcc: Boolean(metadata.icc && metadata.icc.length),
    text: [
      textFromMetadata(metadata.exif),
      textFromMetadata(metadata.xmp),
      textFromMetadata(metadata.iptc),
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Measures an image: identity hash, perceptual hashes, dimensions, pixel stats,
 * metadata summary and band variances. Throws a 400 for anything that is not a
 * usable image, so a malformed or corrupt upload never becomes a 500.
 */
async function analyse(buffer) {
  if (!buffer || !buffer.length) throw badImage("The image is empty");
  if (buffer.length > MAX_BYTES) throw badImage("The image is larger than the allowed size");

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw badImage("That file is not a readable image");
  }
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw badImage("Unsupported image format — use JPEG, PNG, WebP or HEIC");
  }
  // A file that decodes but carries no usable dimensions is corrupt.
  if (!metadata.width || !metadata.height || metadata.width * metadata.height < 64) {
    throw badImage("That image is too small or corrupt to verify");
  }

  const [grey8, grey9x8, grey32, measured] = await Promise.all([
    greyscaleRaw(buffer, 8, 8),
    greyscaleRaw(buffer, 9, 8),
    greyscaleRaw(buffer, 32, 32),
    measurePixels(buffer),
  ]);

  return {
    sha256: sha256Of(buffer),
    ahash: averageHash(grey8),
    dhash: differenceHash(grey9x8),
    phash: perceptualHash(grey32),
    width: metadata.width,
    height: metadata.height,
    bytes: buffer.length,
    mime: `image/${metadata.format === "jpg" ? "jpeg" : metadata.format}`,
    format: metadata.format,
    pixelStats: measured.stats,
    bandStats: measured.bands,
    metadata: metadataSummary(metadata),
  };
}

/** A small JPEG data URL for the stored `image_url`.
 *
 * The ORIGINAL bytes go to disk; only this bounded preview lives in the row, so
 * the database stops growing with full-size photos while the member's history
 * still renders without a second request. */
async function preview(buffer, maxEdge = 640) {
  const output = await sharp(buffer)
    .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  return `data:image/jpeg;base64,${output.toString("base64")}`;
}

/** Writes the bytes under their content-addressed name. Returns the filename. */
async function store(buffer, sha256, format) {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const filename = `${sha256}.${EXTENSION[format] || "bin"}`;
  await fs.writeFile(path.join(STORAGE_DIR, filename), buffer);
  return filename;
}

/** Reads a stored image. Only a bare basename is ever accepted, so a stored
 * value can never escape STORAGE_DIR. */
async function read(storagePath) {
  const filename = path.basename(String(storagePath || ""));
  if (!filename || filename === "." || filename === "..") throw badImage("No image to read");
  const full = path.join(STORAGE_DIR, filename);
  if (!full.startsWith(STORAGE_DIR)) throw badImage("No image to read");
  return fs.readFile(full);
}

/** Decodes a `data:image/...;base64,...` URL into bytes (legacy client path). */
function decodeDataUrl(dataUrl) {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  try {
    return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

/** Bits differing between two hex hashes. Infinity when they are not comparable. */
function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let value = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

module.exports = {
  analyse,
  preview,
  store,
  read,
  decodeDataUrl,
  hammingDistance,
  sha256Of,
  STORAGE_DIR,
  MAX_BYTES,
  ALLOWED_FORMATS,
};
