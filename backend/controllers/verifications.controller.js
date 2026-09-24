// controllers/verifications.controller.js — photo verification.
//
// The decision is made from MULTIPLE signals, never from one model's opinion:
//
//   challenge  a per-attempt code the member must show (required for a
//              reward-eligible milestone photo)
//   integrity  sha256 + perceptual hashes and pixel stats, computed server-side
//   duplicate  exact (sha256) and near (perceptual) matches across ALL users
//   identity   the expected plant, when a vision model is configured
//   history    whether this member has photographed this plant before
//
// Everything except the vision checks works with no AI key at all. Without a
// key a milestone photo cannot be confirmed, so it QUEUES FOR REVIEW rather than
// being auto-approved — the model is never the sole source of authenticity, and
// nothing is ever declared fraudulent automatically.
const crypto = require("crypto");
const { withTransaction } = require("../config/db");
const verificationModel = require("../models/verification.model");
const plantModel = require("../models/plant.model");
const challengeModel = require("../models/verification-challenge.model");
const imageModel = require("../models/verification-image.model");
const journeyModel = require("../models/journey.model");
const imageService = require("../services/image.service");
const duplicateService = require("../services/duplicate.service");
const ai = require("../services/ai.service");
const { getVerificationProvider, HeuristicVerificationProvider, verifyPhoto } = require("../services/verification-provider");
const rewardEngine = require("../services/reward-engine.service");
const { notify } = require("../services/notification.service");

const AUTO_APPROVE_THRESHOLD = 0.85;
const CHALLENGE_TTL_MS = Number(process.env.CHALLENGE_TTL_MS || 30 * 60 * 1000);
const CHALLENGE_LENGTH = Math.min(Math.max(Number(process.env.CHALLENGE_LENGTH || 4), 3), 8);

/** A fresh, unpredictable code — never a static one, hence crypto.randomInt. */
function generateChallengeCode() {
  let code = "";
  for (let i = 0; i < CHALLENGE_LENGTH; i += 1) code += crypto.randomInt(0, 10);
  return code;
}

const CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
};

/** POST /api/verifications/challenge — issue a code to show in the photo. */
exports.challenge = async (req, res) => {
  const { plantId } = req.body || {};
  if (plantId) {
    const plant = await plantModel.findByIdForUser(plantId, req.user.id);
    if (!plant) return res.status(404).json({ error: "Plant not found" });
  }

  const challenge = await challengeModel.issue({
    userId: req.user.id,
    plantId: plantId || null,
    code: generateChallengeCode(),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });

  res.status(201).json({
    challengeId: challenge.challenge_id,
    code: challenge.code,
    expiresAt: challenge.expires_at,
  });
};

/** The bytes to verify: a multipart upload, or a legacy base64 data URL. */
function readImageBytes(req) {
  if (req.file && req.file.buffer && req.file.buffer.length) {
    return { buffer: req.file.buffer, mime: req.file.mimetype };
  }
  const body = req.body || {};
  if (body.imageUrl) {
    const decoded = imageService.decodeDataUrl(body.imageUrl);
    if (decoded) return decoded;
    const err = new Error("imageUrl must be a base64 image data URL");
    err.status = 400;
    throw err;
  }
  const err = new Error("An image is required — upload a file or send a base64 imageUrl");
  err.status = 400;
  throw err;
}

exports.submit = async (req, res) => {
  const body = req.body || {};
  const { plantId, gpsLat, gpsLong, challengeId, milestoneId } = body;
  if (!plantId) return res.status(400).json({ error: "plantId is required" });

  const plant = await plantModel.findByIdForUser(plantId, req.user.id);
  if (!plant) return res.status(404).json({ error: "Plant not found" });

  // 1. Measure and store the real bytes. analyse() throws a 400 for anything
  //    that is not a usable image, so a malformed upload never becomes a 500.
  const { buffer, mime } = readImageBytes(req);
  const analysis = await imageService.analyse(buffer);
  const storagePath = await imageService.store(buffer, analysis.sha256, analysis.format);
  const previewUrl = await imageService.preview(buffer);
  const imageUrlForModels = `data:${mime};base64,${buffer.toString("base64")}`;

  // 2. A milestone photo is reward-eligible, so it needs a challenge.
  let milestone = null;
  if (milestoneId) {
    milestone = await journeyModel.milestoneForUser(milestoneId, req.user.id);
    if (!milestone) return res.status(404).json({ error: "Milestone not found" });
  }

  let challenge = null;
  if (challengeId) {
    challenge = await challengeModel.findById(challengeId);
    if (!challenge || challenge.user_id !== req.user.id) {
      return res.status(400).json({ error: "Verification code not found" });
    }
    if (challenge.used_at) {
      return res.status(409).json({ error: "That verification code has already been used" });
    }
    if (new Date(challenge.expires_at) < new Date()) {
      return res.status(410).json({ error: "That verification code has expired" });
    }
  } else if (milestone) {
    return res.status(400).json({ error: "A verification code is required for a milestone photo" });
  }

  // 3. Duplicates across the whole image table — not just this member's history.
  const duplicates = await duplicateService.findDuplicates(analysis);

  // 4. Base integrity score. A provider outage must never block a submission.
  let scored;
  try {
    scored = await getVerificationProvider().score({ imageUrl: imageUrlForModels, pixelStats: analysis.pixelStats });
  } catch (err) {
    console.warn(`Verification provider failed (${err.message}) — using the heuristic scorer.`);
    scored = await new HeuristicVerificationProvider().score({ pixelStats: analysis.pixelStats });
  }

  // 5. Optional vision signals. Absent, not failed — the local signals stand.
  let signals = null;
  if (ai.isConfigured()) {
    try {
      signals = await verifyPhoto({
        imageUrl: imageUrlForModels,
        plantName: plant.plant_type,
        challengeCode: challenge ? challenge.code : null,
      });
    } catch (err) {
      console.warn(`Vision verification unavailable (${err.message}) — continuing with local signals.`);
    }
  }

  const plantMatch = signals ? signals.plantMatch : null;
  const challengePassed = signals ? signals.challengePassed : null;
  const confidence =
    signals && typeof signals.confidence === "number"
      ? Math.max(scored.confidence, signals.confidence)
      : scored.confidence;

  const duplicate = duplicates.status !== "none";
  const crossUser = duplicates.matches.some((match) => match.user_id !== req.user.id);
  const priorPhotos = await verificationModel.countForPlant(req.user.id, plantId);
  const journeyConsistency = duplicate ? "unknown" : priorPhotos > 0 ? "plausible" : "first";

  // 6. Decide. A duplicate, or an unconfirmed milestone, always goes to a human.
  //    A plain garden photo keeps the existing confidence rule.
  let approvalStatus;
  if (duplicate || milestone) approvalStatus = "pending";
  else approvalStatus = confidence >= AUTO_APPROVE_THRESHOLD ? "approved" : "pending";

  const requiresReview = duplicate || (Boolean(milestone) && challengePassed !== true);

  const verificationResult = {
    plantMatch,
    challengePassed,
    duplicate: duplicates.status,
    crossUser,
    journeyConsistency,
    suspicious: duplicate,
    requiresReview,
    confidence,
    reason: signals ? signals.reason : (scored.metrics && scored.metrics.reason) || null,
    duplicateMatches: duplicates.matches.map((match) => ({
      verification_id: match.verification_id,
      distance: match.distance,
    })),
  };

  // 7. One transaction: consume the challenge, record the image, record the
  //    verification, and (only for a plain approved photo) award points.
  const verification = await withTransaction(async (client) => {
    if (challenge) {
      const consumed = await challengeModel.consume(client, challenge.challenge_id, req.user.id);
      if (!consumed) {
        const err = new Error("That verification code is no longer usable");
        err.status = 409;
        throw err;
      }
    }

    const image = await imageModel.create(client, {
      userId: req.user.id,
      sha256: analysis.sha256,
      phash: analysis.phash,
      dhash: analysis.dhash,
      ahash: analysis.ahash,
      width: analysis.width,
      height: analysis.height,
      bytes: analysis.bytes,
      mime: analysis.mime,
      storagePath,
    });

    const record = await verificationModel.create(client, {
      plantId,
      userId: req.user.id,
      imageUrl: previewUrl,
      gpsLat,
      gpsLong,
      confidence,
      provider: scored.provider,
      metrics: scored.metrics,
      approvalStatus,
      imageSha256: analysis.sha256,
      storagePath,
      challengeId: challenge ? challenge.challenge_id : null,
      milestoneId: milestone ? milestone.milestone_id : null,
      duplicateStatus: duplicate ? duplicates.status : "none",
      requiresReview,
      verificationResult,
    });

    await imageModel.linkVerification(client, image.image_id, record.verification_id);

    if (milestone) {
      await journeyModel.setMilestoneVerification(client, milestone.milestone_id, {
        verificationId: record.verification_id,
        verificationStatus: "pending",
      });
    }

    // Points are decided by the reward engine, never here — and only for an
    // approved result. A milestone photo is always pending at this point, so it
    // is paid when an admin approves it.
    if (approvalStatus === "approved") {
      await rewardEngine.onVerificationApproved(client, record);
    }
    return record;
  });

  await notify({
    userId: req.user.id,
    type: approvalStatus === "approved" ? "verification_approved" : "verification_pending",
  });

  res.status(201).json(verification);
};

exports.getOne = async (req, res) => {
  const verification = await verificationModel.findByIdForUser(req.params.id, req.user.id);
  if (!verification) return res.status(404).json({ error: "Verification not found" });
  res.json(verification);
};

exports.history = async (req, res) => {
  res.json(await verificationModel.listByUser(req.user.id));
};

/** GET /api/verifications/:id/image — the ORIGINAL photo, owner only. Serving it
 * behind auth keeps GPS-tagged originals out of any public directory. */
exports.image = async (req, res) => {
  const verification = await verificationModel.findByIdForUser(req.params.id, req.user.id);
  if (!verification) return res.status(404).json({ error: "Verification not found" });

  if (verification.storage_path) {
    try {
      const buffer = await imageService.read(verification.storage_path);
      const extension = String(verification.storage_path).split(".").pop().toLowerCase();
      res.setHeader("Content-Type", CONTENT_TYPES[extension] || "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.send(buffer);
    } catch (err) {
      console.warn(`Stored image unavailable for ${verification.verification_id}: ${err.message}`);
    }
  }

  // Legacy rows (and a vanished file) still have the bounded preview inline.
  const decoded = imageService.decodeDataUrl(verification.image_url);
  if (!decoded) return res.status(404).json({ error: "No image stored" });
  res.setHeader("Content-Type", decoded.mime);
  res.send(decoded.buffer);
};

// Exported for tests.
exports._generateChallengeCode = generateChallengeCode;
