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
const plantName = require("../services/plant-name.service");
const challengeModel = require("../models/verification-challenge.model");
const imageModel = require("../models/verification-image.model");
const journeyModel = require("../models/journey.model");
const imageService = require("../services/image.service");
const duplicateService = require("../services/duplicate.service");
const continuityService = require("../services/continuity.service");
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
// One of these is asked for at random on each attempt, so a photo taken before
// the challenge was issued cannot satisfy it. Kept simple and doable in seconds.
const CHALLENGE_INSTRUCTIONS = [
  "Hold the plant so the whole pot or container is in the frame.",
  "Photograph it from the side, with the base of the stem visible.",
  "Take it from just above, looking down at the top of the plant.",
  "Put your hand next to the pot so the scale is visible.",
  "Step back a little so the plant and its surroundings are both visible.",
  "Take it from the other side of the plant than your last photo.",
];
function pickInstruction() {
  return CHALLENGE_INSTRUCTIONS[crypto.randomInt(0, CHALLENGE_INSTRUCTIONS.length)];
}

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
function decideVerification({
  analysis,
  signals,
  provenance,
  duplicates,
  continuity,
  milestone,
  challengePassed,
  confidence,
}) {
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

  // 2a. A fake plant, or a stage the photo plainly does not show -> reject.
  //     A mature fruiting plant cannot evidence "seed planted", and a plastic
  //     plant is not a plant at all. Rejecting is the honest answer here: the
  //     image cannot support the claim, so it earns nothing.
  if (signals && signals.artificialPlant === true) {
    return { approvalStatus: "rejected", requiresReview: false, reasonCode: "not_a_real_plant" };
  }
  if (signals && signals.stageMatch === false) {
    return { approvalStatus: "rejected", requiresReview: false, reasonCode: "stage_mismatch" };
  }
  // A reward-eligible photo is proof of NOW only if the per-attempt code is in
  // it. The code is issued for this attempt and shown by the member, so an
  // older or borrowed photo cannot contain it.
  if (milestone && signals && signals.challengePassed === false) {
    return { approvalStatus: "rejected", requiresReview: false, reasonCode: "challenge_failed" };
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
  // 4b. The frame shares nothing with this plant's earlier stages. Growth looks
  //     different at every stage, so this is only raised when the images are
  //     essentially unrelated — and it asks for a human, never rejects.
  if (continuity && continuity.status === "inconsistent") {
    return { approvalStatus: "pending", requiresReview: true, reasonCode: "continuity_uncertain" };
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

  const instruction = pickInstruction();
  const challenge = await challengeModel.issue({
    userId: req.user.id,
    plantId: plantId || null,
    code: generateChallengeCode(),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    instruction,
  });

  res.status(201).json({
    challengeId: challenge.challenge_id,
    code: challenge.code,
    instruction: challenge.instruction,
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

  // A reward-eligible photo has to follow the journey: every earlier stage must
  // already be done, so a mature plant cannot be claimed with no evidence of the
  // growth before it. Server-side, so no client can skip it.
  if (milestone) {
    const stages = await journeyModel.listMilestones(milestone.journey_id);
    const outstanding = stages.filter(
      (stage) => Number(stage.sort_order) < Number(milestone.sort_order) && !stage.completed_at
    );
    if (outstanding.length) {
      return res.status(409).json({
        error: "Complete the earlier stages first — a journey is verified in order.",
        nextStage: outstanding[0].stage_key,
        outstandingStages: outstanding.map((stage) => stage.stage_key),
      });
    }
  }

  // 3. Duplicates across the whole image table — not just this member's history.
  const duplicates = await duplicateService.findDuplicates(analysis);

  // 3b. Continuity against this member's own earlier photos of THIS plant.
  const continuity = await continuityService.assess({ userId: req.user.id, plantId, analysis });

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
        // Why the photo was taken matters: the same picture can be right for one
        // stage and wrong for another.
        stage: milestone ? { key: milestone.stage_key, label: milestone.label_en } : null,
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
    continuity,
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
    continuity.status === "inconsistent" ||
    Boolean(signals && (signals.artificialPlant === true || signals.stageMatch === false)) ||
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
    artificialPlant: signals ? signals.artificialPlant : null,
    stageMatch: signals ? signals.stageMatch : null,
    duplicate: duplicates.status,
    crossUser,
    journeyConsistency,
    // How close this frame is to this plant's earlier stages, and whether the
    // member said it came from the camera or from the gallery. The latter is
    // client-declared, so it is recorded for the reviewer and never trusted.
    continuity: { status: continuity.status, distance: continuity.distance, compared: continuity.compared },
    captureSource: ["camera", "upload"].includes(body.captureSource) ? body.captureSource : "unknown",
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
      continuityDistance: continuity.distance,
      continuityStatus: continuity.status,
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

  // Two separate answers, so the member is never told more than we know:
  // identification is what the model saw, authenticity is where the review
  // stands. Nothing here ever claims an image was proven authentic.
  const plantMatchForMember = verificationResult.plantMatch;
  res.status(201).json({
    ...verification,
    identification_status:
      plantMatchForMember === false ? "failed" : plantMatchForMember === true ? "passed" : "inconclusive",
    authenticity_status:
      approvalStatus === "rejected"
        ? "rejected"
        : requiresReview
          ? "review_pending"
          : "not_flagged",
  });
};

exports.getOne = async (req, res) => {
  const verification = await verificationModel.findByIdForUser(req.params.id, req.user.id);
  if (!verification) return res.status(404).json({ error: "Verification not found" });
  res.json(await plantName.decorate(verification, plantName.requestLanguage(req)));
};

exports.history = async (req, res) => {
  res.json(
    await plantName.decorate(await verificationModel.listByUser(req.user.id), plantName.requestLanguage(req))
  );
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
