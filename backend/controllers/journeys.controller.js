// controllers/journeys.controller.js — a plant's growth journey and milestones.
const journeyModel = require("../models/journey.model");
const plantModel = require("../models/plant.model");
const journeyService = require("../services/journey.service");
const engagementConfig = require("../services/engagement-config.service");
const engagementService = require("../services/engagement.service");
const plantName = require("../services/plant-name.service");

/**
 * Adds what the plant's OWN journey pays at each milestone, plus the age and
 * progress of the journey, so the UI can render it without knowing the config.
 * The reward is resolved from the plant's template and id, so two plants with
 * the same stage name can still pay different things.
 *
 * Returns the same `{ journey, milestones }` shape the endpoints already used,
 * with the extra fields folded in — no client had to change.
 */
function enrichJourney(journey, milestones) {
  const total = milestones.length;
  const done = milestones.filter((milestone) => milestone.completed_at).length;
  const next = milestones.find((milestone) => !milestone.completed_at) || null;
  const ageDays = journey.planting_date
    ? Math.max(0, Math.floor((Date.now() - new Date(journey.planting_date).getTime()) / 86400000))
    : null;

  const decorated = milestones.map((milestone) => ({
    ...milestone,
    reward: engagementConfig.describePayload(
      engagementConfig.milestoneReward({
        plantId: journey.canonical_plant_id,
        template: journey.stage_template,
        stageKey: milestone.stage_key,
      })
    ),
  }));

  return {
    journey: {
      ...journey,
      milestones_done: done,
      milestones_total: total,
      progress: total ? done / total : 0,
      age_days: ageDays,
      next_milestone: next,
    },
    milestones: decorated,
  };
}

exports.list = async (req, res) => {
  const journeys = await journeyModel.listByUser(req.user.id);
  const enriched = await Promise.all(
    journeys.map(async (journey) => {
      const result = enrichJourney(journey, await journeyModel.listMilestones(journey.journey_id));
      return { ...result.journey, milestones: result.milestones };
    })
  );
  res.json(await plantName.decorate(enriched, plantName.requestLanguage(req)));
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
  const result = enrichJourney(journey, await journeyModel.listMilestones(journey.journey_id));
  const payload = { ...result.journey, milestones: result.milestones };
  res.json(await plantName.decorate(payload, plantName.requestLanguage(req)));
};

/** Marks a milestone reached. Verified milestones also earn their engagement
 * reward (XP, items, mystery) through the engagement service — idempotently, so
 * a replayed request pays nothing extra. */
exports.completeMilestone = async (req, res) => {
  const result = await journeyService.completeMilestone(req.user.id, req.params.id, req.params.milestoneId);

  if (result.error === "not_found") return res.status(404).json({ error: "Journey not found" });
  if (result.error === "milestone_not_found") return res.status(404).json({ error: "Milestone not found" });

  const completed = result.milestones.find((milestone) => milestone.milestone_id === req.params.milestoneId);
  try {
    await engagementService.onMilestoneCompleted(req.user.id, {
      plantId: result.journey.user_plant_id,
      milestoneId: req.params.milestoneId,
      stageKey: completed ? completed.stage_key : "planting",
    });
  } catch (err) {
    // A reward failure must never undo the milestone the member just recorded.
    console.warn(`Could not apply engagement rewards for milestone ${req.params.milestoneId}: ${err.message}`);
  }

  res.json(enrichJourney(result.journey, result.milestones));
};
