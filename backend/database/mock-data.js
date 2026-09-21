// database/mock-data.js — in-memory demo data used when PostgreSQL isn't
// configured yet, so the API is runnable and testable end-to-end during
// early development. Replace with real model/query calls in services/.
const path = require("path");
const rewardsSeed = require(path.join(__dirname, "../../rewards.json"));
const greenHubSeed = require(path.join(__dirname, "../../greenhub.json"));

module.exports = {
  users: [],
  plants: [],
  verifications: [],
  partners: [
    { partner_id: "p1", name: "Green Bean Coffee", logo_url: null, website: null, is_active: true },
  ],
  rewards: rewardsSeed.map((r) => ({
    reward_id: r.id,
    partner: r.partner,
    title: r.title,
    description: r.description,
    points_required: r.pointsRequired,
    expires_at: r.expiresAt,
    is_active: r.isActive,
    i18n: r.i18n,
  })),
  pointTransactions: [],
  redemptions: [],
  waitlist: [],
  greenHub: greenHubSeed,
  impact: { plantsGrown: 12483, seedsStarted: 18921, co2ImpactKg: 4320, members: 2840 },
};
