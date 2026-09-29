// controllers/admin-users.controller.js — the member list: searching it, ranking
// it by activity, opening one member in full, and editing them (role, status,
// name, city, and a reasoned points adjustment).
//
// Three limits worth stating, because all are load-bearing:
//   * the OWNER account (mayarraws@gmail.com — the seeded super_admin) cannot be
//     suspended or demoted by anyone, including itself. Otherwise an admin
//     holding users.manage could lock the deployment out of its own way back in;
//   * `super_admin` is not a role this endpoint can grant. The owner is created
//     by the seed, never through the member API, so `users.manage` cannot be
//     turned into a way to mint a second owner;
//   * member PHOTOS need `verifications.review` as well as `users.manage`. They
//     are members' own garden photos, so the permission that already governs
//     looking at them in the review queue governs looking at them here too.
const { withTransaction } = require("../config/db");
const userModel = require("../models/user.model");
const verificationModel = require("../models/verification.model");
const transactionModel = require("../models/point-transaction.model");
const analyticsModel = require("../models/analytics.model");
const permissions = require("../services/permissions.service");

// Deliberately without "super_admin": that role is seeded, not granted here.
const ROLES = ["user", "admin"];
const STATUSES = ["active", "suspended"];

// A manual adjustment is a correction, not a payout channel: it is bounded, and
// it must carry a reason, so the ledger can explain itself to whoever reads it.
const MAX_ADJUSTMENT = 100000;
const MIN_REASON_LENGTH = 3;

// How many of a member's most recent photos the panel carries. Each is a bounded
// inline preview, so this is a payload-size decision as much as a UI one.
const PHOTO_LIMIT = 12;

const DEFAULT_ACTIVE_LIMIT = 10;
const MAX_ACTIVE_LIMIT = 50;

exports.list = async (req, res) => {
  res.json(await userModel.listAll({ search: req.query.search }));
};

/** The busiest members — photos submitted first, then plants grown. */
exports.active = async (req, res) => {
  const asked = Number(req.query.limit);
  const limit = Number.isFinite(asked)
    ? Math.min(Math.max(Math.trunc(asked), 1), MAX_ACTIVE_LIMIT)
    : DEFAULT_ACTIVE_LIMIT;

  res.json(await userModel.listMostActive({ limit }));
};

/**
 * Everything the panel shows about one member: the account, its activity counts,
 * its wallet, and its most recent submissions. The response states whether photos
 * were permitted rather than dropping the section silently, so the UI can say why
 * it is empty.
 */
exports.detail = async (req, res) => {
  const user = await userModel.findById(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const photosPermitted = permissions.can(req.user, "verifications.review");

  const [activity, totals, photos] = await Promise.all([
    analyticsModel.userActivity(user.user_id),
    transactionModel.totalsForUser(user.user_id),
    photosPermitted
      ? verificationModel.listByUserWithPlant(user.user_id, { limit: PHOTO_LIMIT })
      : Promise.resolve([]),
  ]);

  res.json({
    user,
    activity,
    wallet: {
      currentPoints: user.total_points,
      totalEarned: totals.earned,
      totalSpent: totals.spent,
    },
    photosPermitted,
    photosTotal: activity.verifications_total,
    photos,
  });
};

exports.update = async (req, res) => {
  const { role, status, fullName, city } = req.body || {};

  if (role !== undefined && !ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${ROLES.join(", ")}` });
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
  }
  if (fullName !== undefined && typeof fullName !== "string") {
    return res.status(400).json({ error: "fullName must be a string" });
  }
  if (city !== undefined && typeof city !== "string") {
    return res.status(400).json({ error: "city must be a string" });
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

  const user = await userModel.updateAdmin(req.params.id, { role, status, fullName, city });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
};

/**
 * A reasoned, audited correction to a member's points.
 *
 * Points are never moved by rewriting the balance: the ledger row and the new
 * total are written in ONE transaction, exactly like every other points path in
 * this codebase, so the balance can always be explained by its history. The row
 * records who did it (`reference_id`) and why (`description`), and a member can
 * never be pushed below zero.
 */
exports.adjustPoints = async (req, res) => {
  const { delta, reason } = req.body || {};

  // Numeric strings are accepted (a form input is one); booleans and blanks are not.
  const amount = Number(delta);
  const numeric = typeof delta === "number" || typeof delta === "string";
  if (!numeric || !Number.isInteger(amount) || amount === 0) {
    return res.status(400).json({ error: "delta must be a non-zero whole number of points" });
  }
  if (Math.abs(amount) > MAX_ADJUSTMENT) {
    return res.status(400).json({ error: `delta must be at most ${MAX_ADJUSTMENT} points either way` });
  }

  const note = String(reason == null ? "" : reason).trim();
  if (note.length < MIN_REASON_LENGTH) {
    return res.status(400).json({ error: "a reason is required so the ledger explains itself" });
  }

  const target = await userModel.findById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });

  const result = await withTransaction(async (client) => {
    // The same row lock redemption takes, so a concurrent spend cannot race this.
    const locked = await userModel.lockForUpdate(client, req.params.id);
    if (!locked) return { missing: true };

    if (locked.total_points + amount < 0) {
      return { short: locked.total_points };
    }

    await transactionModel.create(client, {
      userId: req.params.id,
      amount,
      transactionType: "admin_adjustment",
      referenceId: req.user.id,
      description: note,
    });
    const balance = await userModel.addPoints(client, req.params.id, amount);
    return { balance };
  });

  if (result.missing) return res.status(404).json({ error: "User not found" });
  if (result.short !== undefined) {
    return res.status(409).json({
      error: `That would take the balance below zero — the member has ${result.short} points`,
    });
  }

  res.json({ user_id: req.params.id, adjusted: amount, total_points: result.balance });
};
