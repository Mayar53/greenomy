// controllers/admin-analytics.controller.js
const analyticsModel = require("../models/analytics.model");

/** Platform-wide counters for the admin dashboard. */
exports.summary = async (req, res) => {
  const [counts, verificationsByDay] = await Promise.all([
    analyticsModel.summary(),
    analyticsModel.verificationsByDay(),
  ]);

  const total = counts.verifications_total;

  res.json({
    users: {
      total: counts.users_total,
      admins: counts.users_admins,
      suspended: counts.users_suspended,
    },
    plants: { total: counts.plants_total, grown: counts.plants_grown },
    verifications: {
      total,
      pending: counts.verifications_pending,
      approved: counts.verifications_approved,
      rejected: counts.verifications_rejected,
      approvalRate: total ? Math.round((counts.verifications_approved / total) * 100) : 0,
    },
    redemptions: {
      total: counts.redemptions_total,
      used: counts.redemptions_used,
      outstanding: counts.redemptions_total - counts.redemptions_used,
    },
    points: {
      earned: counts.points_earned,
      spent: counts.points_spent,
      outstanding: counts.points_earned - counts.points_spent,
    },
    rewards: { total: counts.rewards_total, active: counts.rewards_active },
    partners: { total: counts.partners_total, active: counts.partners_active },
    content: { total: counts.content_total, published: counts.content_published },
    waitlist: { total: counts.waitlist_total },
    verificationsByDay,
  });
};
