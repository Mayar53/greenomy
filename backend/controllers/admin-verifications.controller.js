// controllers/admin-verifications.controller.js
const { withTransaction } = require("../config/db");
const verificationModel = require("../models/verification.model");
const userModel = require("../models/user.model");
const transactionModel = require("../models/point-transaction.model");
const { notify } = require("../services/notification.service");

// Shared with the auto-approval path in verifications.controller.js.
const POINTS_PER_APPROVED_PHOTO = 30;

exports.queue = async (req, res) => {
  res.json(await verificationModel.listPending());
};

exports.approve = async (req, res) => {
  // approve() only matches a still-pending row, so a double-click or two
  // admins at once cannot pay the same photo's points twice.
  const verification = await withTransaction(async (client) => {
    const record = await verificationModel.approve(client, req.params.id, req.user.id);
    if (!record) return null;

    await userModel.addPoints(client, record.user_id, POINTS_PER_APPROVED_PHOTO);
    await transactionModel.create(client, {
      userId: record.user_id,
      amount: POINTS_PER_APPROVED_PHOTO,
      transactionType: "verification_approved",
      referenceId: record.verification_id,
    });
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
  const verification = await withTransaction((client) =>
    verificationModel.reject(client, req.params.id, req.user.id, reason)
  );

  if (!verification) {
    return res.status(404).json({ error: "Pending verification not found" });
  }

  await notify({ userId: verification.user_id, type: "verification_rejected" });
  res.json(verification);
};
