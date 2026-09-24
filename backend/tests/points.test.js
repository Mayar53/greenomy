// tests/points.test.js — the points invariants: what earns, what spends, and
// that a redemption token is genuinely single-use.
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

describe("points and redemption", () => {
  test("a photo with no plant in it is rejected and earns nothing", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);

    const submitted = await h.submitPhoto(api.base, token, plant.plant_id, h.DIM_PHOTO, "LOW");
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.approval_status, "rejected");
    assert.equal(submitted.body.verification_result.reasonCode, "no_plant");

    const wallet = await h.get(api.base, "/wallet", { token });
    assert.equal(wallet.body.currentPoints, 0);
    assert.equal(wallet.body.totalEarned, 0);
  });

  test("a plant photo too poor to verify queues for review and earns nothing", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);

    const imageUrl = await h.photoDataUrl("TINY", { green: true, width: 160, height: 120 });
    const submitted = await h.submitRawPhoto(api.base, token, plant.plant_id, imageUrl);
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.approval_status, "pending");
    assert.equal(submitted.body.requires_review, true);

    const wallet = await h.get(api.base, "/wallet", { token });
    assert.equal(wallet.body.currentPoints, 0);
  });

  test("an auto-approved photo awards 30 points and writes one ledger row", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);

    const submitted = await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, "OK");
    assert.equal(submitted.body.approval_status, "approved");

    const wallet = await h.get(api.base, "/wallet", { token });
    assert.equal(wallet.body.currentPoints, 30);
    assert.equal(wallet.body.totalEarned, 30);

    const ledger = await h.get(api.base, "/wallet/transactions", { token });
    assert.equal(ledger.body.length, 1);
    assert.equal(ledger.body[0].transaction_type, "verification_approved");
    assert.equal(ledger.body[0].amount, 30);
    assert.equal(ledger.body[0].reference_id, submitted.body.verification_id);
  });

  test("redeeming deducts the points, issues a token, and the token is single-use", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);

    // 4 approved photos = 120 points, the price of rw-004.
    for (let i = 0; i < 4; i += 1) {
      await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, `EARN${i}`);
    }
    const before = await h.get(api.base, "/wallet", { token });
    assert.equal(before.body.currentPoints, 120);

    // 220-point reward is out of reach at 120.
    const tooPricey = await h.post(api.base, "/rewards/rw-009/redeem", { token, body: {} });
    assert.equal(tooPricey.status, 402);

    const redeemed = await h.post(api.base, "/rewards/rw-004/redeem", { token, body: {} });
    assert.equal(redeemed.status, 201);
    assert.equal(redeemed.body.redemption.points_spent, 120);
    assert.equal(redeemed.body.redemption.is_used, false);
    assert.ok(redeemed.body.qrPayload, "expected a qrPayload token");

    const after = await h.get(api.base, "/wallet", { token });
    assert.equal(after.body.currentPoints, 0);
    assert.equal(after.body.totalSpent, 120);

    const first = await h.post(api.base, "/rewards/validate", {
      token,
      body: { token: redeemed.body.qrPayload },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.success, true);
    assert.equal(first.body.redemption.is_used, true);
    assert.equal(first.body.reward.title, "One Free Cold-Pressed Juice");

    const second = await h.post(api.base, "/rewards/validate", {
      token,
      body: { token: redeemed.body.qrPayload },
    });
    assert.equal(second.status, 409, "a consumed token must not work twice");

    const unknown = await h.post(api.base, "/rewards/validate", {
      token,
      body: { token: "definitely-not-a-token" },
    });
    assert.equal(unknown.status, 404);
  });

  test("a failed redemption leaves the balance untouched", async () => {
    const { token } = await h.signup(api.base);
    await h.createPlant(api.base, token);

    const res = await h.post(api.base, "/rewards/rw-005/redeem", { token, body: {} });
    assert.equal(res.status, 402);

    const wallet = await h.get(api.base, "/wallet", { token });
    assert.equal(wallet.body.currentPoints, 0);
    assert.equal(wallet.body.totalSpent, 0);
  });

  test("submitting for a plant that isn't yours is a 404", async () => {
    const owner = await h.signup(api.base);
    const stranger = await h.signup(api.base);
    const plant = await h.createPlant(api.base, owner.token);

    const res = await h.submitPhoto(api.base, stranger.token, plant.plant_id, h.SHARP_GREEN_PHOTO);
    assert.equal(res.status, 404);
  });
});
