// controllers/users.controller.js
const userModel = require("../models/user.model");
const plantModel = require("../models/plant.model");
const verificationModel = require("../models/verification.model");

exports.getMe = async (req, res) => {
  const user = await userModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};

exports.updateMe = async (req, res) => {
  const { fullName, city } = req.body || {};
  const user = await userModel.updateProfile(req.user.id, { fullName, city });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};

exports.getMyImpact = async (req, res) => {
  const [plantsGrown, verifiedPhotos] = await Promise.all([
    plantModel.countByUser(req.user.id),
    verificationModel.countApprovedByUser(req.user.id),
  ]);
  res.json({
    plantsGrown,
    verifiedPhotos,
    estimatedCo2Kg: plantsGrown * 1.8,
  });
};
