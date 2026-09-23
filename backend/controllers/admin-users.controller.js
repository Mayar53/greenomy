// controllers/admin-users.controller.js
const userModel = require("../models/user.model");

const ROLES = ["user", "admin", "super_admin"];
const STATUSES = ["active", "suspended"];

exports.list = async (req, res) => {
  res.json(await userModel.listAll());
};

exports.update = async (req, res) => {
  const { role, status } = req.body || {};

  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
  }
  // Locking yourself out is never what an admin meant to do.
  if (req.params.id === req.user.id && (status === "suspended" || role === "user")) {
    return res.status(409).json({ error: "You cannot suspend or demote your own account" });
  }

  const user = await userModel.updateAdmin(req.params.id, { role, status });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};
