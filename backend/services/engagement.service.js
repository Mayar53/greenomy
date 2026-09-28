// services/engagement.service.js — the engagement core: care actions, streaks,
// achievements, seasonal challenges, mystery rewards and the dashboard summary.
//
// All rules come from engagement.json via engagement-config.service.js; all
// payouts go through reward-grant.service.js (idempotent) and all XP lands on
// users.lifetime_xp through user.model.addXp. Nothing here is hard-coded per
// plant: a plant's milestone reward is resolved from its own template/id.
const { withTransaction, query } = require("../config/db");
const engagementConfig = require("./engagement-config.service");
const rewardGrantService = require("./reward-grant.service");
const gardenService = require("./garden.service");
const plantModel = require("../models/plant.model");
const userModel = require("../models/user.model");
const careModel = require("../models/care-action.model");
const inventoryModel = require("../models/user-inventory.model");
const achievementModel = require("../models/user-achievement.model");
const challengeModel = require("../models/user-challenge.model");
const grantModel = require("../models/reward-grant.model");
const boostModel = require("../models/user-boost.model");

/* ------------------------------------------------------------------ dates -- */
/** pg hands back a Date for a date column, PGlite a string; normalise to
 * 'YYYY-MM-DD' either way so the streak arithmetic below is reliable. */
function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dayDiff(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

/** The streak after logging care today: continues on a consecutive day, resets
 * after a gap, and is unchanged if care was already logged today. */
function nextStreak(previousDays, previousLast, todayIso) {
  const prevDays = Number(previousDays) || 0;
  if (!previousLast) return { days: 1, last: todayIso };
  const gap = dayDiff(previousLast, todayIso);
  if (gap === 0) return { days: Math.max(1, prevDays), last: todayIso };
  if (gap === 1) return { days: prevDays + 1, last: todayIso };
  return { days: 1, last: todayIso };
}

/* ------------------------------------------------------------------ stats -- */
/**
 * Every number an achievement rule can ask about, in one place. Pass the
 * transaction client when called during a write so it sees uncommitted changes.
 */
async function stats(userId, client) {
  const exec = (text, params) => (client ? client.query(text, params) : query(text, params));

  const userRes = await exec("SELECT lifetime_xp, care_streak_days FROM users WHERE user_id = $1", [userId]);
  const userRow = userRes.rows[0] || { lifetime_xp: 0, care_streak_days: 0 };

  const plantsRes = await exec("SELECT count(*)::int AS n FROM plants WHERE user_id = $1", [userId]);
  const methodRes = await exec(
    "SELECT planting_method, count(*)::int AS n FROM plants WHERE user_id = $1 GROUP BY planting_method",
    [userId]
  );
  const careCount = await careModel.countForUser(userId, client);
  const distinctPlants = await careModel.distinctPlantsCared(userId, client);
  const journeysRes = await exec(
    "SELECT count(*)::int AS n FROM journeys WHERE user_id = $1 AND status = 'completed'",
    [userId]
  );
  const verifRes = await exec(
    "SELECT count(*)::int AS n FROM verifications WHERE user_id = $1 AND approval_status = 'approved'",
    [userId]
  );
  const healthyRes = await exec(
    `SELECT count(DISTINCT p.plant_id)::int AS n
       FROM plants p
       JOIN verifications v ON v.plant_id = p.plant_id AND v.approval_status = 'approved'
      WHERE p.user_id = $1`,
    [userId]
  );
  const stageRes = await exec(
    `SELECT DISTINCT m.stage_key
       FROM journey_milestones m
       JOIN journeys j ON j.journey_id = m.journey_id
      WHERE j.user_id = $1 AND m.completed_at IS NOT NULL`,
    [userId]
  );
  const factsOwned = await inventoryModel.countByType(userId, "fact", client);
  const mysteriesClaimed = await grantModel.countClaimedMysteries(userId, client);
  const challengesCompleted = await challengeModel.countCompleted(userId, client);

  const stages = stageRes.rows.map((row) => row.stage_key);
  const maxStageIndex = stages.reduce((max, key) => Math.max(max, engagementConfig.stageIndex(key)), -1);
  const methods = new Map(methodRes.rows.map((row) => [row.planting_method, row.n]));
  const garden = gardenService.levelFor(userRow.lifetime_xp);

  return {
    plants: plantsRes.rows[0].n,
    careCount,
    distinctPlants,
    journeysCompleted: journeysRes.rows[0].n,
    approvedVerifications: verifRes.rows[0].n,
    healthyPlants: healthyRes.rows[0].n,
    stages,
    maxStageIndex,
    factsOwned,
    mysteriesClaimed,
    challengesCompleted,
    gardenLevel: garden.level,
    xp: Number(userRow.lifetime_xp) || 0,
    streak: Number(userRow.care_streak_days) || 0,
    plantsWithMethods(methodList) {
      return (methodList || []).reduce((sum, method) => sum + (methods.get(method) || 0), 0);
    },
  };
}

/** Whether a single achievement rule is satisfied by the snapshot. */
function ruleMet(rule, s) {
  if (!rule) return false;
  const count = Number(rule.count) || 1;
  switch (rule.type) {
    case "plants_created":
      return s.plants >= count;
    case "care_actions":
      return s.careCount >= count;
    case "distinct_plants_cared":
      return s.distinctPlants >= count;
    case "stage_reached":
      return (s.stages || []).filter((stage) => (rule.stages || []).includes(stage)).length >= count;
    case "journeys_completed":
      return s.journeysCompleted >= count;
    case "verifications_approved":
      return s.approvedVerifications >= count;
    case "healthy_plants":
      return s.healthyPlants >= count;
    case "care_streak":
      return s.streak >= count;
    case "garden_level":
      return s.gardenLevel >= count;
    case "mysteries_claimed":
      return s.mysteriesClaimed >= count;
    case "challenges_completed":
      return s.challengesCompleted >= count;
    case "facts_owned":
      return s.factsOwned >= count;
    case "planting_methods":
      return s.plantsWithMethods(rule.methods) >= count;
    default:
      return false;
  }
}

/** A reward payload may ask for a mystery bonus alongside its concrete rewards.
 * This pays the concrete part and records the mystery as pending, in one place,
 * so every source (milestone, challenge, streak, achievement) behaves the same. */
async function grantWithMystery(client, { userId, grantType, referenceId, sourcePlantId, payload, pool }) {
  const { mystery, ...concrete } = payload || {};
  let result = null;

  if (Object.keys(concrete).length) {
    result = await rewardGrantService.grant(client, {
      userId,
      grantType,
      referenceId,
      sourcePlantId,
      payload: concrete,
    });
  }

  if (mystery) {
    await rewardGrantService.grantMystery(client, {
      userId,
      grantType,
      referenceId: `${referenceId}:mystery`,
      sourcePlantId,
      pool: pool || "milestone",
    });
  }

  return result;
}

/** Unlocks every achievement whose rule now holds. Returns the newly unlocked
 * ones. Must run inside withTransaction. */
async function evaluateAchievements(client, userId) {
  const already = new Set((await achievementModel.listForUser(userId, client)).map((row) => row.achievement_id));
  const remaining = engagementConfig.achievements().filter((entry) => !already.has(entry.id));
  if (!remaining.length) return [];

  const snapshot = await stats(userId, client);
  const unlocked = [];

  for (const entry of remaining) {
    if (!ruleMet(entry.rule, snapshot)) continue;
    const row = await achievementModel.unlock(client, { userId, achievementId: entry.id });
    if (!row) continue;
    await grantWithMystery(client, {
      userId,
      grantType: "achievement",
      referenceId: entry.id,
      payload: entry.reward || {},
    });
    unlocked.push(publicAchievement(entry, row.unlocked_at));
  }

  return unlocked;
}

function publicAchievement(entry, unlockedAt) {
  return {
    id: entry.id,
    icon: entry.icon || "trophy",
    name: entry.name,
    description: entry.description,
    secret: entry.secret === true,
    i18n: entry.i18n || null,
    unlocked: true,
    unlockedAt,
    reward: engagementConfig.describePayload(entry.reward || {}),
  };
}

/* ------------------------------------------------------------- milestones -- */
/** The catalog row behind a member's plant, when it is linked to one. */
async function templateForPlant(client, plantId) {
  const { rows } = await client.query(
    `SELECT c.stage_template
       FROM plants p
       LEFT JOIN plant_catalog c ON c.id = p.canonical_plant_id
      WHERE p.plant_id = $1`,
    [plantId]
  );
  return rows[0] ? rows[0].stage_template : null;
}

/** Days until the next watering, from the plant's own catalog water need. */
async function wateringIntervalDays(client, plantId) {
  const { rows } = await client.query(
    `SELECT c.water
       FROM plants p
       LEFT JOIN plant_catalog c ON c.id = p.canonical_plant_id
      WHERE p.plant_id = $1`,
    [plantId]
  );
  return engagementConfig.reminderIntervalDays(rows[0] ? rows[0].water : null);
}

/** Pays the reward for one completed milestone (or records its mystery grant).
 * Must run inside withTransaction. Idempotent on the milestone id. */
async function applyMilestoneRewards(client, { userId, plantId, milestoneId, stageKey }) {
  const template = await templateForPlant(client, plantId);
  const reward = engagementConfig.milestoneReward({ plantId, template, stageKey });
  if (!reward || !Object.keys(reward).length) return null;

  return grantWithMystery(client, {
    userId,
    grantType: "milestone",
    referenceId: milestoneId,
    sourcePlantId: plantId,
    payload: reward,
    pool: "milestone",
  });
}

/** Used by the journey controller (no enclosing transaction): pays a milestone's
 * reward and re-checks achievements in one transaction. */
async function onMilestoneCompleted(userId, { plantId, milestoneId, stageKey }) {
  return withTransaction(async (client) => {
    const grant = await applyMilestoneRewards(client, { userId, plantId, milestoneId, stageKey });
    const achievements = await evaluateAchievements(client, userId);
    return { grant, achievements };
  });
}

/** A new plant is an event achievements and plant-creation challenges care
 * about (First Life, propagation, "grow something from seed"). */
async function onPlantCreated(userId) {
  return withTransaction(async (client) => {
    const challenges = await updateChallenges(client, userId);
    const achievements = await evaluateAchievements(client, userId);
    return { challenges, achievements };
  });
}

/* ---------------------------------------------------------------- care ----- */
/** How far a challenge requirement is met, derived from real activity. */
async function challengeProgress(client, userId, challenge) {
  const requirement = challenge.requirement || {};

  if (requirement.type === "care_count") {
    return careModel.countByAction(
      userId,
      requirement.action,
      { from: challenge.startDate, to: challenge.endDate },
      client
    );
  }

  if (requirement.type === "plant_created") {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n
         FROM plants
        WHERE user_id = $1
          AND ($2::text IS NULL OR planting_method = $2)
          AND ($3::date IS NULL OR created_at >= $3::date)
          AND ($4::date IS NULL OR created_at < ($4::date + interval '1 day'))`,
      [userId, requirement.plantingMethod || null, challenge.startDate || null, challenge.endDate || null]
    );
    return rows[0].n;
  }

  if (requirement.type === "plant_category") {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n
         FROM plants p
         JOIN plant_catalog c ON c.id = p.canonical_plant_id
        WHERE p.user_id = $1 AND c.category = $2
          AND ($3::date IS NULL OR p.created_at >= $3::date)
          AND ($4::date IS NULL OR p.created_at < ($4::date + interval '1 day'))`,
      [userId, requirement.category || null, challenge.startDate || null, challenge.endDate || null]
    );
    return rows[0].n;
  }

  return 0;
}

/** Refreshes the member's progress on every currently-running challenge. */
async function updateChallenges(client, userId, now = new Date()) {
  const results = [];
  for (const challenge of engagementConfig.challenges()) {
    if (engagementConfig.challengeWindow(challenge, now) !== "active") continue;
    const progress = await challengeProgress(client, userId, challenge);
    const target = Number(challenge.requirement && challenge.requirement.count) || 1;
    const row = await challengeModel.upsertProgress(client, {
      userId,
      challengeId: challenge.id,
      progress,
      completedAt: progress >= target ? new Date() : null,
    });
    results.push({ challengeId: challenge.id, progress: row.progress, completed: !!row.completed_at });
  }
  return results;
}

/**
 * Records a care action. One action counts per plant/type/day (the DB unique key
 * enforces it), and it is the ONLY thing that advances a care streak — opening
 * the app never does. Pays care XP (scaled by an active boost), advances the
 * streak, refreshes challenges and re-checks achievements, all atomically.
 */
async function recordCare(userId, { plantId, actionType, note }) {
  const action = engagementConfig.careAction(actionType);
  if (!action) return { error: "unknown_action" };

  const plant = await plantModel.findByIdForUser(plantId, userId);
  if (!plant) return { error: "plant_not_found" };

  return withTransaction(async (client) => {
    const care = await careModel.create(client, { userId, plantId, actionType, note });
    if (!care) {
      const userRes = await client.query("SELECT care_streak_days FROM users WHERE user_id = $1", [userId]);
      return {
        duplicate: true,
        xp: 0,
        streak: Number(userRes.rows[0] && userRes.rows[0].care_streak_days) || 0,
        achievements: [],
        challenges: [],
      };
    }

    const boost = await boostModel.activeForUser(userId, client);
    const multiplier = boost ? Number(boost.multiplier) || 1 : 1;
    const xp = Math.max(1, Math.round((action.xp || 0) * multiplier));

    await grantWithMystery(client, {
      userId,
      grantType: "care",
      referenceId: care.care_id,
      sourcePlantId: plantId,
      payload: { xp },
    });
    await careModel.setXpAwarded(client, care.care_id, xp);

    // A watering also schedules the next one, so reminders act on real data
    // instead of a field nobody ever sets.
    if (actionType === "watering") {
      const intervalDays = await wateringIntervalDays(client, plantId);
      await plantModel.setWatering(client, plantId, {
        lastWatered: new Date(),
        nextWatering: new Date(Date.now() + intervalDays * 86400000),
      });
    }

    const userRes = await client.query("SELECT care_streak_days, care_streak_last FROM users WHERE user_id = $1", [userId]);
    const previous = userRes.rows[0] || {};
    const today = asDate(care.care_date);
    const streak = nextStreak(previous.care_streak_days, asDate(previous.care_streak_last), today);
    await userModel.setCareStreak(client, userId, streak.days, today);

    for (const entry of engagementConfig.streaks()) {
      if (streak.days < entry.days) continue;
      const { days, ...payload } = entry;
      await grantWithMystery(client, {
        userId,
        grantType: "streak",
        referenceId: `streak-${days}`,
        payload,
      });
    }

    const challenges = await updateChallenges(client, userId);
    const achievements = await evaluateAchievements(client, userId);

    return {
      duplicate: false,
      xp,
      boosted: multiplier > 1,
      streak: streak.days,
      care: { ...care, xp_awarded: xp },
      achievements,
      challenges,
    };
  });
}

/* --------------------------------------------------------- challenges ------ */
async function claimChallenge(userId, challengeId) {
  const challenge = engagementConfig.challenge(challengeId);
  if (!challenge) return { error: "not_found" };

  return withTransaction(async (client) => {
    const row = await challengeModel.claim(client, userId, challengeId);
    if (!row) return { error: "not_claimable" };

    const grant = await grantWithMystery(client, {
      userId,
      grantType: "challenge",
      referenceId: challengeId,
      payload: challenge.reward || {},
      pool: "challenge",
    });
    const achievements = await evaluateAchievements(client, userId);
    return { challenge: row, grant, achievements };
  });
}

/* ------------------------------------------------------------ mystery ------ */
async function claimMystery(userId, grantId) {
  return withTransaction(async (client) => {
    const grant = await grantModel.findForUser(grantId, userId, client);
    if (!grant) return { error: "not_found" };
    if (grant.status !== "pending") return { error: "already_claimed" };

    const claimed = await rewardGrantService.claimMystery(client, grant);
    if (!claimed) return { error: "already_claimed" };

    const achievements = await evaluateAchievements(client, userId);
    return {
      grant: claimed.grant,
      payload: claimed.payload,
      rewards: engagementConfig.describePayload(claimed.payload),
      achievements,
    };
  });
}

/* ------------------------------------------------------------ summary ------ */
/** Everything the dashboard and the journey UI need, in one payload. */
async function summary(userId) {
  const user = await userModel.findById(userId);
  if (!user) return null;

  const xp = Number(user.lifetime_xp) || 0;
  const garden = gardenService.progressFor(xp);

  const unlockedRows = await achievementModel.listForUser(userId);
  const unlockedMap = new Map(unlockedRows.map((row) => [row.achievement_id, row.unlocked_at]));

  const achievements = engagementConfig.achievements().map((entry) => {
    const unlockedAt = unlockedMap.get(entry.id) || null;
    const unlocked = !!unlockedAt;
    const base = {
      id: entry.id,
      icon: entry.icon || "trophy",
      secret: entry.secret === true,
      unlocked,
      unlockedAt,
      reward: engagementConfig.describePayload(entry.reward || {}),
    };
    // A locked secret keeps its name to itself until it is earned.
    if (!unlocked && entry.secret) return { ...base, hidden: true, name: null, description: null, i18n: null };
    return { ...base, hidden: false, name: entry.name, description: entry.description, i18n: entry.i18n || null };
  });

  const now = new Date();
  const challengeRows = await challengeModel.listForUser(userId);
  const byId = new Map(challengeRows.map((row) => [row.challenge_id, row]));
  const challenges = engagementConfig.challenges().map((entry) => {
    const row = byId.get(entry.id) || {};
    const requirement = entry.requirement || {};
    return {
      id: entry.id,
      icon: entry.icon || "trophy",
      title: entry.title,
      description: entry.description,
      i18n: entry.i18n || null,
      startDate: entry.startDate,
      endDate: entry.endDate,
      status: engagementConfig.challengeWindow(entry, now),
      target: Number(requirement.count) || 1,
      progress: Number(row.progress) || 0,
      completed: !!row.completed_at,
      claimed: !!row.claimed_at,
      canClaim: !!row.completed_at && !row.claimed_at,
      reward: engagementConfig.describePayload(entry.reward || {}),
    };
  });

  const pendingGrants = await grantModel.listPending(userId);
  const pendingMysteries = pendingGrants.map((grant) => ({
    grantId: grant.grant_id,
    grantType: grant.grant_type,
    createdAt: grant.created_at,
  }));

  const inventoryRows = await inventoryModel.listForUser(userId);
  const inventory = inventoryRows.map((row) => ({
    type: row.item_type,
    key: row.item_key,
    quantity: row.quantity,
    firstAcquiredAt: row.first_acquired_at,
    ...engagementConfig.describeItem(row.item_type, row.item_key),
  }));

  const recentRows = await grantModel.listRecent(userId, { limit: 8 });
  const recentRewards = recentRows.map((row) => ({
    grantId: row.grant_id,
    grantType: row.grant_type,
    mystery: row.mystery,
    xp: row.xp,
    createdAt: row.created_at,
    rewards: engagementConfig.describePayload(row.payload),
  }));

  return {
    garden,
    streak: {
      days: Number(user.care_streak_days) || 0,
      last: asDate(user.care_streak_last),
      milestones: engagementConfig.streaks(),
    },
    careActions: engagementConfig.careActions(),
    achievements,
    challenges,
    pendingMysteries,
    inventory,
    recentRewards,
  };
}

module.exports = {
  summary,
  stats,
  evaluateAchievements,
  applyMilestoneRewards,
  onMilestoneCompleted,
  onPlantCreated,
  recordCare,
  claimChallenge,
  claimMystery,
  updateChallenges,
  nextStreak,
};
