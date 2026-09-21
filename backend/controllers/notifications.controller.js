const db = require("../database/mock-data");

exports.list = (req, res) => {
  res.json((db.notifications || []).filter((n) => n.user_id === req.user.id));
};

exports.markRead = (req, res) => {
  const notification = (db.notifications || []).find((n) => n.notification_id === req.params.id);
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  notification.is_read = true;
  res.json(notification);
};
