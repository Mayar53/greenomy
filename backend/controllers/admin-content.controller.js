// controllers/admin-content.controller.js
const greenHubModel = require("../models/green-hub.model");

const CATEGORIES = [
  "food-seed-recycling",
  "home-gardening",
  "plant-care",
  "iraq-climate",
  "soil",
  "water",
  "planting-strategies",
];

exports.list = async (req, res) => {
  res.json(await greenHubModel.listAll());
};

exports.create = async (req, res) => {
  const { slug, title, category, description, body, readingTime, isPublished, i18n } =
    req.body || {};

  if (!slug || !title) {
    return res.status(400).json({ error: "slug and title are required" });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(", ")}` });
  }
  if (body !== undefined && !Array.isArray(body)) {
    return res.status(400).json({ error: "body must be an array of paragraphs" });
  }

  const article = await greenHubModel.create({
    slug,
    title,
    category,
    description,
    body,
    readingTime,
    isPublished,
    i18n,
  });
  res.status(201).json(article);
};

exports.update = async (req, res) => {
  const { category, body } = req.body || {};

  if (category !== undefined && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(", ")}` });
  }
  if (body !== undefined && !Array.isArray(body)) {
    return res.status(400).json({ error: "body must be an array of paragraphs" });
  }

  const article = await greenHubModel.update(req.params.id, req.body || {});
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json(article);
};

exports.remove = async (req, res) => {
  const removed = await greenHubModel.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: "Article not found" });
  res.status(204).end();
};
