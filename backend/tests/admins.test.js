// tests/admins.test.js — who may be staff, what each of them may do, and the
// rules that stop an admin widening their own access.
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

const PASSWORD = "password123";

let dbDir;
let api;
let ownerToken;

before(async () => {
  dbDir = h.createTestDatabase();
  api = await h.startServer();
  ownerToken = (await h.loginAdmin(api.base)).token;
});

after(async () => {
  await api.close();
  h.cleanup(dbDir);
});

/** Promotes a fresh member and returns a token for the new admin. */
async function makeAdmin(permissions) {
  const { user } = await h.signup(api.base);
  const created = await h.post(api.base, "/admin/admins", {
    token: ownerToken,
    body: { email: user.email, permissions },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const login = await h.post(api.base, "/auth/login", {
    body: { email: user.email, password: PASSWORD },
  });
  return { user, token: login.body.token, admin: created.body };
}

describe("admin permissions", () => {
  test("the seeded owner holds the whole catalogue", async () => {
    const res = await h.get(api.base, "/admin/permissions", { token: ownerToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.mine.length, Object.keys(res.body.catalogue).length);
    assert.ok(res.body.mine.includes("admins.manage"));
  });

  test("a promoted admin can do exactly what was ticked, and nothing else", async () => {
    const { token } = await makeAdmin(["rewards.manage"]);

    assert.equal((await h.get(api.base, "/admin/rewards", { token })).status, 200);
    assert.equal((await h.get(api.base, "/admin/users", { token })).status, 403);
    assert.equal((await h.get(api.base, "/admin/analytics", { token })).status, 403);
    // The review queue is its own capability, not implied by being an admin.
    assert.equal((await h.get(api.base, "/admin/verifications", { token })).status, 403);
  });

  test("an admin without admins.manage cannot add admins", async () => {
    const { token } = await makeAdmin(["analytics.view"]);
    const { user } = await h.signup(api.base);

    const res = await h.post(api.base, "/admin/admins", {
      token,
      body: { email: user.email, permissions: [] },
    });
    assert.equal(res.status, 403);
  });

  test("nobody may grant a permission they do not hold themselves", async () => {
    const { token } = await makeAdmin(["admins.manage"]);
    const { user } = await h.signup(api.base);

    const res = await h.post(api.base, "/admin/admins", {
      token,
      body: { email: user.email, permissions: ["rewards.manage"] },
    });
    assert.equal(res.status, 403, "admins.manage alone must not confer rewards.manage");
  });

  test("an admin cannot change their own access or remove themselves", async () => {
    const { token, admin } = await makeAdmin(["admins.manage", "analytics.view"]);

    const self = await h.patch(api.base, `/admin/admins/${admin.id}`, {
      token,
      body: { permissions: ["admins.manage", "analytics.view", "users.manage"] },
    });
    assert.equal(self.status, 409);

    const removed = await h.del(api.base, `/admin/admins/${admin.id}`, { token });
    assert.equal(removed.status, 409);
  });

  test("the owner account cannot be changed by anyone", async () => {
    const { token } = await makeAdmin(["admins.manage"]);
    const list = await h.get(api.base, "/admin/admins", { token });
    const owner = list.body.find((a) => a.role === "super_admin");
    assert.ok(owner, "the owner should be listed");

    const res = await h.patch(api.base, `/admin/admins/${owner.id}`, {
      token,
      body: { permissions: [] },
    });
    assert.equal(res.status, 403, "the account that can fix a bad grant must not be lockable");
  });

  test("promoting an email with no account is a 404, not a new account", async () => {
    const res = await h.post(api.base, "/admin/admins", {
      token: ownerToken,
      body: { email: "nobody@example.test", permissions: ["analytics.view"] },
    });
    assert.equal(res.status, 404);
  });

  test("an unknown permission key is refused rather than dropped", async () => {
    const { user } = await h.signup(api.base);
    const res = await h.post(api.base, "/admin/admins", {
      token: ownerToken,
      body: { email: user.email, permissions: ["rewards.manage", "totally.made.up"] },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /totally\.made\.up/);
  });

  test("the owner can change an admin's permissions after the fact", async () => {
    const { token, admin } = await makeAdmin(["analytics.view"]);

    const res = await h.patch(api.base, `/admin/admins/${admin.id}`, {
      token: ownerToken,
      body: { permissions: ["analytics.view", "verifications.review"] },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.permissions, ["verifications.review", "analytics.view"]);
    assert.equal((await h.get(api.base, "/admin/verifications", { token })).status, 200);
  });

  test("removing an admin demotes them but keeps the account", async () => {
    const { token, admin } = await makeAdmin(["analytics.view"]);
    assert.equal((await h.get(api.base, "/admin/analytics", { token })).status, 200);

    const removed = await h.del(api.base, `/admin/admins/${admin.id}`, { token: ownerToken });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.role, "user");
    assert.deepEqual(removed.body.permissions, []);

    // Still a working member, just no longer staff.
    assert.equal((await h.get(api.base, "/wallet", { token })).status, 200);
    assert.equal((await h.get(api.base, "/admin/analytics", { token })).status, 403);
  });

  test("a member cannot read the staff list or the catalogue", async () => {
    const { token } = await h.signup(api.base);
    assert.equal((await h.get(api.base, "/admin/admins", { token })).status, 403);
    assert.equal((await h.get(api.base, "/admin/permissions", { token })).status, 403);
  });
});
