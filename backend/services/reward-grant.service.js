// services/reward-grant.service.js — applies an engagement reward exactly once.
//
// A "reward" is a plain payload from engagement.json:
//   { xp, seeds, decoration, profileItem, gardenItem, rareItem, fact, boost }
//
// Every grant is recorded in reward_grants under a UNIQUE
// (user_id, grant_type, reference_id) key BEFORE anything is paid, so replaying
// the same milestone, achievement, streak or challenge writes no second row and
// pays nothing. Mystery rewards are the one exception: they are recorded as
// 'pending' and only rolled and paid when the member reveals them — once.
//
// Points are deliberately NOT part of an engagement payload. Points are the
// wallet currency and stay owned by reward-engine.service.js; engagement XP is a
// separate, never-spent progression value. That keeps the two economies from
// double-paying for the same milestone.
const engagementConfig = require("./engagement-config.service");
const grantModel = require("../models/reward-grant.model");
const inventoryModel = require("../models/user-inventory.model");
const boostModel = require("../models/user-boost.model");
const userModel = require("../models/user.model");

const ITEM_TYPE_BY_KEY = {
  seeds: "seed",
  decoration: "decoration",
  profileItem: "profile",
  gardenItem: "garden",
  rareItem: "rare",
  fact: "fact",
};

/**
 * Pays out a payload. Must run inside withTransaction. Returns the XP credited.
 * Only known keys are honoured — an unknown key in the config is ignored rather
 * than silently mistyped into the inventory.
 */
async function applyPayload(client, userId, payload, { referenceId }) {
  if (!payload) return 0;
  let xp = 0;

  if (Number(payload.xp) > 0) {
    xp = Number(payload.xp);
    await userModel.addXp(client, userId, xp);
  }

  for (const [payloadKey, itemType] of Object.entries(ITEM_TYPE_BY_KEY)) {
    const value = payload[payloadKey];
    if (!value) continue;
    if (payloadKey === "seeds") {
      await inventoryModel.add(client, { userId, itemType, itemKey: "seed", quantity: Number(value) });
    } else {
      await inventoryModel.add(client, { userId, itemType, itemKey: String(value), quantity: 1 });
    }
  }

  if (payload.boost && Number(payload.boost.multiplier) > 0) {
    await boostModel.create(client, {
      userId,
      multiplier: Number(payload.boost.multiplier),
      hours: Number(payload.boost.hours) || 24,
      sourceReference: `${referenceId}:boost`,
    });
  }

  return xp;
}

/**
 * Records and pays a concrete reward. Returns null when the grant already
 * existed (nothing paid) or the payload is empty.
 */
async function grant(client, { userId, grantType, referenceId, sourcePlantId, payload }) {
  if (!payload || Object.keys(payload).length === 0) return null;

  const xp = Number(payload.xp) || 0;
  const row = await grantModel.create(client, {
    userId,
    grantType,
    referenceId,
    sourcePlantId,
    mystery: false,
    payload,
    xp,
  });
  if (!row) return null; // already granted — the unique key stopped a replay

  const applied = await applyPayload(client, userId, payload, { referenceId });
  return { ...row, xp: applied };
}

/** Records a mystery grant. The reward itself is rolled at claim time. */
async function grantMystery(client, { userId, grantType, referenceId, sourcePlantId, pool }) {
  return grantModel.create(client, {
    userId,
    grantType,
    referenceId,
    sourcePlantId,
    mystery: true,
    pool: pool || "milestone",
  });
}

/** Reveals and pays a pending mystery grant. Returns null if it is not pending
 * (already claimed) so the caller can answer "already claimed". */
async function claimMystery(client, grant) {
  const payload = engagementConfig.rollMystery(grant.pool || "milestone");
  const claimed = await grantModel.claim(client, grant.grant_id, {
    payload,
    xp: Number(payload.xp) || 0,
  });
  if (!claimed) return null;

  const applied = await applyPayload(client, grant.user_id, payload, {
    referenceId: `${grant.grant_id}:mystery`,
  });
  return { grant: { ...claimed, xp: applied }, payload };
}

module.exports = { grant, grantMystery, claimMystery, applyPayload };
