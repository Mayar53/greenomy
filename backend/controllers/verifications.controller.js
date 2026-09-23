// controllers/verifications.controller.js
// Verification confidence >= 85% auto-approves; below that, it queues for
// admin review. The scoring itself is delegated to a swappable provider
// (see services/verification-provider.js) so the AI vendor isn't hardcoded.
const { withTransaction } = require("../config/db");
const verificationModel = require("../models/verification.model");
const plantModel = require("../models/plant.model");
const userModel = require("../models/user.model");
const transactionModel = require("../models/point-transaction.model");
const { getVerificationProvider, HeuristicVerificationProvider } = require("../services/verification-provider");
const { notify } = require("../services/notification.service");

const AUTO_APPROVE_THRESHOLD = 0.85;
const POINTS_PER_VERIFIED_PHOTO = 30;

exports.submit = async (req, res) => {
  const { plantId, imageUrl, gpsLat, gpsLong, pixelStats } = req.body || {};
  if (!plantId || !imageUrl) {
    return res.status(400).json({ error: "plantId and imageUrl are required" });
  }

  const plant = await plantModel.findByIdForUser(plantId, req.user.id);
  if (!plant) return res.status(404).json({ error: "Plant not found" });

  // An AI provider outage, timeout or bad key must never block a submission —
  // fall back to the offline scorer so the member still gets a result.
  let scored;
  try {
    scored = await getVerificationProvider().score({ imageUrl, pixelStats });
  } catch (err) {
    console.warn(`Verification provider failed (${err.message}) — using the heuristic scorer.`);
    scored = await new HeuristicVerificationProvider().score({ imageUrl, pixelStats });
  }
  const { confidence, provider: scoredBy, metrics } = scored;

  const approvalStatus = confidence >= AUTO_APPROVE_THRESHOLD ? "approved" : "pending";

  // The record and the points it earns must land together or not at all.
  const verification = await withTransaction(async (client) => {
    const record = await verificationModel.create(client, {
      plantId,
      userId: req.user.id,
      imageUrl,
      gpsLat,
      gpsLong,
      confidence,
      provider: scoredBy,
      metrics,
      approvalStatus,
    });

    if (approvalStatus === "approved") {
      await userModel.addPoints(client, req.user.id, POINTS_PER_VERIFIED_PHOTO);
      await transactionModel.create(client, {
        userId: req.user.id,
        amount: POINTS_PER_VERIFIED_PHOTO,
        transactionType: "verification_approved",
        referenceId: record.verification_id,
      });
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
