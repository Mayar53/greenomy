// controllers/notifications.controller.js
const notificationModel = require("../models/notification.model");
const deviceTokenModel = require("../models/device-token.model");

exports.list = async (req, res) => {
  res.json(await notificationModel.listByUser(req.user.id));
};

exports.unreadCount = async (req, res) => {
  res.json({ unread: await notificationModel.countUnread(req.user.id) });
};

exports.markRead = async (req, res) => {
  const notification = await notificationModel.markRead(req.params.id, req.user.id);
  if (!notification) return res.status(404).json({ error: "Notification not found" });
  res.json(notification);
};

exports.markAllRead = async (req, res) => {
  res.json({ updated: await notificationModel.markAllRead(req.user.id) });
};

/** Registers a device for push delivery. Upsert, so re-registering is safe. */
exports.registerDevice = async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token) return res.status(400).json({ error: "token is required" });

  const device = await deviceTokenModel.register({ userId: req.user.id, token, platform });
  res.status(201).json(device);
};

exports.unregisterDevice = async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "token is required" });

  await deviceTokenModel.remove(token);
  res.status(204).end();
};
