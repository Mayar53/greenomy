// tests/notifications.test.js — notification creation on real events,
// read state, device registration and per-user isolation.
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

async function unread(token) {
  const res = await h.get(api.base, "/notifications/unread-count", { token });
  return res.body.unread;
}

/** A plant photo too low-resolution to verify — it queues for review. (A photo
 * with no plant in it at all is rejected outright and would not queue.) */
const pendingImage = (tag) => h.photoDataUrl(tag, { green: true, width: 160, height: 120 });

describe("notifications", () => {
  test("the verification outcome creates a notification", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);

    assert.equal(await unread(token), 0);

    await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, "N1");
    assert.equal(await unread(token), 1, "an approved photo should notify");

    const list = await h.get(api.base, "/notifications", { token });
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].type, "verification_approved");
    assert.equal(list.body[0].is_read, false);

    await h.submitRawPhoto(api.base, token, plant.plant_id, await pendingImage("N2"));
    assert.equal(await unread(token), 2, "a queued photo should also notify");

    const types = (await h.get(api.base, "/notifications", { token })).body.map((n) => n.type);
    assert.ok(types.includes("verification_pending"));
  });

  test("marking one read, then all read, clears the unread count", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, "R1");
    await h.submitRawPhoto(api.base, token, plant.plant_id, await pendingImage("R2"));

    const list = await h.get(api.base, "/notifications", { token });
    assert.equal(list.body.length, 2);

    const one = await h.patch(api.base, `/notifications/${list.body[0].notification_id}/read`, {
      token,
      body: {},
    });
    assert.equal(one.status, 200);
    assert.equal(one.body.is_read, true);
    assert.equal(await unread(token), 1);

    const all = await h.post(api.base, "/notifications/read-all", { token, body: {} });
    assert.equal(all.status, 200);
    assert.equal(all.body.updated, 1);
    assert.equal(await unread(token), 0);
  });

  test("an admin decision notifies the owner", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    const queued = await h.submitRawPhoto(api.base, token, plant.plant_id, await pendingImage("ADMIN"));
    const admin = await h.loginAdmin(api.base);

    await h.post(api.base, "/notifications/read-all", { token, body: {} });

    await h.post(api.base, `/admin/verifications/${queued.body.verification_id}/approve`, {
      token: admin.token,
      body: {},
    });

    const list = await h.get(api.base, "/notifications", { token });
    assert.equal(list.body.filter((n) => n.type === "verification_approved").length >= 1, true);
    assert.equal(await unread(token) >= 1, true);
  });

  test("redeeming a reward notifies the user", async () => {
    const { token } = await h.signup(api.base);
    await h.creditPoints(api.base, token, 120);

    await h.post(api.base, "/notifications/read-all", { token, body: {} });
    const redeemed = await h.post(api.base, "/rewards/rw-004/redeem", { token, body: {} });
    assert.equal(redeemed.status, 201);

    const list = await h.get(api.base, "/notifications", { token });
    const rewardNote = list.body.find((n) => n.type === "reward_redeemed");
    assert.ok(rewardNote, "expected a reward_redeemed notification");
    assert.equal(rewardNote.is_read, false);
  });

  test("device registration upserts rather than duplicating", async () => {
    const { token } = await h.signup(api.base);

    const first = await h.post(api.base, "/notifications/register-device", {
      token,
      body: { token: "device-abc", platform: "web" },
    });
    assert.equal(first.status, 201);

    const again = await h.post(api.base, "/notifications/register-device", {
      token,
      body: { token: "device-abc", platform: "ios" },
    });
    assert.equal(again.status, 201);
    assert.equal(again.body.token_id, first.body.token_id, "same row, not a duplicate");
    assert.equal(again.body.platform, "ios", "re-registering refreshes the record");

    const missing = await h.post(api.base, "/notifications/register-device", { token, body: {} });
    assert.equal(missing.status, 400);
  });

  test("notifications are private to their owner", async () => {
    const owner = await h.signup(api.base);
    const stranger = await h.signup(api.base);
    const plant = await h.createPlant(api.base, owner.token);
    await h.submitPhoto(api.base, owner.token, plant.plant_id, h.SHARP_GREEN_PHOTO, "PRIV");

    const owned = (await h.get(api.base, "/notifications", { token: owner.token })).body[0];
    assert.ok(owned);

    const strangerList = await h.get(api.base, "/notifications", { token: stranger.token });
    assert.equal(strangerList.body.length, 0, "a stranger sees no notifications");

    const stolen = await h.patch(api.base, `/notifications/${owned.notification_id}/read`, {
      token: stranger.token,
      body: {},
    });
    assert.equal(stolen.status, 404, "and cannot mark someone else's as read");
  });
});
