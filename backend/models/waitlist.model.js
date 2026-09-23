// models/waitlist.model.js
const { query } = require("../config/db");

async function create({ fullName, email, city, gardeningInterests }) {
  const { rows } = await query(
    `INSERT INTO waitlist (full_name, email, city, gardening_interests)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [fullName, email, city, gardeningInterests || null]
  );
  return rows[0];
}

async function findByEmail(email) {
  const { rows } = await query("SELECT * FROM waitlist WHERE email = $1", [email]);
  return rows[0] || null;
}

module.exports = { create, findByEmail };
