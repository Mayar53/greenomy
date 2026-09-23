// controllers/partners.controller.js
const partnerModel = require("../models/partner.model");

exports.list = async (req, res) => {
  res.json(await partnerModel.listActive());
};

/** Admin list — includes deactivated partners. */
exports.listAll = async (req, res) => {
  res.json(await partnerModel.listAll());
};

exports.create = async (req, res) => {
  const { name, logoUrl, website, description, contactEmail } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const partner = await partnerModel.create({ name, logoUrl, website, description, contactEmail });
  res.status(201).json(partner);
};

exports.update = async (req, res) => {
  const partner = await partnerModel.update(req.params.id, req.body || {});
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  res.json(partner);
};
