// controllers/users.controller.js
const userModel = require("../models/user.model");
const plantModel = require("../models/plant.model");
const verificationModel = require("../models/verification.model");

exports.getMe = async (req, res) => {
  const user = await userModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};

// Preferences from the onboarding wizard. The experience level has a CHECK
// constraint in the database, so an unknown value is rejected here rather than
// surfacing as a database error.
const EXPERIENCE_LEVELS = ["beginner", "some-experience", "experienced", "expert"];
const PLANT_TYPE_CATEGORIES = ["vegetables", "herbs", "fruit-trees", "houseplants"];
const INTEREST_CATEGORIES = ["food-recycling", "composting", "urban-greening", "zero-waste"];

/** Keeps known values, drops the rest. Unknown categories are dropped rather
 * than rejected — these are UI tile values, and a rename shouldn't block a
 * profile save. Returns undefined when the field wasn't sent, so the model
 * leaves the column alone. */
function cleanList(value, allowed) {
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry) => typeof entry === "string" && allowed.includes(entry));
}

exports.updateMe = async (req, res) => {
  const { fullName, city, experience, plantTypes, interests } = req.body || {};

  if (experience !== undefined && experience !== null && !EXPERIENCE_LEVELS.includes(experience)) {
    return res.status(400).json({
      error: `experience must be one of: ${EXPERIENCE_LEVELS.join(", ")}`,
    });
  }

  const user = await userModel.updateProfile(req.user.id, {
    fullName,
    city,
    experience,
    plantTypes: cleanList(plantTypes, PLANT_TYPE_CATEGORIES),
    interests: cleanList(interests, INTEREST_CATEGORIES),
  });
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
