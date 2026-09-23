// models/notification.model.js
const { query } = require("../config/db");

async function create({ userId, title, message, type }) {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, title, message, type)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, title, message || null, type]
  );
  return rows[0];
}

async function listByUser(userId) {
  const { rows } = await query(
    "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC",
    [userId]
  );
  return rows;
}

async function findByIdForUser(notificationId, userId) {
  const { rows } = await query(
    "SELECT * FROM notifications WHERE notification_id = $1 AND user_id = $2",
    [notificationId, userId]
  );
  return rows[0] || null;
}

async function markRead(notificationId, userId) {
  const { rows } = await query(
    `UPDATE notifications SET is_read = true
      WHERE notification_id = $1 AND user_id = $2
      RETURNING *`,
    [notificationId, userId]
  );
  return rows[0] || null;
}

async function markAllRead(userId) {
  const { rowCount } = await query(
    "UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false",
    [userId]
  );
  return rowCount;
}

async function countUnread(userId) {
  const { rows } = await query(
    "SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND is_read = false",
    [userId]
  );
  return rows[0].n;
}

module.exports = {
  create,
  listByUser,
  findByIdForUser,
  markRead,
  markAllRead,
  countUnread,
};
