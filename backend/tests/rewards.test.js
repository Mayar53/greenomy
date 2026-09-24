// tests/rewards.test.js — points are a deterministic server-side rule, applied
// idempotently: a photo pays for the one milestone it evidences, and the
// journey completion bonus only after every milestone is done.
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let dbDir;
let api;
let adminToken;

before(async () => {
  dbDir = h.createTestDatabase();
  api = await h.startServer();
  adminToken = (await h.loginAdmin(api.base)).token;
});

after(async () => {
  await api.close();
  h.cleanup(dbDir);
});

const { POINTS } = require("../services/reward-engine.service");

async function member() {
  const { token, user } = await h.signup(api.base);
  const plant = await h.createPlant(api.base, token, { canonicalPlantId: "pl-tomato" });
  const journeys = await h.get(api.base, "/journeys", { token });
  const journey = journeys.body.find((entry) => entry.user_plant_id === plant.plant_id);
  return { token, user, plant, journey };
}

async function walletOf(token) {
  const res = await h.get(api.base, "/wallet", { token });
  return res.body.currentPoints;
}

/** Submits a milestone photo (needs a challenge) and returns the record. */
async function submitMilestone(token, plant, milestone, tag) {
  const challenge = await h.issueChallenge(api.base, token, plant.plant_id);
  const res = await h.submitRawPhoto(api.base, token, plant.plant_id, await h.photoDataUrl(tag, { green: true }), {
    milestoneId: milestone.milestone_id,
    challengeId: challenge.challengeId,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

async function approve(verificationId) {
  return h.post(api.base, `/admin/verifications/${verificationId}/approve`, { token: adminToken, body: {} });
}

async function journeyOf(token, journeyId) {
  const res = await h.get(api.base, `/journeys/${journeyId}`, { token });
  return res.body;
}

describe("milestone rewards", () => {
  test("a verified planting milestone pays, and the milestone is marked verified", async () => {
    const { token, user, plant, journey } = await member();
    const planting = journey.milestones[0];

    const verification = await submitMilestone(token, plant, planting, "PLANTING");
    assert.equal(verification.approval_status, "pending", "never paid on submit");

    await approve(verification.verification_id);

    assert.equal(await walletOf(token), POINTS.milestone_planting);

    const refreshed = await journeyOf(token, journey.journey_id);
    const milestone = refreshed.milestones.find((m) => m.milestone_id === planting.milestone_id);
    assert.equal(milestone.verification_status, "verified");
    assert.ok(milestone.completed_at, "the milestone is closed");
    assert.equal(refreshed.current_stage, "planting");

    const { query } = require("../config/db");
    const awards = await query("SELECT award_type FROM reward_awards WHERE user_id = $1", [user.user_id]);
    assert.deepEqual(
      awards.rows.map((row) => row.award_type),
      ["milestone_planting"]
    );
  });

  test("a verified growth milestone pays growth points and advances the stage", async () => {
    const { token, plant, journey } = await member();
    const vegetative = journey.milestones.find((m) => m.stage_key === "vegetative");

    await approve((await submitMilestone(token, plant, vegetative, "VEG")).verification_id);

    assert.equal(await walletOf(token), POINTS.milestone_growth);
    const refreshed = await journeyOf(token, journey.journey_id);
    assert.equal(refreshed.current_stage, "vegetative");
  });

  test("approving the same verification twice pays once", async () => {
    const { token, user, plant, journey } = await member();
    const verification = await submitMilestone(token, plant, journey.milestones[0], "ONCE");

    assert.equal((await approve(verification.verification_id)).status, 200);
    const second = await approve(verification.verification_id);
    assert.equal(second.status, 404, "a non-pending row cannot be approved again");

    assert.equal(await walletOf(token), POINTS.milestone_planting);

    const { query } = require("../config/db");
    const count = await query("SELECT count(*)::int AS n FROM reward_awards WHERE user_id = $1", [user.user_id]);
    assert.equal(count.rows[0].n, 1, "one award row for one milestone");
  });

  test("an incomplete journey pays no completion bonus", async () => {
    const { token, plant, journey } = await member();
    await approve((await submitMilestone(token, plant, journey.milestones[0], "PARTIAL")).verification_id);

    const refreshed = await journeyOf(token, journey.journey_id);
    assert.equal(refreshed.status, "active");

    const { query } = require("../config/db");
    const bonus = await query(
      "SELECT count(*)::int AS n FROM reward_awards WHERE award_type = 'journey_completed' AND journey_id = $1",
      [journey.journey_id]
    );
    assert.equal(bonus.rows[0].n, 0);
  });

  test("a fully verified journey pays every milestone plus the completion bonus", async () => {
    const { token, plant, journey } = await member();
    const milestones = journey.milestones;

    for (let i = 0; i < milestones.length; i += 1) {
      const verification = await submitMilestone(token, plant, milestones[i], `FULL-${i}`);
      assert.equal((await approve(verification.verification_id)).status, 200);
    }

    const growthMilestones = milestones.length - 1; // everything but "planting"
    const expected =
      POINTS.milestone_planting + growthMilestones * POINTS.milestone_growth + POINTS.journey_completed;
    assert.equal(await walletOf(token), expected);

    const refreshed = await journeyOf(token, journey.journey_id);
    assert.equal(refreshed.status, "completed");
    assert.equal(refreshed.current_stage, "harvest");
  });
});

describe("suspicious and rejected submissions earn nothing", () => {
  test("a re-uploaded photo is not auto-approved and pays nothing", async () => {
    const { token, plant } = await member();
    const imageUrl = await h.photoDataUrl("SUSPECT", { green: true });

    const first = await h.submitRawPhoto(api.base, token, plant.plant_id, imageUrl);
    assert.equal(first.body.approval_status, "approved");
    const afterFirst = await walletOf(token);

    const second = await h.submitRawPhoto(api.base, token, plant.plant_id, imageUrl);
    assert.equal(second.body.duplicate_status, "exact");
    assert.equal(second.body.approval_status, "pending");
    assert.equal(second.body.requires_review, true);
    assert.equal(await walletOf(token), afterFirst, "the duplicate earned nothing");
  });

  test("a rejected milestone photo pays nothing and stays open", async () => {
    const { token, plant, journey } = await member();
    const planting = journey.milestones[0];
    const verification = await submitMilestone(token, plant, planting, "REJECTED");

    const rejected = await h.post(api.base, `/admin/verifications/${verification.verification_id}/reject`, {
      token: adminToken,
      body: { reason: "unclear" },
    });
    assert.equal(rejected.status, 200);

    assert.equal(await walletOf(token), 0);

    const refreshed = await journeyOf(token, journey.journey_id);
    const milestone = refreshed.milestones.find((m) => m.milestone_id === planting.milestone_id);
    assert.equal(milestone.verification_status, "rejected");
    assert.equal(milestone.completed_at, null, "the member can try again");
  });
});
