// controllers/admin-users.controller.js — the member list, and suspending or
// restoring an account.
//
// Two limits worth stating, because both are load-bearing:
//   * the OWNER account (mayarraws@gmail.com — the seeded super_admin) cannot be
//     suspended or demoted by anyone, including itself. Otherwise an admin
//     holding users.manage could lock the deployment out of its own way back in;
//   * `super_admin` is not a role this endpoint can grant. The owner is created
//     by the seed, never through the member API, so `users.manage` cannot be
//     turned into a way to mint a second owner.
const userModel = require("../models/user.model");
const permissions = require("../services/permissions.service");

// Deliberately without "super_admin": that role is seeded, not granted here.
const ROLES = ["user", "admin"];
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

  const target = await userModel.findById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });

  // The owner is off limits from here — for every caller.
  const problem = permissions.ownerChangeProblem(target, { role, status });
  if (problem) return res.status(403).json({ error: problem });

  const user = await userModel.updateAdmin(req.params.id, { role, status });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};
