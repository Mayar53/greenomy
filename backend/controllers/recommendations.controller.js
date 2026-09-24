// controllers/recommendations.controller.js — "what should I plant?"
//
// The ranking itself lives in services/recommendation.service.js and the
// location/season data in services/weather.service.js; this only assembles the
// member's own context and returns the result.
const catalogModel = require("../models/plant-catalog.model");
const knowledgeModel = require("../models/plant-knowledge.model");
const userModel = require("../models/user.model");
const weather = require("../services/weather.service");
const { recommend, buildContext } = require("../services/recommendation.service");

/**
 * GET /api/recommendations?duration=weeks|months|season|any&space=indoor|outdoor|both
 *
 * requireAuth only puts { id, role } on req.user, so the member is loaded here
 * for their city and stored preferences.
 */
exports.list = async (req, res) => {
  const { duration, space } = req.query || {};

  const user = await userModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const [catalog, conditions] = await Promise.all([
    catalogModel.listActive(),
    weather.getConditions(user.city),
  ]);

  const context = buildContext(conditions, {
    duration,
    space,
    experience: user.experience,
    plantTypes: user.plant_types,
  });

  res.json({
    conditions,
    // Echoed so the UI can show which inputs produced this ranking.
    appliedPreference: {
      duration: duration || "any",
      space: space || "both",
      experience: user.experience || null,
      plantTypes: user.plant_types || [],
    },
    recommendations: recommend(catalog, context),
  });
};

/** GET /api/catalog — the whole growable catalog, for the wizard's tiles. */
exports.catalog = async (req, res) => {
  res.json(await catalogModel.listActive());
};

/**
 * GET /api/catalog/search?q=&lang=&category=&limit=
 *
 * Alias-aware search: the same normalizer the assistant uses, so a member can
 * type an English name, a scientific name, MSA or their local Iraqi/Kurdish
 * name and reach the one canonical plant. Public — the wizard searches before
 * anything is saved.
 */
exports.search = async (req, res) => {
  const { q, lang, category } = req.query || {};
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  res.json(await catalogModel.search({ q, lang, category, limit }));
};

/** GET /api/catalog/:slug — one plant with its varieties and sourced facts. */
exports.detail = async (req, res) => {
  const plant = await catalogModel.findBySlug(req.params.slug);
  if (!plant) return res.status(404).json({ error: "Plant not found" });

  const [varieties, knowledge] = await Promise.all([
    knowledgeModel.listVarieties(plant.id),
    knowledgeModel.listByPlant(plant.id),
  ]);
  res.json({ ...plant, varieties, knowledge });
};
