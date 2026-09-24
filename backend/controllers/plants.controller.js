// controllers/plants.controller.js
const plantModel = require("../models/plant.model");
const catalogModel = require("../models/plant-catalog.model");

exports.list = async (req, res) => {
  res.json(await plantModel.listByUser(req.user.id));
};

exports.create = async (req, res) => {
  const { plantType, plantingMethod, plantingDate, location, canonicalPlantId, varietyId, customName } =
    req.body || {};

  let resolvedType = typeof plantType === "string" ? plantType.trim() : "";
  let canonicalId = canonicalPlantId || null;

  // A catalog plant gives the display name for free; an id that isn't in the
  // catalog is rejected rather than stored as a dangling link.
  if (canonicalId) {
    const entry = await catalogModel.findById(canonicalId);
    if (!entry) return res.status(400).json({ error: "Unknown plant" });
    if (!resolvedType) resolvedType = entry.name;
  }
  // A plant not in our catalog is still allowed — it is stored by name and
  // flagged as custom, never silently mapped onto a different canonical plant.
  if (!resolvedType && customName) resolvedType = String(customName).trim();

  if (!resolvedType) {
    return res.status(400).json({ error: "plantType or canonicalPlantId is required" });
  }

  const plant = await plantModel.create({
    userId: req.user.id,
    plantType: resolvedType,
    plantingMethod,
    plantingDate,
    location,
    canonicalPlantId: canonicalId,
    varietyId,
    customName,
  });
  res.status(201).json(plant);
};

exports.getOne = async (req, res) => {
  const plant = await plantModel.findByIdForUser(req.params.id, req.user.id);
  if (!plant) return res.status(404).json({ error: "Plant not found" });
  res.json(plant);
};

exports.update = async (req, res) => {
  const plant = await plantModel.update(req.params.id, req.user.id, req.body || {});
  if (!plant) return res.status(404).json({ error: "Plant not found" });
  res.json(plant);
};

exports.remove = async (req, res) => {
  const removed = await plantModel.remove(req.params.id, req.user.id);
  if (!removed) return res.status(404).json({ error: "Plant not found" });
  res.status(204).end();
};
