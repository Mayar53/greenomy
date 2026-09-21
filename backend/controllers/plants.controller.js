const db = require("../database/mock-data");

exports.list = (req, res) => {
  res.json(db.plants.filter((p) => p.user_id === req.user.id));
};

exports.create = (req, res) => {
  const { plantType, plantingMethod, plantingDate, location } = req.body || {};
  if (!plantType) return res.status(400).json({ error: "plantType is required" });

  const plant = {
    plant_id: `pl_${Date.now()}`,
    user_id: req.user.id,
    plant_type: plantType,
    planting_method: plantingMethod || null,
    stage: "seed",
    planting_date: plantingDate || new Date().toISOString(),
    location: location || null,
    last_watered: null,
    next_watering: null,
    status: "active",
    created_at: new Date().toISOString(),
  };
  db.plants.push(plant);
  res.status(201).json(plant);
};

exports.getOne = (req, res) => {
  const plant = db.plants.find((p) => p.plant_id === req.params.id && p.user_id === req.user.id);
  if (!plant) return res.status(404).json({ error: "Plant not found" });
  res.json(plant);
};

exports.update = (req, res) => {
  const plant = db.plants.find((p) => p.plant_id === req.params.id && p.user_id === req.user.id);
  if (!plant) return res.status(404).json({ error: "Plant not found" });
  Object.assign(plant, req.body || {}, { updated_at: new Date().toISOString() });
  res.json(plant);
};

exports.remove = (req, res) => {
  const idx = db.plants.findIndex((p) => p.plant_id === req.params.id && p.user_id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: "Plant not found" });
  db.plants.splice(idx, 1);
  res.status(204).end();
};
