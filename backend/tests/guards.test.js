// tests/guards.test.js — role enforcement, the admin review queue, input
// validation, and the homepage aggregates.
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

describe("guards and admin queue", () => {
  test("a normal user cannot read the review queue", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.get(api.base, "/admin/verifications", { token });
    assert.equal(res.status, 403);
  });

  test("the seeded admin can approve, and the same photo can't be paid twice", async () => {
    // Required here, not at the top: the module opens the database, which only
    // exists once before() has run.
    const { POINTS } = require("../services/reward-engine.service");
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    const journey = (await h.get(api.base, "/journeys", { token })).body.find(
      (entry) => entry.user_plant_id === plant.plant_id
    );
    const challenge = await h.issueChallenge(api.base, token, plant.plant_id);

    // A reward-eligible (milestone) photo too low-resolution to verify queues for
    // a human — which is exactly what has to happen before any payout.
    const lowRes = await h.photoDataUrl("QUEUE", { green: true, width: 160, height: 120 });
    const queued = await h.submitRawPhoto(api.base, token, plant.plant_id, lowRes, {
      challengeId: challenge.challengeId,
      milestoneId: journey.milestones[0].milestone_id,
    });
    assert.equal(queued.body.approval_status, "pending");
    assert.equal(queued.body.requires_review, true);

    const admin = await h.loginAdmin(api.base);
    assert.ok(admin.token, "expected the seeded admin to log in");

    const queue = await h.get(api.base, "/admin/verifications", { token: admin.token });
    assert.ok(queue.body.length >= 1, "expected at least one pending item");

    const item = queue.body.find((v) => v.verification_id === queued.body.verification_id);
    assert.ok(item, "the submitted photo should be in the queue");
    assert.equal(item.plant_type, "Pumpkin", "queue should join the plant type");

    const approved = await h.post(api.base, `/admin/verifications/${item.verification_id}/approve`, {
      token: admin.token,
      body: {},
    });
    assert.equal(approved.status, 200);

    const wallet = await h.get(api.base, "/wallet", { token });
    assert.equal(wallet.body.currentPoints, POINTS.milestone_planting, "the approved milestone pays once");

    const again = await h.post(api.base, `/admin/verifications/${item.verification_id}/approve`, {
      token: admin.token,
      body: {},
    });
    assert.equal(again.status, 404, "approving twice must not be possible");

    const afterSecond = await h.get(api.base, "/wallet", { token });
    assert.equal(afterSecond.body.currentPoints, POINTS.milestone_planting, "points must not double");
  });

  test("rejecting records the reason and awards nothing", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    const lowRes = await h.photoDataUrl("REJ", { green: true, width: 160, height: 120 });
    const queued = await h.submitRawPhoto(api.base, token, plant.plant_id, lowRes);
    const admin = await h.loginAdmin(api.base);

    const rejected = await h.post(
      api.base,
      `/admin/verifications/${queued.body.verification_id}/reject`,
      { token: admin.token, body: { reason: "too blurry" } }
    );
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.approval_status, "rejected");
    assert.equal(rejected.body.rejection_reason, "too blurry");

    const wallet = await h.get(api.base, "/wallet", { token });
    assert.equal(wallet.body.currentPoints, 0);
  });

  test("a malformed uuid in the path is a 400, not a crash", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.get(api.base, "/plants/not-a-uuid", { token });
    assert.equal(res.status, 400);
  });

  test("waitlist validates input and refuses duplicates", async () => {
    const email = h.uniqueEmail("waitlist");

    const bad = await h.post(api.base, "/waitlist", {
      body: { fullName: "A", email: "nope", city: "Erbil" },
    });
    assert.equal(bad.status, 400);

    const created = await h.post(api.base, "/waitlist", {
      body: { fullName: "A", email, city: "Erbil" },
    });
    assert.equal(created.status, 201);

    const duplicate = await h.post(api.base, "/waitlist", {
      body: { fullName: "A", email, city: "Erbil" },
    });
    assert.equal(duplicate.status, 409);
  });

  test("impact returns real aggregates with the keys the homepage reads", async () => {
    const res = await h.get(api.base, "/impact");
    assert.equal(res.status, 200);

    for (const key of ["plantsGrown", "seedsStarted", "co2ImpactKg", "members"]) {
      assert.equal(typeof res.body[key], "number", `${key} should be a number`);
    }
    assert.ok(res.body.members >= 1, "the seeded admin counts as a member");
  });

  test("public catalogues are served from the database", async () => {
    const rewards = await h.get(api.base, "/rewards");
    assert.equal(rewards.status, 200);
    assert.equal(rewards.body.length, 10);

    const categories = [...new Set(rewards.body.map((r) => r.category))].sort();
    assert.deepEqual(categories, ["courses", "restaurant", "supplies", "university"]);

    const articles = await h.get(api.base, "/green-hub");
    assert.ok(articles.body.length >= 6, "the seeded articles are served");
    assert.equal(articles.body[0].readingTime !== undefined, true, "green hub is camelCase");

    const filtered = await h.get(api.base, "/green-hub?category=plant-care");
    assert.ok(filtered.body.length >= 1, "the category filter returns articles");
    assert.ok(
      filtered.body.every((a) => a.category === "plant-care"),
      "the category filter returns only that category"
    );
  });
});
