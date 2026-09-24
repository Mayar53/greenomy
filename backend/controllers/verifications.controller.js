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
const provenanceService = require("../services/provenance.service");
const ai = require("../services/ai.service");
const { getVerificationProvider, HeuristicVerificationProvider, verifyPhoto } = require("../services/verification-provider");
const rewardEngine = require("../services/reward-engine.service");
const { notify } = require("../services/notification.service");

const AUTO_APPROVE_THRESHOLD = 0.85;
const CHALLENGE_TTL_MS = Number(process.env.CHALLENGE_TTL_MS || 30 * 60 * 1000);
const CHALLENGE_LENGTH = Math.min(Math.max(Number(process.env.CHALLENGE_LENGTH || 4), 3), 8);

// Foliage floors. A frame with essentially no green in it is not a growing
// plant; a frame that is only faintly green is not evidence either. Both are
// only consulted when no vision model is configured to judge the plant itself.
const NO_PLANT_GREEN_RATIO = Number(process.env.VERIFY_MIN_GREEN_RATIO || 0.1);
const STRONG_GREEN_RATIO = Number(process.env.VERIFY_STRONG_GREEN_RATIO || 0.25);

/**
 * The single place the outcome is decided, from signals already computed for
 * this submission. Pure — no I/O — so the policy can be tested directly.
 *
 * Order matters. A clear "no plant" or a clear provenance red flag rejects;
 * anything we cannot stand behind goes to a human; only a plant we can see WITH
 * no red flags is accepted. A plant match alone is never enough — that is the
 * entire point of the second question.
 */
function decideVerification({ analysis, signals, provenance, duplicates, milestone, challengePassed, confidence }) {
  const greenery = Number(analysis.pixelStats && analysis.pixelStats.greenRatio) || 0;
  const plantMatch = signals ? signals.plantMatch : null;

  // 1. No plant -> reject.
  if (plantMatch === false) {
    return { approvalStatus: "rejected", requiresReview: false, reasonCode: "no_plant" };
  }
  // With no model at all, pixel greenery is the only plant signal available.
  if (!signals && greenery < NO_PLANT_GREEN_RATIO) {
    return { approvalStatus: "rejected", requiresReview: false, reasonCode: "no_plant" };
  }

  // 2. Clear evidence the image came from somewhere else -> reject. The model's
  //    own "not captured / screenshot / watermark" verdicts count, as do the
  //    offline filename and screenshot signatures.
  const modelSuspicious =
    Boolean(signals) && (signals.captured === false || signals.screenshot === true || signals.watermark === true);
  if (provenance.verdict === "suspicious" || modelSuspicious) {
    return {
      approvalStatus: "rejected",
      requiresReview: false,
      reasonCode: provenance.verdict === "suspicious" ? provenance.reasonCode || "likely_sourced" : "likely_sourced",
    };
  }

  // 3. Bytes we have already stored -> reject.
  if (duplicates.status === "exact") {
    return { approvalStatus: "rejected", requiresReview: false, reasonCode: "duplicate" };
  }

  // 4. Anything uncertain goes to a human rather than being accepted.
  if (provenance.verdict === "uncertain") {
    return { approvalStatus: "pending", requiresReview: true, reasonCode: provenance.reasonCode || "uncertain" };
  }
  if (signals && (plantMatch === null || signals.captured === null)) {
    return { approvalStatus: "pending", requiresReview: true, reasonCode: "uncertain" };
  }
  if (!signals && greenery < STRONG_GREEN_RATIO) {
    return { approvalStatus: "pending", requiresReview: true, reasonCode: "low_quality" };
  }
  if (duplicates.status === "near") {
    return { approvalStatus: "pending", requiresReview: true, reasonCode: "duplicate" };
  }
  if (milestone) {
    // Reward-eligible: never auto-paid here — the code/photo needs a human
    // (or a vision model that confirmed the code) before points move.
    return {
      approvalStatus: "pending",
      requiresReview: true,
      reasonCode: challengePassed === true ? "milestone_review" : "challenge_unverified",
    };
  }

  // 5. Plant present and nothing suspicious -> the existing confidence rule.
  if (confidence >= AUTO_APPROVE_THRESHOLD) {
    return { approvalStatus: "approved", requiresReview: false, reasonCode: "ok" };
  }
  return { approvalStatus: "pending", requiresReview: true, reasonCode: "low_quality" };
}

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

  // 6. Originality / provenance. The offline signals are always available; the
  //    model's capture verdict (when there is a model) is merged in by the
  //    decision below.
  const provenance = provenanceService.assess({
    analysis,
    filename: req.file && req.file.originalname ? req.file.originalname : null,
  });

  const plantMatch = signals ? signals.plantMatch : null;
  const challengePassed = signals ? signals.challengePassed : null;
  const confidence =
    signals && typeof signals.confidence === "number"
      ? Math.max(scored.confidence, signals.confidence)
      : scored.confidence;

  const decision = decideVerification({
    analysis,
    signals,
    provenance,
    duplicates,
    milestone,
    challengePassed,
    confidence,
  });
  const approvalStatus = decision.approvalStatus;
  const requiresReview = decision.requiresReview;

  const duplicate = duplicates.status !== "none";
  const crossUser = duplicates.matches.some((match) => match.user_id !== req.user.id);
  const priorPhotos = await verificationModel.countForPlant(req.user.id, plantId);
  const journeyConsistency = duplicate ? "unknown" : priorPhotos > 0 ? "plausible" : "first";
  const suspicious =
    duplicate ||
    provenance.verdict === "suspicious" ||
    Boolean(signals && (signals.captured === false || signals.screenshot === true || signals.watermark === true));

  // The full internal result. Kept on the record so an admin can see WHY a photo
  // was accepted, rejected or held — never just a bare score.
  const verificationResult = {
    decision: approvalStatus,
    reasonCode: decision.reasonCode,
    // Question 1 — is there a plant?
    plantMatch,
    plantConfidence: signals && signals.confidence != null ? signals.confidence : confidence,
    // Question 2 — does it look like the member's own photo?
    captured: signals ? signals.captured : null,
    screenshot: signals ? signals.screenshot : null,
    watermark: signals ? signals.watermark : null,
    provenance: {
      score: provenance.score,
      verdict: provenance.verdict,
      indicators: provenance.indicators,
      positive: provenance.positive,
      checks: provenance.checks,
    },
    // Supporting signals
    challengePassed,
    duplicate: duplicates.status,
    crossUser,
    journeyConsistency,
    suspicious,
    requiresReview,
    confidence,
    reason: signals ? signals.reason : (scored.metrics && scored.metrics.reason) || null,
    // Counts only: another member's verification id is not this member's business.
    duplicateMatches: { count: duplicates.matches.length, crossUser },
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
      // A rejected milestone photo reopens the milestone so the member can try
      // again; anything else waits for the review decision.
      await journeyModel.setMilestoneVerification(client, milestone.milestone_id, {
        verificationId: record.verification_id,
        verificationStatus: approvalStatus === "rejected" ? "rejected" : "pending",
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

  const notificationType =
    approvalStatus === "approved"
      ? "verification_approved"
      : approvalStatus === "rejected"
        ? "verification_rejected"
        : "verification_pending";

  await notify({ userId: req.user.id, type: notificationType });

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
exports._decide = decideVerification;
