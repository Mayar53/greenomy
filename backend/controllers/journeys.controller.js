// controllers/journeys.controller.js — a plant's growth journey and milestones.
const journeyModel = require("../models/journey.model");
const plantModel = require("../models/plant.model");
const journeyService = require("../services/journey.service");

exports.list = async (req, res) => {
  const journeys = await journeyModel.listByUser(req.user.id);
  const withMilestones = await Promise.all(
    journeys.map(async (journey) => ({
      ...journey,
      milestones: await journeyModel.listMilestones(journey.journey_id),
    }))
  );
  res.json(withMilestones);
};

/** POST /api/journeys { plantId } — starts (or returns) a plant's journey. */
exports.create = async (req, res) => {
  const { plantId } = req.body || {};
  if (!plantId) return res.status(400).json({ error: "plantId is required" });

  const plant = await plantModel.findByIdForUser(plantId, req.user.id);
  if (!plant) return res.status(404).json({ error: "Plant not found" });

  const result = await journeyService.createForPlant(req.user.id, plant);
  res.status(result.created ? 201 : 200).json(result);
};

exports.getOne = async (req, res) => {
  const journey = await journeyModel.findByIdForUser(req.params.id, req.user.id);
  if (!journey) return res.status(404).json({ error: "Journey not found" });
  res.json({ ...journey, milestones: await journeyModel.listMilestones(journey.journey_id) });
};

/** Marks a milestone reached. Rewards for a verified milestone are applied by
 * the reward engine, not here. */
exports.completeMilestone = async (req, res) => {
  const result = await journeyService.completeMilestone(req.user.id, req.params.id, req.params.milestoneId);

  if (result.error === "not_found") return res.status(404).json({ error: "Journey not found" });
  if (result.error === "milestone_not_found") return res.status(404).json({ error: "Milestone not found" });

  res.json(result);
};
