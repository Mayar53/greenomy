// controllers/green-hub.controller.js
const greenHubModel = require("../models/green-hub.model");

exports.list = async (req, res) => {
  res.json(await greenHubModel.list({ category: req.query.category }));
};

exports.getOne = async (req, res) => {
  const article = await greenHubModel.findBySlug(req.params.slug);
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json(article);
};
