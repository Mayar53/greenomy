const db = require("../database/mock-data");

exports.list = (req, res) => {
  res.json(db.partners.filter((p) => p.is_active));
};

exports.create = (req, res) => {
  const { name, website, contactEmail, description } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const partner = {
    partner_id: `p_${Date.now()}`,
    name,
    website: website || null,
    description: description || null,
    contact_email: contactEmail || null,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  db.partners.push(partner);
  res.status(201).json(partner);
};

exports.update = (req, res) => {
  const partner = db.partners.find((p) => p.partner_id === req.params.id);
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  Object.assign(partner, req.body || {});
  res.json(partner);
};
