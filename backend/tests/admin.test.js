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
    assert.ok(admin, "the seeded account should be listed");
    // The seeded account is the OWNER: super_admin, which holds every permission
    // rather than carrying a permission list of its own.
    assert.equal(admin.role, "super_admin");
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
    // A photo that evidences no milestone pays nothing, so the points line must
    // NOT move — the dashboard reports what actually happened.
    assert.equal(after.body.points.earned, res.body.points.earned, "a lone photo adds no points");
  });
});

// The dashboard edits records in place, not only creates them. These cover every
// field the forms now send, and one thing the forms deliberately do NOT send:
// translations, which an edit must leave alone rather than wipe.
describe("editing existing records", () => {
  test("a reward can be edited, keeping its id and translations", async () => {
    const created = await h.post(api.base, "/admin/rewards", {
      token: adminToken,
      body: {
        partner: "Green Bean Coffee",
        category: "restaurant",
        title: "Original title",
        pointsRequired: 100,
        i18n: { ar: { title: "العنوان الأصلي" } },
      },
    });
    assert.equal(created.status, 201);

    const edited = await h.patch(api.base, `/admin/rewards/${created.body.reward_id}`, {
      token: adminToken,
      body: {
        partner: "Green Bean Coffee",
        category: "courses",
        title: "Edited title",
        description: "Now with a description",
        pointsRequired: 250,
        expiresAt: "2027-01-31",
      },
    });

    assert.equal(edited.status, 200);
    assert.equal(edited.body.reward_id, created.body.reward_id, "the id is stable");
    assert.equal(edited.body.title, "Edited title");
    assert.equal(edited.body.category, "courses");
    assert.equal(edited.body.description, "Now with a description");
    assert.equal(edited.body.points_required, 250);
    // A date-only field: the calendar day the admin picked must survive, whatever
    // timezone the server stores it in.
    const expiry = new Date(edited.body.expires_at);
    assert.equal(expiry.getFullYear(), 2027);
    assert.equal(expiry.getMonth(), 0);
    assert.equal(expiry.getDate(), 31);
    assert.equal(
      edited.body.i18n && edited.body.i18n.ar && edited.body.i18n.ar.title,
      "العنوان الأصلي",
      "an edit that does not mention i18n must not erase it"
    );
  });

  test("a partner can be edited, description and logo included", async () => {
    const created = await h.post(api.base, "/admin/partners", {
      token: adminToken,
      body: { name: "Editable Partner" },
    });
    assert.equal(created.status, 201);

    const edited = await h.patch(api.base, `/admin/partners/${created.body.partner_id}`, {
      token: adminToken,
      body: {
        name: "Renamed Partner",
        description: "A description",
        logoUrl: "https://example.test/logo.png",
        website: "https://example.test",
        contactEmail: "hello@example.test",
      },
    });

    assert.equal(edited.status, 200);
    assert.equal(edited.body.name, "Renamed Partner");
    assert.equal(edited.body.description, "A description");
    assert.equal(edited.body.logo_url, "https://example.test/logo.png");
    assert.equal(edited.body.website, "https://example.test");
    assert.equal(edited.body.contact_email, "hello@example.test");
  });

  test("an article can be edited across every field the form offers", async () => {
    const created = await h.post(api.base, "/admin/content", {
      token: adminToken,
      body: {
        slug: `editable-${Date.now()}`,
        title: "Original article",
        category: "soil",
        body: ["First paragraph"],
      },
    });
    assert.equal(created.status, 201);

    const edited = await h.patch(api.base, `/admin/content/${created.body.id}`, {
      token: adminToken,
      body: {
        title: "Edited article",
        description: "A short summary",
        category: "water",
        body: ["One", "Two"],
        imageUrl: "https://example.test/cover.jpg",
        readingTime: 4,
      },
    });

    assert.equal(edited.status, 200);
    assert.equal(edited.body.title, "Edited article");
    assert.equal(edited.body.description, "A short summary");
    assert.equal(edited.body.category, "water");
    assert.deepEqual(edited.body.body, ["One", "Two"]);
    assert.equal(edited.body.imageUrl, "https://example.test/cover.jpg");
    assert.equal(edited.body.readingTime, 4);

    // Still the same record, and still deletable.
    const removed = await h.del(api.base, `/admin/content/${created.body.id}`, { token: adminToken });
    assert.equal(removed.status, 204);
  });

  test("an unknown record is a 404, not a silent create", async () => {
    const missingId = "00000000-0000-0000-0000-000000000000";
    const reward = await h.patch(api.base, `/admin/rewards/${missingId}`, {
      token: adminToken,
      body: { title: "Nope" },
    });
    assert.equal(reward.status, 404);

    const partner = await h.patch(api.base, `/admin/partners/${missingId}`, {
      token: adminToken,
      body: { name: "Nope" },
    });
    assert.equal(partner.status, 404);
  });
});

// The Users page is a working surface: search it, rank it, open one member, and
// correct them. These cover the API behind those screens.
describe("member search, activity and editing", () => {
  /** The canonical promotion path (same shape as admins.test.js), then a login. */
  async function makeAdminWith(permissions) {
    const { user } = await h.signup(api.base);
    const created = await h.post(api.base, "/admin/admins", {
      token: adminToken,
      body: { email: user.email, permissions },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));

    const login = await h.post(api.base, "/auth/login", {
      body: { email: user.email, password: "password123" },
    });
    return { user, token: login.body.token };
  }

  const indexOf = (list, id) => list.findIndex((u) => u.user_id === id);

  test("the member list is searchable by name, email and city", async () => {
    const city = `Searchville${Date.now()}`;
    const { user } = await h.signup(api.base, { fullName: "Layla Searchable", city });

    const byName = await h.get(api.base, "/admin/users?search=Layla+Searchable", { token: adminToken });
    assert.equal(byName.status, 200);
    assert.deepEqual(byName.body.map((u) => u.user_id), [user.user_id], "a name narrows to one member");

    // Case-insensitive and partial.
    const byEmail = await h.get(
      api.base,
      `/admin/users?search=${encodeURIComponent(user.email.toUpperCase())}`,
      { token: adminToken }
    );
    assert.equal(byEmail.body.length, 1);
    assert.equal(byEmail.body[0].user_id, user.user_id);

    const byCity = await h.get(api.base, `/admin/users?search=${encodeURIComponent(city)}`, {
      token: adminToken,
    });
    assert.ok(byCity.body.some((u) => u.user_id === user.user_id), "a city finds them too");

    const none = await h.get(api.base, "/admin/users?search=no-such-member-xyz", { token: adminToken });
    assert.deepEqual(none.body, [], "a miss returns nothing");

    const all = await h.get(api.base, "/admin/users", { token: adminToken });
    assert.ok(all.body.length > 1, "no search still lists everyone");
  });

  test("most active ranks by photos submitted, then plants grown", async () => {
    // The clear leader: more photos than anyone else.
    const leader = await h.signup(api.base);
    const leaderPlant = await h.createPlant(api.base, leader.token);
    for (const tag of ["RANK-A", "RANK-B", "RANK-C"]) {
      await h.submitPhoto(api.base, leader.token, leaderPlant.plant_id, h.SHARP_GREEN_PHOTO, tag);
    }

    // Two members tied on photos and differing on plants — the tie-break.
    const onePlant = await h.signup(api.base);
    const onlyPlant = await h.createPlant(api.base, onePlant.token);
    await h.submitPhoto(api.base, onePlant.token, onlyPlant.plant_id, h.SHARP_GREEN_PHOTO, "RANK-D");
    await h.submitPhoto(api.base, onePlant.token, onlyPlant.plant_id, h.SHARP_GREEN_PHOTO, "RANK-E");

    const twoPlants = await h.signup(api.base);
    const plantOne = await h.createPlant(api.base, twoPlants.token);
    const plantTwo = await h.createPlant(api.base, twoPlants.token, { plantType: "Mint" });
    await h.submitPhoto(api.base, twoPlants.token, plantOne.plant_id, h.SHARP_GREEN_PHOTO, "RANK-F");
    await h.submitPhoto(api.base, twoPlants.token, plantTwo.plant_id, h.SHARP_GREEN_PHOTO, "RANK-G");

    const top = await h.get(api.base, "/admin/users/active?limit=5", { token: adminToken });
    assert.equal(top.status, 200);
    assert.equal(top.body[0].user_id, leader.user.user_id, "the most photos leads");
    assert.equal(top.body[0].verifications_count, 3);
    assert.equal(top.body[0].plants_count, 1);
    assert.ok(top.body.length <= 5, "the limit is honoured");

    const everyone = await h.get(api.base, "/admin/users/active?limit=50", { token: adminToken });
    assert.ok(
      indexOf(everyone.body, twoPlants.user.user_id) < indexOf(everyone.body, onePlant.user.user_id),
      "equal photos: more plants ranks higher"
    );

    // A huge or nonsense limit is clamped, not passed through to SQL.
    const clamped = await h.get(api.base, "/admin/users/active?limit=9999", { token: adminToken });
    assert.ok(clamped.body.length <= 50);
    // A nonsense limit falls back to the default rather than to nothing.
    const explicitTen = await h.get(api.base, "/admin/users/active?limit=10", { token: adminToken });
    const nonsense = await h.get(api.base, "/admin/users/active?limit=abc", { token: adminToken });
    assert.equal(nonsense.status, 200);
    assert.deepEqual(
      nonsense.body.map((u) => u.user_id),
      explicitTen.body.map((u) => u.user_id),
      "an unusable limit falls back to the default"
    );
  });

  test("opening a member gives their wallet, activity and recent photos", async () => {
    const { token, user } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, "DETAIL");
    await h.creditPoints(api.base, token, 40);

    const res = await h.get(api.base, `/admin/users/${user.user_id}`, { token: adminToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.user_id, user.user_id);
    assert.equal(res.body.user.password_hash, undefined, "never the hash");
    assert.equal(res.body.wallet.currentPoints, 40);
    assert.equal(res.body.activity.plants_total, 1);
    assert.equal(res.body.activity.verifications_total, 1);
    assert.equal(res.body.photosTotal, 1);
    assert.equal(res.body.photosPermitted, true, "the owner holds every permission");
    assert.equal(res.body.photos.length, 1);
    assert.match(String(res.body.photos[0].plant_type), /pumpkin/i);
    assert.match(String(res.body.photos[0].image_url), /^data:image\//, "the bounded preview");
    assert.equal(res.body.photos[0].gps_lat, undefined, "the panel has no use for a member's GPS");

    const missing = await h.get(api.base, "/admin/users/00000000-0000-0000-0000-000000000000", {
      token: adminToken,
    });
    assert.equal(missing.status, 404);
  });

  test("member photos also need verifications.review, and the panel says which", async () => {
    const { token, user } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, "PERMPHOTO");

    const memberAdmin = await makeAdminWith(["users.manage"]);
    const limited = await h.get(api.base, `/admin/users/${user.user_id}`, {
      token: memberAdmin.token,
    });
    assert.equal(limited.status, 200, "users.manage is enough to open the account");
    assert.equal(limited.body.photosPermitted, false);
    assert.deepEqual(limited.body.photos, []);
    assert.equal(limited.body.wallet.currentPoints, 0, "but the numbers are still there");
    assert.equal(limited.body.activity.verifications_total, 1);

    const reviewer = await makeAdminWith(["users.manage", "verifications.review"]);
    const allowed = await h.get(api.base, `/admin/users/${user.user_id}`, { token: reviewer.token });
    assert.equal(allowed.body.photosPermitted, true);
    assert.equal(allowed.body.photos.length, 1);
  });

  test("a balance correction is audited, and cannot push a member below zero", async () => {
    const { token, user } = await h.signup(api.base);
    const path = `/admin/users/${user.user_id}/points`;

    const noReason = await h.post(api.base, path, { token: adminToken, body: { delta: 50 } });
    assert.equal(noReason.status, 400, "a reason is required");

    const zero = await h.post(api.base, path, { token: adminToken, body: { delta: 0, reason: "nothing" } });
    assert.equal(zero.status, 400);

    const notANumber = await h.post(api.base, path, { token: adminToken, body: { delta: true, reason: "typo" } });
    assert.equal(notANumber.status, 400);

    const credited = await h.post(api.base, path, {
      token: adminToken,
      body: { delta: 120, reason: "corrected a missed harvest award" },
    });
    assert.equal(credited.status, 200);
    assert.equal(credited.body.total_points, 120);

    const wallet = await h.get(api.base, "/wallet", { token });
    assert.equal(wallet.body.currentPoints, 120, "the member sees it immediately");

    const ledger = await h.get(api.base, "/wallet/transactions", { token });
    assert.equal(ledger.body.length, 1, "one ledger row, not a rewritten balance");
    assert.equal(ledger.body[0].transaction_type, "admin_adjustment");
    assert.equal(ledger.body[0].amount, 120);
    assert.equal(ledger.body[0].description, "corrected a missed harvest award");
    const owner = await h.get(api.base, "/auth/me", { token: adminToken });
    assert.equal(ledger.body[0].reference_id, owner.body.user_id, "who did it is recorded");

    const tooMuch = await h.post(api.base, path, {
      token: adminToken,
      body: { delta: -500, reason: "typo" },
    });
    assert.equal(tooMuch.status, 409, "refused rather than clamped to zero");
    assert.equal((await h.get(api.base, "/wallet", { token })).body.currentPoints, 120);

    const missing = await h.post(api.base, "/admin/users/00000000-0000-0000-0000-000000000000/points", {
      token: adminToken,
      body: { delta: 10, reason: "nobody" },
    });
    assert.equal(missing.status, 404);
  });

  test("name and city can be edited without disturbing anything else", async () => {
    const { user } = await h.signup(api.base);
    const path = `/admin/users/${user.user_id}`;

    const edited = await h.patch(api.base, path, {
      token: adminToken,
      body: { fullName: "Renamed Member", city: "Erbil" },
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.full_name, "Renamed Member");
    assert.equal(edited.body.city, "Erbil");

    // The suspend button sends only a status — it must not blank the name.
    const suspended = await h.patch(api.base, path, { token: adminToken, body: { status: "suspended" } });
    assert.equal(suspended.body.status, "suspended");
    assert.equal(suspended.body.full_name, "Renamed Member");

    const badName = await h.patch(api.base, path, { token: adminToken, body: { fullName: 42 } });
    assert.equal(badName.status, 400);

    // The owner is still off limits. Demoting yourself is refused by the
    // self-guard first (409); another admin trying it hits the owner guard (403).
    const owner = await h.get(api.base, "/auth/me", { token: adminToken });
    const selfDemote = await h.patch(api.base, `/admin/users/${owner.body.user_id}`, {
      token: adminToken,
      body: { role: "user" },
    });
    assert.equal(selfDemote.status, 409, "the owner cannot demote itself");

    const memberAdmin = await makeAdminWith(["users.manage"]);
    const otherDemote = await h.patch(api.base, `/admin/users/${owner.body.user_id}`, {
      token: memberAdmin.token,
      body: { role: "user" },
    });
    assert.equal(otherDemote.status, 403, "nor can anyone else demote the owner");
  });

  test("the new routes are closed to members and to admins without users.manage", async () => {
    const { token, user } = await h.signup(api.base);

    for (const [method, path] of [
      ["GET", "/admin/users/active"],
      ["GET", `/admin/users/${user.user_id}`],
      ["POST", `/admin/users/${user.user_id}/points`],
    ]) {
      const opts = { token };
      if (method === "POST") opts.body = { delta: 1, reason: "should never land" };
      const res = await h.request(api.base, method, path, opts);
      assert.equal(res.status, 403, `${method} ${path} should be admin-only`);
    }

    const rewardsOnly = await makeAdminWith(["rewards.manage"]);
    assert.equal(
      (await h.get(api.base, "/admin/users/active", { token: rewardsOnly.token })).status,
      403
    );
    assert.equal(
      (await h.get(api.base, `/admin/users/${user.user_id}`, { token: rewardsOnly.token })).status,
      403
    );
  });
});
