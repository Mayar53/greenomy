// models/partner.model.js
const { query } = require("../config/db");

const FIELD_MAP = {
  name: "name",
  logoUrl: "logo_url",
  logo_url: "logo_url",
  website: "website",
  description: "description",
  contactEmail: "contact_email",
  contact_email: "contact_email",
  isActive: "is_active",
  is_active: "is_active",
};

async function listActive() {
  const { rows } = await query(
    "SELECT * FROM partners WHERE is_active = true ORDER BY name ASC"
  );
  return rows;
}

/** Admin list — includes inactive partners, newest first. */
async function listAll() {
  const { rows } = await query("SELECT * FROM partners ORDER BY created_at DESC");
  return rows;
}

async function findById(partnerId) {
  const { rows } = await query("SELECT * FROM partners WHERE partner_id = $1", [partnerId]);
  return rows[0] || null;
}

async function create({ name, logoUrl, website, description, contactEmail }) {
  const { rows } = await query(
    `INSERT INTO partners (name, logo_url, website, description, contact_email)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, logoUrl || null, website || null, description || null, contactEmail || null]
  );
  return rows[0];
}

async function update(partnerId, changes) {
  const sets = [];
  const values = [partnerId];

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (changes[key] !== undefined) {
      values.push(changes[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (!sets.length) return findById(partnerId);

  const { rows } = await query(
    `UPDATE partners SET ${sets.join(", ")} WHERE partner_id = $1 RETURNING *`,
    values
  );
  return rows[0] || null;
}

module.exports = { listActive, listAll, findById, create, update };
