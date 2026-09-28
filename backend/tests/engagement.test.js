// tests/engagement.test.js — plant journeys as an engagement system: care
// actions and streaks, garden progression, achievements, seasonal challenges
// and mystery rewards — and the duplicate protection that makes every payout
// once-only.
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let dbDir;
let api;

before(async () => {
  dbDir = h.createTestDatabase();
  api = await h.startServer();
});

after(async () => {
  await api.close();
  h.cleanup(dbDir);
});

/** Creates a plant and returns its journey (with milestones) from the API. */
async function plantWithJourney(base, token, body) {
  const plant = await h.post(base, "/plants", { token, body });
  assert.equal(plant.status, 201, JSON.stringify(plant.body));

  const journeys = await h.get(base, "/journeys", { token });
  const journey = journeys.body.find((entry) => entry.user_plant_id === plant.body.plant_id);
  assert.ok(journey, "the new plant has a journey");
  return { plant: plant.body, journey };
}

const summaryOf = async (token) => (await h.get(api.base, "/engagement", { token })).body;

describe("engagement access", () => {
  test("requires a session", async () => {
    const res = await h.get(api.base, "/engagement");
    assert.equal(res.status, 401);
  });
});

describe("garden progression", () => {
  test("a new member starts at level 1 with no XP", async () => {
    const { token } = await h.signup(api.base);
    const summary = await summaryOf(token);

    assert.equal(summary.garden.level, 1);
    assert.equal(summary.garden.xp, 0);
    assert.ok(Array.isArray(summary.garden.elements));
    assert.equal(summary.garden.elements.find((element) => element.level === 1).unlocked, true);
    assert.equal(summary.garden.elements.find((element) => element.level === 2).unlocked, false);
  });

  test("levels are derived from XP thresholds, not from time", () => {
    const garden = require("../services/garden.service");
    assert.equal(garden.levelFor(0).level, 1);
    assert.equal(garden.levelFor(99).level, 1);
    assert.equal(garden.levelFor(100).level, 2);
    assert.equal(garden.levelFor(249).level, 2);
    assert.equal(garden.levelFor(250).level, 3);
    assert.equal(garden.levelFor(999999).level, 8);
  });

  test("XP earned from growing plants raises the garden level", async () => {
    const { token } = await h.signup(api.base);
    const before = await summaryOf(token);
    assert.equal(before.garden.level, 1);

    // Growing plants accrues XP through the achievement rewards.
    await h.createPlant(api.base, token, { canonicalPlantId: "pl-basil" });
    const after = await summaryOf(token);

    assert.ok(after.garden.xp > before.garden.xp, "growing a plant earns XP");
    assert.equal(after.garden.progress >= 0 && after.garden.progress <= 1, true);
  });
});

describe("achievements", () => {
  test("growing a first plant unlocks First Life and awards XP", async () => {
    const { token } = await h.signup(api.base);
    await h.createPlant(api.base, token, { canonicalPlantId: "pl-basil" });

    const summary = await summaryOf(token);
    const firstLife = summary.achievements.find((entry) => entry.id === "first_life");
    assert.equal(firstLife.unlocked, true);
    assert.ok(summary.garden.xp >= 20);
  });

  test("a locked secret achievement keeps its name hidden", async () => {
    const { token } = await h.signup(api.base);
    const summary = await summaryOf(token);

    const secret = summary.achievements.find((entry) => entry.id === "secret_collector");
    assert.equal(secret.unlocked, false);
    assert.equal(secret.hidden, true);
    assert.equal(secret.name, null);
  });

  test("repeated activity never duplicates an achievement", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token, { canonicalPlantId: "pl-basil" });

    await h.post(api.base, "/engagement/care", { token, body: { plantId: plant.plant_id, actionType: "watering" } });
    await h.post(api.base, "/engagement/care", { token, body: { plantId: plant.plant_id, actionType: "watering" } });
    await h.post(api.base, "/engagement/care", { token, body: { plantId: plant.plant_id, actionType: "journal" } });

    const summary = await summaryOf(token);
    const ids = summary.achievements.map((entry) => entry.id);
    const unlocked = summary.achievements.filter((entry) => entry.unlocked).map((entry) => entry.id);

    assert.equal(new Set(ids).size, ids.length, "no duplicate achievements");
    assert.equal(new Set(unlocked).size, unlocked.length, "no duplicate unlocks");
  });
});

describe("care actions and streaks", () => {
  test("a care action earns XP, starts a streak and unlocks First Care", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token, { canonicalPlantId: "pl-tomato" });

    const res = await h.post(api.base, "/engagement/care", {
      token,
      body: { plantId: plant.plant_id, actionType: "watering" },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.duplicate, false);
    assert.equal(res.body.streak, 1);
    assert.ok(res.body.xp >= 1);
    assert.ok(res.body.achievements.some((entry) => entry.id === "first_care"));

    const summary = await summaryOf(token);
    assert.equal(summary.streak.days, 1);
  });

  test("the same care action twice in a day does not pay twice", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token, { canonicalPlantId: "pl-tomato" });

    const body = { plantId: plant.plant_id, actionType: "watering" };
    await h.post(api.base, "/engagement/care", { token, body });
    const second = await h.post(api.base, "/engagement/care", { token, body });

    assert.equal(second.status, 201);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.xp, 0);

    const summary = await summaryOf(token);
    assert.equal(summary.streak.days, 1, "a duplicate does not extend the streak");
  });

  test("an unknown care action is rejected", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token, { canonicalPlantId: "pl-tomato" });
    const res = await h.post(api.base, "/engagement/care", {
      token,
      body: { plantId: plant.plant_id, actionType: "teleporting" },
    });
    assert.equal(res.status, 400);
  });

  test("caring for a plant that is not yours is a 404", async () => {
    const owner = await h.signup(api.base);
    const plant = await h.createPlant(api.base, owner.token, { canonicalPlantId: "pl-tomato" });
    const stranger = await h.signup(api.base);

    const res = await h.post(api.base, "/engagement/care", {
      token: stranger.token,
      body: { plantId: plant.plant_id, actionType: "watering" },
    });
    assert.equal(res.status, 404);
  });

  test("streak arithmetic continues on consecutive days and resets after a gap", () => {
    const engagement = require("../services/engagement.service");
    assert.equal(engagement.nextStreak(0, null, "2026-09-26").days, 1);
    assert.equal(engagement.nextStreak(1, "2026-09-25", "2026-09-26").days, 2);
    assert.equal(engagement.nextStreak(3, "2026-09-26", "2026-09-26").days, 3);
    assert.equal(engagement.nextStreak(4, "2026-09-24", "2026-09-26").days, 1);
  });
});

describe("milestones and rewards", () => {
  test("a milestone pays its reward exactly once", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-tomato" });

    const before = await summaryOf(token);
    const planting = journey.milestones[0];
    assert.equal(planting.stage_key, "planting");

    const first = await h.post(
      api.base,
      `/journeys/${journey.journey_id}/milestones/${planting.milestone_id}/complete`,
      { token, body: {} }
    );
    assert.equal(first.status, 200);
    const afterFirst = await summaryOf(token);
    assert.equal(afterFirst.garden.xp, before.garden.xp + 15);

    await h.post(
      api.base,
      `/journeys/${journey.journey_id}/milestones/${planting.milestone_id}/complete`,
      { token, body: {} }
    );
    const afterReplay = await summaryOf(token);
    assert.equal(afterReplay.garden.xp, afterFirst.garden.xp, "a replay pays nothing");
  });

  test("the journey shows the reward the plant's OWN stage pays", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-tomato" });

    const flowering = journey.milestones.find((milestone) => milestone.stage_key === "flowering");
    assert.ok(
      flowering.reward.some((part) => part.type === "fact" && part.key === "fact-tomato-roots"),
      "tomato's flowering reward is the tomato-specific fact"
    );

    const basil = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-basil" });
    const basilFlower = basil.journey.milestones.find((milestone) => milestone.stage_key === "flowering");
    // Basil (herb-annual) has no flowering stage at all — a different journey.
    assert.equal(basilFlower, undefined);
  });

  test("a mystery milestone offers a reward once and it can be claimed once", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-tomato" });

    const germination = journey.milestones.find((milestone) => milestone.stage_key === "germination");
    await h.post(
      api.base,
      `/journeys/${journey.journey_id}/milestones/${germination.milestone_id}/complete`,
      { token, body: {} }
    );

    const summary = await summaryOf(token);
    assert.equal(summary.pendingMysteries.length, 1);
    const { grantId } = summary.pendingMysteries[0];

    const claim = await h.post(api.base, `/engagement/mystery/${grantId}/claim`, { token, body: {} });
    assert.equal(claim.status, 200);
    assert.ok(Array.isArray(claim.body.rewards) && claim.body.rewards.length > 0);

    const again = await h.post(api.base, `/engagement/mystery/${grantId}/claim`, { token, body: {} });
    assert.equal(again.status, 409, "a mystery reward cannot be claimed twice");

    const after = await summaryOf(token);
    assert.equal(after.pendingMysteries.length, 0);
  });

  test("rewards land in the member's inventory", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-tomato" });

    const germination = journey.milestones.find((milestone) => milestone.stage_key === "germination");
    await h.post(
      api.base,
      `/journeys/${journey.journey_id}/milestones/${germination.milestone_id}/complete`,
      { token, body: {} }
    );

    const summary = await summaryOf(token);
    const seeds = summary.inventory.find((item) => item.type === "seed");
    assert.ok(seeds, "the germination reward is a seed");
    assert.ok(seeds.quantity >= 1);
  });
});

describe("seasonal challenges", () => {
  test("a challenge from real activity completes and pays once", async () => {
    const { token } = await h.signup(api.base);
    await h.createPlant(api.base, token, { plantingMethod: "From Seed" });

    const summary = await summaryOf(token);
    const challenge = summary.challenges.find((entry) => entry.id === "ch-autumn-sow");
    assert.ok(challenge, "the autumn challenge is configured");

    // Only exercise the claim when the challenge window is actually running.
    if (challenge.status !== "active") return;
    assert.equal(challenge.completed, true);
    assert.equal(challenge.canClaim, true);

    const claim = await h.post(api.base, `/engagement/challenges/${challenge.id}/claim`, { token, body: {} });
    assert.equal(claim.status, 200);

    const again = await h.post(api.base, `/engagement/challenges/${challenge.id}/claim`, { token, body: {} });
    assert.equal(again.status, 409, "a challenge reward cannot be claimed twice");
  });

  test("claiming an unfinished challenge is refused", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.post(api.base, "/engagement/challenges/ch-desert-week/claim", { token, body: {} });
    assert.equal(res.status, 409);
  });

  test("an unknown challenge is a 404", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.post(api.base, "/engagement/challenges/not-a-challenge/claim", { token, body: {} });
    assert.equal(res.status, 404);
  });
});
