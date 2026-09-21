const db = require("../database/mock-data");

exports.getMe = (req, res) => {
  const user = db.users.find((u) => u.user_id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { password_hash, ...safe } = user;
  res.json(safe);
};

exports.updateMe = (req, res) => {
  const user = db.users.find((u) => u.user_id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { fullName, city } = req.body || {};
  if (fullName) user.full_name = fullName;
  if (city) user.city = city;
  user.updated_at = new Date().toISOString();
  const { password_hash, ...safe } = user;
  res.json(safe);
};

exports.getMyImpact = (req, res) => {
  const plants = db.plants.filter((p) => p.user_id === req.user.id);
  const verifications = db.verifications.filter((v) => v.user_id === req.user.id && v.approval_status === "approved");
  res.json({
    plantsGrown: plants.length,
    verifiedPhotos: verifications.length,
    estimatedCo2Kg: plants.length * 1.8,
  });
};
