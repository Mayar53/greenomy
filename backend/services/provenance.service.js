// services/provenance.service.js — does this look like a photo the member took,
// or something that came from the internet (a download, a stock library, a
// screenshot, a repost)?
//
// Deliberately NOT one clever trick. Every signal here is weak on its own:
//
//   * metadata is trivially stripped or edited, and most phones/social apps
//     strip it on upload — so a MISSING EXIF is neutral, never suspicious;
//   * a filename can be renamed;
//   * a plant photographed against a plain wall can look like a screenshot;
//   * "already in our database" only catches an image someone already submitted.
//
// So nothing below rejects an image by itself. Each signal is collected, they
// are combined into a score and a verdict, and the caller decides — with the
// vision model's own capture judgement as another input. Nothing here is
// claimed as proof of provenance.

// Filenames a camera or phone actually produces.
const CAMERA_FILENAME = /(^|[^a-z])(img|dsc|dscn|pxl|gopr|dcim|photo|picture|win)[-_ ]?\d/i;
// Filenames that give the game away: a screenshot, or a stock/download source.
const SCREENSHOT_FILENAME = /(screen[\s_-]?shot|screen[\s_-]?capture|screencapture)/i;
const STOCK_FILENAME = /(shutterstock|gettyimages|istock|alamy|dreamstime|depositphotos|freepik|pixabay|pexels|unsplash|adobe[\s_-]?stock|123rf|stock[\s_-]?photo)/i;
const DOWNLOAD_FILENAME = /(whatsapp|telegram|facebook|instagram|pinterest|twitter|download|saved[\s_-]?image)/i;
const GENERIC_FILENAME = /^(image|img|photo|picture|untitled|download|file)\s*\(?\d*\)?\.(jpe?g|png|webp|heic)$/i;

// Software that means the file was edited or generated, not shot.
const EDITOR_TEXT = /(photoshop|lightroom|gimp|snapseed|canva|picsart|paint\.net|affinity|pixlr|fotor|photomath|midjourney|dall[\s-]?e|stable[\s-]?diffusion|generated|ai[\s-]?generated)/i;
// Text that means a camera (or a phone) wrote the file.
const CAMERA_TEXT = /(apple|iphone|ipad|samsung|galaxy|xiaomi|redmi|huawei|honor|oppo|vivo|oneplus|realme|motorola|nokia|google|pixel|canon|nikon|sony|fujifilm|panasonic|olympus|leica|pentax|dji|gopro)/i;

// Common screen resolutions (portrait or landscape) — a phone camera does not
// produce these dimensions, a screenshot usually does.
const SCREEN_SIZES = [
  320, 360, 375, 390, 393, 412, 414, 428, 430, 480, 540, 600, 640, 720, 768, 800, 810, 820, 834, 900, 960,
  1024, 1080, 1112, 1170, 1179, 1242, 1280, 1290, 1320, 1334, 1366, 1440, 1536, 1600, 1620, 1668, 1792, 1800,
  1920, 2048, 2160, 2340, 2360, 2400, 2532, 2556, 2560, 2732, 2778, 2796, 2880, 3000, 3200, 3440, 3840,
];

// Aspect ratios screens use. Cameras use some of these too, which is exactly
// why this is only ever a supporting signal.
const SCREEN_RATIOS = [16 / 9, 9 / 16, 4 / 3, 3 / 4, 3 / 2, 2 / 3, 19.5 / 9, 9 / 19.5, 21 / 9, 9 / 21, 5 / 4, 4 / 5];

const MIN_DIMENSION = Number(process.env.PROVENANCE_MIN_DIMENSION || 240);
const BAND_FLAT = Number(process.env.PROVENANCE_BAND_FLAT || 12);

const lookedUpScreens = new Set(SCREEN_SIZES);

const aspectOf = (width, height) => (height ? width / height : 0);

function looksLikeScreenSize(width, height) {
  return lookedUpScreens.has(width) || lookedUpScreens.has(height);
}

function nearScreenRatio(width, height) {
  const ratio = aspectOf(width, height);
  if (!ratio) return false;
  return SCREEN_RATIOS.some((target) => Math.abs(ratio - target) / target < 0.02);
}

/** The extension implies a different format than the bytes actually are —
 * a renamed download. */
function extensionMismatch(name, format) {
  const extension = name.includes(".") ? name.split(".").pop() : "";
  const implied = {
    jpg: "jpeg",
    jpeg: "jpeg",
    png: "png",
    webp: "webp",
    avif: "avif",
    tif: "tiff",
    tiff: "tiff",
    heic: "heif",
    heif: "heif",
  }[extension];
  return Boolean(implied && implied !== format);
}

/**
 * Scores how likely an image is an original capture.
 *
 * `analysis` is the output of image.service.analyse(); `filename` is the
 * uploaded name when multipart supplied one (absent on the data-URL path, which
 * is treated as "no evidence", not as "suspicious").
 *
 * Returns { score, verdict, reasonCode, indicators, positive, hard, soft, checks }.
 *   verdict: 'likely_original' | 'neutral' | 'uncertain' | 'suspicious'
 */
function assess({ analysis, filename } = {}) {
  const metadata = analysis.metadata || {};
  const bands = analysis.bandStats || {};
  const { width, height } = analysis;
  const name = String(filename || "").toLowerCase();
  const text = metadata.text || "";

  const positive = [];
  const soft = [];
  const hard = [];

  // ---- evidence FOR an original capture
  if (metadata.hasExif) positive.push("has_exif");
  if (CAMERA_TEXT.test(text)) positive.push("camera_metadata");
  if (name && CAMERA_FILENAME.test(name)) positive.push("camera_filename");

  // ---- filename evidence
  if (name && STOCK_FILENAME.test(name)) hard.push("stock_filename");
  if (name && SCREENSHOT_FILENAME.test(name)) hard.push("screenshot_filename");
  if (name && DOWNLOAD_FILENAME.test(name)) soft.push("download_filename");
  if (name && GENERIC_FILENAME.test(name)) soft.push("generic_filename");

  // ---- metadata evidence
  if (EDITOR_TEXT.test(text)) soft.push("editor_software");
  if (/screen[\s-]?shot/.test(text)) soft.push("screenshot_metadata");

  // A phone camera does not produce PNG; an editor or a screenshot usually does.
  const png = analysis.format === "png";
  if (png && !metadata.hasExif) soft.push("png_no_exif");

  // ---- screen-shaped pixels
  const screenSize = looksLikeScreenSize(width, height);
  const screenRatio = nearScreenRatio(width, height);
  if (!metadata.hasExif && screenSize) soft.push("screen_dimensions");
  // The aspect ratio on its own is NOT a flag: almost every phone photo is 4:3
  // or 16:9 once its metadata has been stripped, so counting it would hold up
  // legitimate photos. It only contributes inside the screenshot signature
  // below, where several signals have to agree.

  const uiBands = Number(bands.center) > 60 && (Number(bands.top) < BAND_FLAT || Number(bands.bottom) < BAND_FLAT);
  if (uiBands) soft.push("ui_bands");

  // ---- quality / integrity hints
  const lowResolution = Math.min(width || 0, height || 0) < MIN_DIMENSION;
  if (lowResolution) soft.push("low_resolution");
  if (extensionMismatch(name, analysis.format)) soft.push("renamed_file");
  const ratio = aspectOf(width, height);
  if (ratio && (ratio > 2.5 || ratio < 0.4)) soft.push("extreme_aspect");

  // A screenshot is only *called* one when independent signals agree: PNG, no
  // camera metadata, flat UI-like bars, and screen-shaped pixels.
  if (png && !metadata.hasExif && uiBands && (screenSize || screenRatio)) {
    hard.push("screenshot_signature");
  }

  const hardFlags = [...new Set(hard)];
  const softFlags = [...new Set(soft)];
  const positiveFlags = [...new Set(positive)];

  const score = Number(
    Math.max(0, Math.min(1, 0.5 + positiveFlags.length * 0.15 - hardFlags.length * 0.35 - softFlags.length * 0.1)).toFixed(2)
  );

  let verdict = "neutral";
  let reasonCode = null;

  if (hardFlags.includes("screenshot_filename") || hardFlags.includes("screenshot_signature")) {
    verdict = "suspicious";
    reasonCode = "screenshot";
  } else if (hardFlags.includes("stock_filename")) {
    verdict = "suspicious";
    reasonCode = "likely_sourced";
  } else if (softFlags.length >= 2 || softFlags.includes("low_resolution") || softFlags.includes("ui_bands")) {
    // One weak hint is not enough to question a photo; several, or a hint that
    // matters on its own, go to a human instead of being accepted.
    verdict = "uncertain";
    reasonCode = "uncertain";
  } else if (positiveFlags.length) {
    verdict = "likely_original";
  }

  return {
    score,
    verdict,
    reasonCode,
    indicators: [...hardFlags, ...softFlags],
    positive: positiveFlags,
    hard: hardFlags,
    soft: softFlags,
    checks: {
      hasExif: Boolean(metadata.hasExif),
      cameraMetadata: CAMERA_TEXT.test(text),
      editorSoftware: EDITOR_TEXT.test(text),
      png,
      screenSize,
      screenRatio,
      uiBands,
      lowResolution,
      width: width || null,
      height: height || null,
    },
  };
}

module.exports = {
  assess,
  looksLikeScreenSize,
  nearScreenRatio,
  extensionMismatch,
  MIN_DIMENSION,
  SCREEN_SIZES,
};
