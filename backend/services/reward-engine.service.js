// services/reward-engine.service.js — the only place points are decided.
//
// The flow is deterministic and server-side:
//
//   photo submitted -> verification result -> RULES -> points -> reward_awards
//
// The AI never awards anything; it only contributes signals to the verification
// result. Two properties matter and are enforced by the database, not by hope:
//
//   idempotent  reward_awards has UNIQUE (user, award_type, reference_id), so a
//               replayed approval writes no second row and pays nothing
//   rule-based  points come from POINTS below, never from a client value
const rewardAwardModel = require("../models/reward-award.model");
const userModel = require("../models/user.model");
const transactionModel = require("../models/point-transaction.model");
const journeyModel = require("../models/journey.model");
const engagementService = require("./engagement.service");

// What each outcome is worth. A single photo never pays a journey's full total:
// it pays for the one milestone it evidences, and the completion bonus is
// separate and only after every milestone is done.
const POINTS = {
  photo_verified: Number(process.env.REWARD_PHOTO_POINTS || 30),
  milestone_planting: Number(process.env.REWARD_PLANTING_POINTS || 20),
  milestone_growth: Number(process.env.REWARD_GROWTH_POINTS || 40),
  journey_completed: Number(process.env.REWARD_JOURNEY_COMPLETE_POINTS || 100),
};

// Legacy ledger types are kept for an approved photo so the wallet's existing
// labels/rows keep working; milestone rewards use their own type.
const LEDGER_TYPE = {
  photo_verified: "verification_approved",
  milestone_planting: "reward_earned",
  milestone_growth: "reward_earned",
  journey_completed: "reward_earned",
};

/**
 * Grants an award once. Must run inside withTransaction with the balance update.
 * Returns the award, or null when this exact award already exists (or the rule
 * has no points) — in which case nothing is paid.
 */
async function grant(client, { userId, journeyId, milestoneId, awardType, referenceId }) {
  const points = POINTS[awardType];
  if (!points || points <= 0) return null;

  const award = await rewardAwardModel.create(client, {
    userId,
    journeyId: journeyId || null,
    milestoneId: milestoneId || null,
    awardType,
    points,
    referenceId,
  });
  if (!award) return null; // already granted — the unique key stopped a replay

  await userModel.addPoints(client, userId, points);
  await transactionModel.create(client, {
    userId,
    amount: points,
    transactionType: LEDGER_TYPE[awardType] || "reward_earned",
    referenceId,
    description: `Reward: ${awardType.replace(/_/g, " ")}`,
  });
  return award;
}

/**
 * Applies the reward rules for an APPROVED verification.
 *
 *   plain photo        one photo_verified award
 *   milestone photo    completes + verifies the milestone, awards the milestone
 *                      reward, and — once every milestone is done — completes
 *                      the journey and awards the completion bonus
 *
 * Must run inside withTransaction. Returns the awards granted (possibly none).
 */
async function onVerificationApproved(client, verification) {
  const awards = [];
  const userId = verification.user_id;

  // A photo that evidences no milestone pays NOTHING.
  //
  // This is the rule that stops one picture — an internet photo, someone else's
  // plant, a frame reused from another planting — from being worth points on its
  // own. Points come from a verified JOURNEY, not from an image: identity ("is
  // this a tomato?") and ownership ("is this the tomato you have been growing?")
  // are separate questions, and only the second one earns anything.
  if (!verification.milestone_id) return awards;

  const { rows } = await client.query(
    `SELECT m.milestone_id, m.journey_id, m.stage_key, j.user_plant_id
       FROM journey_milestones m
       JOIN journeys j ON j.journey_id = m.journey_id
      WHERE m.milestone_id = $1`,
    [verification.milestone_id]
  );
  const milestone = rows[0];
  if (!milestone) return awards;

  // The approved photo is the evidence: close the milestone as verified.
  await journeyModel.completeMilestone(client, milestone.milestone_id, {
    verificationId: verification.verification_id,
    verificationStatus: "verified",
  });

  const awardType = milestone.stage_key === "planting" ? "milestone_planting" : "milestone_growth";
  const award = await grant(client, {
    userId,
    journeyId: milestone.journey_id,
    milestoneId: milestone.milestone_id,
    awardType,
    referenceId: milestone.milestone_id,
  });
  if (award) awards.push(award);

  // Advance the journey to the furthest stage reached.
  const furthest = await client.query(
    `SELECT stage_key FROM journey_milestones
      WHERE journey_id = $1 AND completed_at IS NOT NULL
      ORDER BY sort_order DESC LIMIT 1`,
    [milestone.journey_id]
  );
  if (furthest.rows[0]) await journeyModel.setStage(client, milestone.journey_id, furthest.rows[0].stage_key);

  // Completion bonus only when nothing is left open.
  const open = await client.query(
    "SELECT count(*)::int AS n FROM journey_milestones WHERE journey_id = $1 AND completed_at IS NULL",
    [milestone.journey_id]
  );
  if (open.rows[0].n === 0) {
    const completed = await journeyModel.complete(client, milestone.journey_id);
    if (completed) {
      const completionAward = await grant(client, {
        userId,
        journeyId: milestone.journey_id,
        awardType: "journey_completed",
        referenceId: milestone.journey_id,
      });
      if (completionAward) awards.push(completionAward);
    }
  }

  // Engagement layer: the milestone's own rewards (XP, seeds, decorations,
  // facts, boosts or a mystery reward) from engagement.json, then a re-check of
  // every achievement rule. Both are idempotent on the milestone id, so a
  // replayed approval pays neither twice.
  await engagementService.applyMilestoneRewards(client, {
    userId,
    plantId: milestone.user_plant_id,
    milestoneId: milestone.milestone_id,
    stageKey: milestone.stage_key,
  });
  await engagementService.evaluateAchievements(client, userId);

  return awards;
}

/** A rejected photo pays nothing; a milestone it was tied to goes back to being
 * open so the member can try again with a better shot. */
async function onVerificationRejected(client, verification) {
  if (!verification.milestone_id) return;
  await journeyModel.setMilestoneVerification(client, verification.milestone_id, {
    verificationStatus: "rejected",
  });
}

module.exports = { POINTS, grant, onVerificationApproved, onVerificationRejected };
