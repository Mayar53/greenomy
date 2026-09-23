// controllers/wallet.controller.js
const userModel = require("../models/user.model");
const transactionModel = require("../models/point-transaction.model");

exports.getWallet = async (req, res) => {
  const user = await userModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const totals = await transactionModel.totalsForUser(req.user.id);
  res.json({
    currentPoints: user.total_points,
    totalEarned: totals.earned,
    totalSpent: totals.spent,
  });
};

exports.getTransactions = async (req, res) => {
  res.json(await transactionModel.listByUser(req.user.id));
};
