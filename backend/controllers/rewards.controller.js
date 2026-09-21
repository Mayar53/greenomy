const crypto = require("crypto");
const db = require("../database/mock-data");

exports.list = (req, res) => {
  res.json(db.rewards.filter((r) => r.is_active));
};

exports.getOne = (req, res) => {
  const reward = db.rewards.find((r) => r.reward_id === req.params.id);
  if (!reward) return res.status(404).json({ error: "Reward not found" });
  res.json(reward);
};

exports.redeem = (req, res) => {
  const reward = db.rewards.find((r) => r.reward_id === req.params.id);
  if (!reward || !reward.is_active) return res.status(404).json({ error: "Reward not available" });
  if (reward.expires_at && new Date(reward.expires_at) < new Date()) {
    return res.status(410).json({ error: "This reward has expired" });
  }

  const user = db.users.find((u) => u.user_id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.total_points < reward.points_required) {
    return res.status(402).json({ error: "Not enough points to redeem this reward" });
  }

  user.total_points -= reward.points_required;

  const redemption = {
    redemption_id: `r_${Date.now()}`,
    user_id: user.user_id,
    reward_id: reward.reward_id,
    points_spent: reward.points_required,
    redemption_token: crypto.randomBytes(24).toString("hex"),
    is_used: false,
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24h validity
    created_at: new Date().toISOString(),
  };
  db.redemptions.push(redemption);

  db.pointTransactions.push({
    transaction_id: `t_${Date.now()}`,
    user_id: user.user_id,
    amount: -reward.points_required,
    transaction_type: "reward_redeemed",
    reference_id: redemption.redemption_id,
    created_at: new Date().toISOString(),
  });

  // The QR encodes only the opaque token — never personal data.
  res.status(201).json({ redemption, qrPayload: redemption.redemption_token });
};
