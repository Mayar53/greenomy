// controllers/impact.controller.js
const plantModel = require("../models/plant.model");
const userModel = require("../models/user.model");

const CO2_KG_PER_PLANT = 1.8; // matches users.controller.js getMyImpact

/** Platform-wide counters for the homepage — real aggregates, not constants.
 *   seedsStarted — every plant row (all of them began from a seed/starter)
 *   plantsGrown  — plants with at least one approved verification
 *   members      — registered accounts
 */
exports.getImpact = async (req, res) => {
  const [seedsStarted, plantsGrown, members] = await Promise.all([
    plantModel.countAll(),
    plantModel.countGrown(),
    userModel.count(),
  ]);

  res.json({
    plantsGrown,
    seedsStarted,
    co2ImpactKg: Math.round(seedsStarted * CO2_KG_PER_PLANT),
    members,
  });
};
