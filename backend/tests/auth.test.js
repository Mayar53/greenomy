// tests/auth.test.js — signup, login, session and the shape of user responses.
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

describe("auth", () => {
  test("signup returns a uuid user with a token and never the password hash", async () => {
    const { res, token, user } = await h.signup(api.base);

    assert.equal(res.status, 201);
    assert.ok(token, "expected a token");
    assert.match(user.user_id, /^[0-9a-f-]{36}$/, "user_id should be a uuid");
    assert.equal(user.total_points, 0);
    assert.equal(user.role, "user");
    assert.equal(user.password_hash, undefined);
  });

  test("signup rejects a duplicate email with 409", async () => {
    const email = h.uniqueEmail("dupe");
    const first = await h.signup(api.base, { email });
    assert.equal(first.res.status, 201);

    const second = await h.signup(api.base, { email });
    assert.equal(second.res.status, 409);
  });

  test("signup requires the core fields", async () => {
    const res = await h.post(api.base, "/auth/signup", { body: { email: "x@y.test" } });
    assert.equal(res.status, 400);
  });

  test("login rejects a wrong password with 401", async () => {
    const email = h.uniqueEmail("wrongpw");
    await h.signup(api.base, { email });

    const res = await h.post(api.base, "/auth/login", {
      body: { email, password: "not-the-password" },
    });
    assert.equal(res.status, 401);
  });

  test("login returns a usable token", async () => {
    const email = h.uniqueEmail("login");
    await h.signup(api.base, { email, password: "password123" });

    const res = await h.post(api.base, "/auth/login", {
      body: { email, password: "password123" },
    });
    assert.equal(res.status, 200);

    const me = await h.get(api.base, "/auth/me", { token: res.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.email, email);
    assert.equal(me.body.password_hash, undefined);
  });

  test("protected routes reject a missing or bogus token with 401", async () => {
    const anonymous = await h.get(api.base, "/wallet");
    assert.equal(anonymous.status, 401);

    const bogus = await h.get(api.base, "/wallet", { token: "not-a-real-jwt" });
    assert.equal(bogus.status, 401);
  });
});
