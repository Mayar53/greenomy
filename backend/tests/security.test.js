// tests/security.test.js — hardening: input validation, response headers,
// suspended accounts and the concurrency guarantee on redemptions.
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

describe("security hardening", () => {
  test("passwords are validated server-side, not just in the browser", async () => {
    const cases = [
      { password: "short1", why: "too short" },
      { password: "abcdefghi", why: "no digit" },
      { password: "123456789", why: "no letter" },
    ];

    for (const { password, why } of cases) {
      const res = await h.post(api.base, "/auth/signup", {
        body: { fullName: "Weak", email: h.uniqueEmail("weak"), password },
      });
      assert.equal(res.status, 400, `expected 400 for ${why}`);
    }

    const strong = await h.post(api.base, "/auth/signup", {
      body: { fullName: "Strong", email: h.uniqueEmail("strong"), password: "password123" },
    });
    assert.equal(strong.status, 201);
  });

  test("malformed emails are rejected before reaching the database", async () => {
    const res = await h.post(api.base, "/auth/signup", {
      body: { fullName: "Nope", email: "not-an-email", password: "password123" },
    });
    assert.equal(res.status, 400);
  });

  test("reset-password applies the same strength rules", async () => {
    const res = await h.post(api.base, "/auth/reset-password", {
      body: { token: "whatever", newPassword: "weak" },
    });
    assert.equal(res.status, 400);
  });

  test("responses carry hardening headers and hide the framework", async () => {
    const res = await h.get(api.base, "/impact");

    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.ok(res.headers.get("permissions-policy"), "expected a Permissions-Policy");
    assert.equal(res.headers.get("x-powered-by"), null, "must not advertise Express");
  });

  test("a suspended account cannot log in", async () => {
    const { user } = await h.signup(api.base);
    const admin = await h.loginAdmin(api.base);

    await h.patch(api.base, `/admin/users/${user.user_id}`, {
      token: admin.token,
      body: { status: "suspended" },
    });

    const login = await h.post(api.base, "/auth/login", {
      body: { email: user.email, password: "password123" },
    });
    assert.equal(login.status, 403, "suspension must block a fresh login too");
  });

  test("two simultaneous redemptions of the same reward only spend the points once", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    for (let i = 0; i < 4; i += 1) {
      await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, `RACE${i}`);
    }

    const before = await h.get(api.base, "/wallet", { token });
    assert.equal(before.body.currentPoints, 120);

    // rw-004 costs exactly the whole balance, so only one can win.
    const [a, b] = await Promise.all([
      h.post(api.base, "/rewards/rw-004/redeem", { token, body: {} }),
      h.post(api.base, "/rewards/rw-004/redeem", { token, body: {} }),
    ]);

    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [201, 402], `expected one success and one rejection, got ${statuses}`);

    const after = await h.get(api.base, "/wallet", { token });
    assert.equal(after.body.currentPoints, 0, "points must not go negative or double-spend");
    assert.equal(after.body.totalSpent, 120);

    const ledger = await h.get(api.base, "/wallet/transactions", { token });
    assert.equal(
      ledger.body.filter((t) => t.transaction_type === "reward_redeemed").length,
      1,
      "exactly one redemption should reach the ledger"
    );
  });
});
