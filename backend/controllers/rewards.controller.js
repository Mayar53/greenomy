// controllers/rewards.controller.js
const crypto = require("crypto");
const { withTransaction } = require("../config/db");
const rewardModel = require("../models/reward.model");
const redemptionModel = require("../models/redemption.model");
const userModel = require("../models/user.model");
const transactionModel = require("../models/point-transaction.model");
const { notify } = require("../services/notification.service");

const REDEMPTION_TTL_MS = 1000 * 60 * 60 * 24; // 24h

exports.list = async (req, res) => {
  res.json(await rewardModel.listActive());
};

exports.getOne = async (req, res) => {
  const reward = await rewardModel.findById(req.params.id);
  if (!reward) return res.status(404).json({ error: "Reward not found" });
  res.json(reward);
};

exports.redeem = async (req, res) => {
  // Reward row and balance are both locked, so concurrent redeems can't both
  // pass the checks; points, redemption and ledger row commit together.
  const outcome = await withTransaction(async (client) => {
    const reward = await rewardModel.lockForUpdate(client, req.params.id);
    if (!reward || !reward.is_active) {
      return { status: 404, message: "Reward not available" };
    }
    if (reward.expires_at && new Date(reward.expires_at) < new Date()) {
      return { status: 410, message: "This reward has expired" };
    }

    const user = await userModel.lockForUpdate(client, req.user.id);
    if (!user) return { status: 404, message: "User not found" };
    if (user.total_points < reward.points_required) {
      return { status: 402, message: "Not enough points to redeem this reward" };
    }

    await userModel.addPoints(client, user.user_id, -reward.points_required);

    const redemption = await redemptionModel.create(client, {
      userId: user.user_id,
      rewardId: reward.reward_id,
      partnerId: reward.partner_id,
      pointsSpent: reward.points_required,
      token: crypto.randomBytes(24).toString("hex"),
      expiresAt: new Date(Date.now() + REDEMPTION_TTL_MS).toISOString(),
    });

    await transactionModel.create(client, {
      userId: user.user_id,
      amount: -reward.points_required,
      transactionType: "reward_redeemed",
      referenceId: redemption.redemption_id,
    });

    return { redemption };
  });

  if (outcome.status) {
    return res.status(outcome.status).json({ error: outcome.message });
  }

  await notify({ userId: outcome.redemption.user_id, type: "reward_redeemed" });

  // The QR encodes only the opaque token — never personal data.
  res.status(201).json({
    redemption: outcome.redemption,
    qrPayload: outcome.redemption.redemption_token,
  });
};

// Partner-facing: consume a one-time redemption token at the counter. The first
// successful call marks it used, so a code can never be claimed twice.
exports.validateRedemption = async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "token is required" });

  // These reads are advisory — they only pick the right error message. They
  // deliberately run outside the transaction: inside withTransaction only the
  // `client` may be used (the single-connection PGlite driver would deadlock).
  const existing = await redemptionModel.findByToken(token);
  if (!existing) return res.status(404).json({ error: "Invalid redemption code" });
  if (existing.is_used) return res.status(409).json({ error: "This code has already been used" });
  if (new Date(existing.expires_at) < new Date()) {
    return res.status(410).json({ error: "This code has expired" });
  }

  // The authority is the conditional UPDATE: `WHERE is_used = false AND
  // expires_at > now()` means two simultaneous scans resolve to one winner.
  const redemption = await withTransaction((client) =>
    redemptionModel.consumeByToken(client, token)
  );
  if (!redemption) return res.status(409).json({ error: "This code has already been used" });

  const reward = await rewardModel.findById(redemption.reward_id);
  res.json({
    success: true,
    redemption,
    reward: reward
      ? {
          title: reward.title,
          partner: reward.partner,
          points_spent: redemption.points_spent,
          i18n: reward.i18n,
        }
      : null,
  });
};
