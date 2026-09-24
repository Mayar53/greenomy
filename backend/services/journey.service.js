// services/journey.service.js — turns a plant into a growth journey with
// milestone windows derived from the plant's OWN durations and stage template.
//
// Nothing here is a fixed calendar. The stages come from plant_growth_stages
// (per-plant rows, else the plant's template rows), and the day windows are
// interpolated between the plant's germination period and its days-to-harvest,
// so a radish and a lemon tree get genuinely different schedules.
const { withTransaction } = require("../config/db");
const journeyModel = require("../models/journey.model");
const catalogModel = require("../models/plant-catalog.model");
const stageModel = require("../models/plant-stage.model");

// A plant we cannot resolve to the catalog still gets a sensible, configurable
// schedule rather than none.
const DEFAULT_TEMPLATE = "annual-vegetable";

// Methods that start from an already-growing plant — there is no germination
// stage to wait for.
const ESTABLISHED_METHODS = new Set(["From Cutting", "Transplanted Seedling", "Regrown From Scraps"]);

/** "Day 7" for a point, "Days 7–21" for a window. */
function windowLabel(from, to) {
  if (from == null && to == null) return null;
  if (from == null) return `Day ${to}`;
  if (to == null || from === to) return `Day ${from}`;
  return `Days ${from}–${to}`;
}

/**
 * Milestone windows for a plant. `plant` supplies the durations (a catalog row
 * when we have one). Returns them in stage order.
 */
function scheduleFor(stages, plant = {}, { plantingMethod } = {}) {
  if (!stages || !stages.length) return [];

  const ordered = stages.slice().sort((a, b) => a.sort_order - b.sort_order);
  const established = ESTABLISHED_METHODS.has(plantingMethod);
  const usable = established ? ordered.filter((stage) => stage.stage_key !== "germination") : ordered;

  const total = Number(plant.days_to_harvest || plant.growth_duration_days) || 60;
  const hasGermination = usable.some((stage) => stage.stage_key === "germination");
  const germinationDays = Number(plant.germination_duration_days) || Math.max(2, Math.round(total * 0.1));

  // Growth stages are everything after planting/germination, spread evenly from
  // the end of germination to harvest day.
  const growth = usable.filter((stage) => stage.stage_key !== "planting" && stage.stage_key !== "germination");
  const growthStart = hasGermination ? germinationDays : 0;
  const span = Math.max(1, total - growthStart);

  return usable.map((stage) => {
    let from;
    let to;

    if (stage.stage_key === "planting") {
      from = 0;
      to = 0;
    } else if (stage.stage_key === "germination") {
      from = 0;
      to = germinationDays;
    } else {
      const index = growth.indexOf(stage);
      from = Math.round(growthStart + (span * index) / growth.length);
      to = Math.round(growthStart + (span * (index + 1)) / growth.length);
    }

    return {
      stage_key: stage.stage_key,
      label_en: stage.label_en,
      sort_order: stage.sort_order,
      expected_day_from: from,
      expected_day_to: to,
      recommended_window: windowLabel(from, to),
    };
  });
}

/** The catalog row behind a member's plant, when it is linked to one. */
async function catalogFor(plant) {
  if (!plant.canonical_plant_id) return null;
  return catalogModel.findById(plant.canonical_plant_id);
}

/** The stages to use: the plant's own overrides, else its template, else the
 * default template. */
async function stagesFor(catalog) {
  const template = (catalog && catalog.stage_template) || DEFAULT_TEMPLATE;
  return stageModel.listForPlant(catalog ? catalog.id : null, template);
}

/**
 * Creates (or returns) the journey for a plant. Idempotent: a plant has one
 * journey, so a repeated request returns the existing one rather than starting
 * a second that could double-count milestones.
 */
async function createForPlant(userId, plant) {
  const existing = await journeyModel.findByPlant(plant.plant_id);
  if (existing) {
    return { journey: existing, milestones: await journeyModel.listMilestones(existing.journey_id), created: false };
  }

  const catalog = await catalogFor(plant);
  const stages = await stagesFor(catalog);
  const milestones = scheduleFor(stages, catalog || {}, { plantingMethod: plant.planting_method });

  const journey = await withTransaction(async (client) => {
    const created = await journeyModel.create(client, {
      userId,
      userPlantId: plant.plant_id,
      expectedDurationDays: catalog ? catalog.days_to_harvest : null,
      currentStage: milestones.length ? milestones[0].stage_key : "planting",
    });
    await journeyModel.addMilestones(client, created.journey_id, milestones);
    return created;
  });

  return { journey, milestones: await journeyModel.listMilestones(journey.journey_id), created: true };
}

/**
 * Marks a milestone reached. Idempotent (only an open milestone can close) and
 * advances the journey's stage to the furthest milestone completed. The journey
 * completes automatically when its last milestone closes.
 */
async function completeMilestone(userId, journeyId, milestoneId, options = {}) {
  const journey = await journeyModel.findByIdForUser(journeyId, userId);
  if (!journey) return { error: "not_found" };

  const milestone = await journeyModel.findMilestone(journeyId, milestoneId);
  if (!milestone) return { error: "milestone_not_found" };

  await withTransaction(async (client) => {
    const completed = await journeyModel.completeMilestone(client, milestoneId, {
      verificationId: options.verificationId,
      verificationStatus: options.verificationStatus,
    });
    if (!completed) return; // already closed — nothing to do

    // The furthest stage reached, so completing out of order cannot move the
    // journey backwards.
    const furthest = await client.query(
      `SELECT stage_key FROM journey_milestones
        WHERE journey_id = $1 AND completed_at IS NOT NULL
        ORDER BY sort_order DESC LIMIT 1`,
      [journeyId]
    );
    if (furthest.rows[0]) await journeyModel.setStage(client, journeyId, furthest.rows[0].stage_key);

    const open = await client.query(
      "SELECT count(*)::int AS n FROM journey_milestones WHERE journey_id = $1 AND completed_at IS NULL",
      [journeyId]
    );
    if (open.rows[0].n === 0) await journeyModel.complete(client, journeyId);
  });

  const [updated, milestones] = await Promise.all([
    journeyModel.findByIdForUser(journeyId, userId),
    journeyModel.listMilestones(journeyId),
  ]);
  return { journey: updated, milestones };
}

module.exports = { createForPlant, completeMilestone, scheduleFor, windowLabel, DEFAULT_TEMPLATE, ESTABLISHED_METHODS };
