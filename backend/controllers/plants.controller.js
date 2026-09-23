// controllers/plants.controller.js
const plantModel = require("../models/plant.model");

exports.list = async (req, res) => {
  res.json(await plantModel.listByUser(req.user.id));
};

exports.create = async (req, res) => {
  const { plantType, plantingMethod, plantingDate, location } = req.body || {};
  if (!plantType) return res.status(400).json({ error: "plantType is required" });

  const plant = await plantModel.create({
    userId: req.user.id,
    plantType,
    plantingMethod,
    plantingDate,
    location,
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
