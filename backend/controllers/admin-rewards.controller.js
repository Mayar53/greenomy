// controllers/admin-rewards.controller.js
const rewardModel = require("../models/reward.model");

const CATEGORIES = ["restaurant", "courses", "supplies", "university"];

function invalidCategory(category) {
  return !CATEGORIES.includes(category);
}

function isPositiveInt(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

exports.list = async (req, res) => {
  res.json(await rewardModel.listAll());
};

exports.create = async (req, res) => {
  const { partner, category, title, description, pointsRequired, expiresAt, isActive, i18n } =
    req.body || {};

  if (!partner || !title) {
    return res.status(400).json({ error: "partner and title are required" });
  }
  if (invalidCategory(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(", ")}` });
  }
  if (!isPositiveInt(pointsRequired)) {
    return res.status(400).json({ error: "pointsRequired must be a positive integer" });
  }

  const reward = await rewardModel.create({
    partner,
    category,
    title,
    description,
    pointsRequired: Number(pointsRequired),
    expiresAt,
    isActive,
    i18n,
  });
  res.status(201).json(reward);
};

exports.update = async (req, res) => {
  const { category, pointsRequired } = req.body || {};

  if (category !== undefined && invalidCategory(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(", ")}` });
  }
  if (pointsRequired !== undefined && !isPositiveInt(pointsRequired)) {
    return res.status(400).json({ error: "pointsRequired must be a positive integer" });
  }

  const changes = { ...(req.body || {}) };
  if (pointsRequired !== undefined) changes.pointsRequired = Number(pointsRequired);

  const reward = await rewardModel.update(req.params.id, changes);
  if (!reward) return res.status(404).json({ error: "Reward not found" });
  res.json(reward);
};
