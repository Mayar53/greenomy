// controllers/engagement.controller.js — plant journeys, care, achievements,
// challenges and mystery rewards for the signed-in member.
const engagementService = require("../services/engagement.service");

/** GET /api/engagement — the whole engagement state in one payload. */
exports.summary = async (req, res) => {
  const data = await engagementService.summary(req.user.id);
  if (!data) return res.status(404).json({ error: "Account not found" });
  res.json(data);
};

/** POST /api/engagement/care { plantId, actionType, note? } */
exports.care = async (req, res) => {
  const { plantId, actionType, note } = req.body || {};
  if (!plantId || !actionType) {
    return res.status(400).json({ error: "plantId and actionType are required" });
  }

  const result = await engagementService.recordCare(req.user.id, { plantId, actionType, note });
  if (result.error === "unknown_action") return res.status(400).json({ error: "Unknown care action" });
  if (result.error === "plant_not_found") return res.status(404).json({ error: "Plant not found" });

  res.status(201).json(result);
};

/** POST /api/engagement/mystery/:grantId/claim — reveal a mystery reward once. */
exports.claimMystery = async (req, res) => {
  const result = await engagementService.claimMystery(req.user.id, req.params.grantId);
  if (result.error === "not_found") return res.status(404).json({ error: "Reward not found" });
  if (result.error === "already_claimed") {
    return res.status(409).json({ error: "That reward has already been claimed" });
  }
  res.json(result);
};

/** POST /api/engagement/challenges/:challengeId/claim */
exports.claimChallenge = async (req, res) => {
  const result = await engagementService.claimChallenge(req.user.id, req.params.challengeId);
  if (result.error === "not_found") return res.status(404).json({ error: "Challenge not found" });
  if (result.error === "not_claimable") {
    return res.status(409).json({ error: "That challenge is not ready to claim" });
  }
  res.json(result);
};
