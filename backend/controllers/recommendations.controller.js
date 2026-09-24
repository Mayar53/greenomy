// controllers/recommendations.controller.js — "what should I plant?"
//
// The ranking itself lives in services/recommendation.service.js and the
// location/season data in services/weather.service.js; this only assembles the
// member's own context and returns the result.
const catalogModel = require("../models/plant-catalog.model");
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
