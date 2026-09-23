// tests/admin.test.js — the admin dashboard's endpoints: access control,
// user management, catalogue editing and the analytics aggregates.
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

describe("admin dashboard", () => {
  test("every admin endpoint is closed to normal users", async () => {
    const { token } = await h.signup(api.base);

    for (const [method, path] of [
      ["GET", "/admin/users"],
      ["GET", "/admin/rewards"],
      ["GET", "/admin/partners"],
      ["GET", "/admin/content"],
      ["GET", "/admin/analytics"],
    ]) {
      const res = await h.request(api.base, method, path, { token });
      assert.equal(res.status, 403, `${method} ${path} should be admin-only`);
    }
  });

  test("user list excludes password hashes and includes the seeded admin", async () => {
    const res = await h.get(api.base, "/admin/users", { token: adminToken });
    assert.equal(res.status, 200);

    const admin = res.body.find((u) => u.email === h.ADMIN_EMAIL);
    assert.ok(admin, "the seeded admin should be listed");
    assert.equal(admin.role, "admin");
    assert.equal(admin.password_hash, undefined);
  });

  test("suspending a user takes effect immediately, and self-suspension is refused", async () => {
    const { token, user } = await h.signup(api.base);

    // Works before suspension.
    assert.equal((await h.get(api.base, "/wallet", { token })).status, 200);

    const suspended = await h.patch(api.base, `/admin/users/${user.user_id}`, {
      token: adminToken,
      body: { status: "suspended" },
    });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.status, "suspended");

    const after = await h.get(api.base, "/wallet", { token });
    assert.equal(after.status, 403, "a suspended account must stop working at once");

    const admin = await h.get(api.base, "/admin/users", { token: adminToken });
    const me = admin.body.find((u) => u.email === h.ADMIN_EMAIL);
    const self = await h.patch(api.base, `/admin/users/${me.user_id}`, {
      token: adminToken,
      body: { status: "suspended" },
    });
    assert.equal(self.status, 409, "an admin must not lock themselves out");
  });

  test("user updates are validated", async () => {
    const { user } = await h.signup(api.base);

    const badRole = await h.patch(api.base, `/admin/users/${user.user_id}`, {
      token: adminToken,
      body: { role: "wizard" },
    });
    assert.equal(badRole.status, 400);

    const badStatus = await h.patch(api.base, `/admin/users/${user.user_id}`, {
      token: adminToken,
      body: { status: "sleeping" },
    });
    assert.equal(badStatus.status, 400);
  });

  test("rewards can be created, validated, and deactivated", async () => {
    const missing = await h.post(api.base, "/admin/rewards", {
      token: adminToken,
      body: { category: "restaurant" },
    });
    assert.equal(missing.status, 400);

    const badCategory = await h.post(api.base, "/admin/rewards", {
      token: adminToken,
      body: { partner: "Test Café", category: "space-travel", title: "x", pointsRequired: 10 },
    });
    assert.equal(badCategory.status, 400);

    const badPoints = await h.post(api.base, "/admin/rewards", {
      token: adminToken,
      body: { partner: "Test Café", category: "restaurant", title: "x", pointsRequired: -5 },
    });
    assert.equal(badPoints.status, 400);

    const created = await h.post(api.base, "/admin/rewards", {
      token: adminToken,
      body: {
        partner: "Test Café",
        category: "restaurant",
        title: "Free Filter Coffee",
        pointsRequired: 90,
      },
    });
    assert.equal(created.status, 201);
    assert.match(created.body.reward_id, /^rw_/, "admin-created rewards get a generated id");
    assert.equal(created.body.is_active, true);

    const publicList = await h.get(api.base, "/rewards");
    assert.equal(publicList.body.length, 11, "the new reward appears publicly");

    const deactivated = await h.patch(api.base, `/admin/rewards/${created.body.reward_id}`, {
      token: adminToken,
      body: { isActive: false },
    });
    assert.equal(deactivated.status, 200);
    assert.equal(deactivated.body.is_active, false);

    const publicAfter = await h.get(api.base, "/rewards");
    assert.equal(publicAfter.body.length, 10, "a deactivated reward disappears publicly");

    const adminList = await h.get(api.base, "/admin/rewards", { token: adminToken });
    assert.equal(adminList.body.length, 11, "but admins still see it");
  });

  test("partners can be created and listed for admins", async () => {
    const created = await h.post(api.base, "/admin/partners", {
      token: adminToken,
      body: { name: "Test Partner Co", website: "https://example.test" },
    });
    assert.equal(created.status, 201);

    const list = await h.get(api.base, "/admin/partners", { token: adminToken });
    assert.ok(list.body.some((p) => p.name === "Test Partner Co"));
  });

  test("content can be created, published and unpublished", async () => {
    const badBody = await h.post(api.base, "/admin/content", {
      token: adminToken,
      body: { slug: "s", title: "t", category: "plant-care", body: "not-an-array" },
    });
    assert.equal(badBody.status, 400);

    const draft = await h.post(api.base, "/admin/content", {
      token: adminToken,
      body: {
        slug: "admin-created-draft",
        title: "A Draft",
        category: "plant-care",
        body: ["one", "two"],
        isPublished: false,
      },
    });
    assert.equal(draft.status, 201);

    const publicBefore = await h.get(api.base, "/green-hub");
    // Counted relative to whatever is seeded, so adding content never breaks this.
    const baseline = publicBefore.body.length;
    assert.ok(
      !publicBefore.body.some((a) => a.slug === "admin-created-draft"),
      "an unpublished draft is not public"
    );

    const published = await h.patch(api.base, `/admin/content/${draft.body.id}`, {
      token: adminToken,
      body: { isPublished: true },
    });
    assert.equal(published.status, 200);

    const publicAfter = await h.get(api.base, "/green-hub");
    assert.equal(publicAfter.body.length, baseline + 1);

    const removed = await h.del(api.base, `/admin/content/${draft.body.id}`, { token: adminToken });
    assert.equal(removed.status, 204);

    const publicFinal = await h.get(api.base, "/green-hub");
    assert.equal(publicFinal.body.length, baseline);
  });

  test("analytics reflects real activity and keeps its shape", async () => {
    const res = await h.get(api.base, "/admin/analytics", { token: adminToken });
    assert.equal(res.status, 200);

    for (const group of [
      "users",
      "plants",
      "verifications",
      "redemptions",
      "points",
      "rewards",
      "partners",
      "content",
      "waitlist",
    ]) {
      assert.equal(typeof res.body[group], "object", `analytics.${group} missing`);
    }
    assert.ok(Array.isArray(res.body.verificationsByDay));

    // Drive one verification through and confirm the counters move.
    const before = res.body.verifications.total;

    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, "ANALYTICS");

    const after = await h.get(api.base, "/admin/analytics", { token: adminToken });
    assert.equal(after.body.verifications.total, before + 1);
    assert.equal(after.body.verifications.approved, res.body.verifications.approved + 1);
    assert.equal(after.body.points.earned, res.body.points.earned + 30);
  });
});
