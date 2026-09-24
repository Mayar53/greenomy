// controllers/admin-verifications.controller.js
const { withTransaction } = require("../config/db");
const verificationModel = require("../models/verification.model");
const rewardEngine = require("../services/reward-engine.service");
const { notify } = require("../services/notification.service");

exports.queue = async (req, res) => {
  res.json(await verificationModel.listPending());
};

exports.approve = async (req, res) => {
  // Two safeguards against paying twice: approve() only matches a still-pending
  // row, and the reward engine's unique award key stops any replay.
  const verification = await withTransaction(async (client) => {
    const record = await verificationModel.approve(client, req.params.id, req.user.id);
    if (!record) return null;

    await rewardEngine.onVerificationApproved(client, record);
    return record;
  });

  if (!verification) {
    return res.status(404).json({ error: "Pending verification not found" });
  }

  await notify({ userId: verification.user_id, type: "verification_approved" });
  res.json(verification);
};

exports.reject = async (req, res) => {
  const reason = (req.body && req.body.reason) || null;
  const verification = await withTransaction(async (client) => {
    const record = await verificationModel.reject(client, req.params.id, req.user.id, reason);
    if (record) await rewardEngine.onVerificationRejected(client, record);
    return record;
  });

  if (!verification) {
    return res.status(404).json({ error: "Pending verification not found" });
  }

  await notify({ userId: verification.user_id, type: "verification_rejected" });
  res.json(verification);
};
