// models/user-inventory.model.js — what a member owns: seeds, decorations,
// profile items, plant facts, garden items and rare items.
const { query } = require("../config/db");

const COLUMNS = "item_id, user_id, item_type, item_key, quantity, first_acquired_at, updated_at";

const run = (client) => (client ? client.query.bind(client) : query);

/** Adds items, accumulating quantity. Must run inside withTransaction. */
async function add(client, { userId, itemType, itemKey, quantity = 1 }) {
  const { rows } = await client.query(
    `INSERT INTO user_inventory (user_id, item_type, item_key, quantity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, item_type, item_key) DO UPDATE
       SET quantity = user_inventory.quantity + EXCLUDED.quantity,
           updated_at = now()
     RETURNING ${COLUMNS}`,
    [userId, itemType, itemKey, quantity]
  );
  return rows[0] || null;
}

async function listForUser(userId, client) {
  const { rows } = await run(client)(
    `SELECT ${COLUMNS} FROM user_inventory WHERE user_id = $1 ORDER BY item_type, first_acquired_at`,
    [userId]
  );
  return rows;
}

async function countByType(userId, itemType, client) {
  const { rows } = await run(client)(
    "SELECT count(*)::int AS n FROM user_inventory WHERE user_id = $1 AND item_type = $2",
    [userId, itemType]
  );
  return rows[0].n;
}

async function quantityByType(userId, itemType, client) {
  const { rows } = await run(client)(
    `SELECT COALESCE(SUM(quantity), 0)::int AS n FROM user_inventory
      WHERE user_id = $1 AND item_type = $2`,
    [userId, itemType]
  );
  return rows[0].n;
}

module.exports = { add, listForUser, countByType, quantityByType };
