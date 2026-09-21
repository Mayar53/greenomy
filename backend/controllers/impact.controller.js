const db = require("../database/mock-data");

exports.getImpact = (req, res) => {
  res.json(db.impact);
};
