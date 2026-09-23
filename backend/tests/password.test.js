// tests/password.test.js — forgot / reset / change password.
// The mail service keeps a development outbox in the same process, so the test
// can read the reset link exactly as a user would from their inbox.
const { test, before, after, beforeEach, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");
const mail = require("../services/mail.service");

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

beforeEach(() => mail.clearOutbox());

function resetTokenFromOutbox() {
  const latest = mail.getOutbox()[0];
  const match = latest && String(latest.text).match(/token=([a-f0-9]{16,})/);
  return match ? match[1] : null;
}

const GENERIC = /if that email exists/i;

describe("password reset", () => {
  test("an unknown address gets the same response and no email", async () => {
    const res = await h.post(api.base, "/auth/forgot-password", {
      body: { email: "nobody@example.test" },
    });

    assert.equal(res.status, 200);
    assert.match(res.body.message, GENERIC);
    assert.equal(mail.getOutbox().length, 0, "no mail for an unknown address");
  });

  test("a real address gets a link, and the token changes the password", async () => {
    const { user } = await h.signup(api.base, { password: "password123" });

    const forgot = await h.post(api.base, "/auth/forgot-password", { body: { email: user.email } });
    assert.equal(forgot.status, 200);
    assert.match(forgot.body.message, GENERIC, "response must not confirm the account exists");

    assert.equal(mail.getOutbox().length, 1);
    assert.equal(mail.getOutbox()[0].to, user.email);

    const token = resetTokenFromOutbox();
    assert.ok(token, "expected a token in the reset link");

    const reset = await h.post(api.base, "/auth/reset-password", {
      body: { token, newPassword: "brandnew456" },
    });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.success, true);

    const withNew = await h.post(api.base, "/auth/login", {
      body: { email: user.email, password: "brandnew456" },
    });
    assert.equal(withNew.status, 200, "the new password must work");

    const withOld = await h.post(api.base, "/auth/login", {
      body: { email: user.email, password: "password123" },
    });
    assert.equal(withOld.status, 401, "the old password must stop working");
  });

  test("a reset token is single use", async () => {
    const { user } = await h.signup(api.base);
    await h.post(api.base, "/auth/forgot-password", { body: { email: user.email } });
    const token = resetTokenFromOutbox();

    const first = await h.post(api.base, "/auth/reset-password", {
      body: { token, newPassword: "firstpass123" },
    });
    assert.equal(first.status, 200);

    const second = await h.post(api.base, "/auth/reset-password", {
      body: { token, newPassword: "secondpass123" },
    });
    assert.equal(second.status, 400, "a used token must be rejected");
  });

  test("requesting a new link invalidates the previous one", async () => {
    const { user } = await h.signup(api.base);

    await h.post(api.base, "/auth/forgot-password", { body: { email: user.email } });
    const firstToken = resetTokenFromOutbox();

    await h.post(api.base, "/auth/forgot-password", { body: { email: user.email } });
    const secondToken = resetTokenFromOutbox();
    assert.notEqual(firstToken, secondToken);

    const stale = await h.post(api.base, "/auth/reset-password", {
      body: { token: firstToken, newPassword: "whatever123" },
    });
    assert.equal(stale.status, 400, "the superseded link must not work");

    const fresh = await h.post(api.base, "/auth/reset-password", {
      body: { token: secondToken, newPassword: "working123" },
    });
    assert.equal(fresh.status, 200);
  });

  test("a bad token and a weak password are both rejected", async () => {
    const bad = await h.post(api.base, "/auth/reset-password", {
      body: { token: "0".repeat(64), newPassword: "password123" },
    });
    assert.equal(bad.status, 400);

    const { user } = await h.signup(api.base);
    await h.post(api.base, "/auth/forgot-password", { body: { email: user.email } });
    const token = resetTokenFromOutbox();

    const weak = await h.post(api.base, "/auth/reset-password", {
      body: { token, newPassword: "short" },
    });
    assert.equal(weak.status, 400);

    // The rejected attempt must not have consumed the token.
    const stillWorks = await h.post(api.base, "/auth/reset-password", {
      body: { token, newPassword: "goodpass123" },
    });
    assert.equal(stillWorks.status, 200);
  });

  test("the development outbox exposes what would have been emailed", async () => {
    const { user } = await h.signup(api.base);
    await h.post(api.base, "/auth/forgot-password", { body: { email: user.email } });

    const res = await h.get(api.base, "/dev/mail");
    assert.equal(res.status, 200);
    assert.equal(res.body.messages.length, 1);
    assert.match(res.body.messages[0].text, /reset-password\.html\?token=/);
  });
});

describe("change password", () => {
  test("requires the current password", async () => {
    const { token } = await h.signup(api.base, { password: "password123" });

    const wrong = await h.post(api.base, "/auth/change-password", {
      token,
      body: { currentPassword: "not-my-password", newPassword: "password456" },
    });
    assert.equal(wrong.status, 400, "a wrong current password is a validation error, not a 401");
  });

  test("rejects a weak or unchanged new password", async () => {
    const { token } = await h.signup(api.base, { password: "password123" });

    const weak = await h.post(api.base, "/auth/change-password", {
      token,
      body: { currentPassword: "password123", newPassword: "abc" },
    });
    assert.equal(weak.status, 400);

    const same = await h.post(api.base, "/auth/change-password", {
      token,
      body: { currentPassword: "password123", newPassword: "password123" },
    });
    assert.equal(same.status, 400);
  });

  test("changes the password for a signed-in user", async () => {
    const { user, token } = await h.signup(api.base, { password: "password123" });

    const changed = await h.post(api.base, "/auth/change-password", {
      token,
      body: { currentPassword: "password123", newPassword: "password456" },
    });
    assert.equal(changed.status, 200);

    const withNew = await h.post(api.base, "/auth/login", {
      body: { email: user.email, password: "password456" },
    });
    assert.equal(withNew.status, 200);

    const withOld = await h.post(api.base, "/auth/login", {
      body: { email: user.email, password: "password123" },
    });
    assert.equal(withOld.status, 401);
  });

  test("is closed to anonymous callers", async () => {
    const res = await h.post(api.base, "/auth/change-password", {
      body: { currentPassword: "a", newPassword: "password123" },
    });
    assert.equal(res.status, 401);
  });
});
