const db = require("../database/mock-data");

exports.getWallet = (req, res) => {
  const user = db.users.find((u) => u.user_id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const transactions = db.pointTransactions.filter((t) => t.user_id === req.user.id);
  const totalEarned = transactions.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
  const totalSpent = transactions.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  res.json({ currentPoints: user.total_points, totalEarned, totalSpent });
};

exports.getTransactions = (req, res) => {
  res.json(db.pointTransactions.filter((t) => t.user_id === req.user.id));
};
