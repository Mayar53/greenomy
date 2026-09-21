const db = require("../database/mock-data");

exports.list = (req, res) => {
  const { category } = req.query;
  const data = category && category !== "all"
    ? db.greenHub.filter((a) => a.category === category)
    : db.greenHub;
  res.json(data);
};

exports.getOne = (req, res) => {
  const article = db.greenHub.find((a) => a.slug === req.params.slug);
  if (!article) return res.status(404).json({ error: "Article not found" });
  res.json(article);
};
