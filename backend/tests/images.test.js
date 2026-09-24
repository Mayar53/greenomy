// tests/images.test.js — photo verification: server-side integrity, challenge
// codes, duplicate detection and the owner-only image route.
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

/** A fresh member with a catalog-linked plant, so submissions never collide
 * with another test's fixtures or history. */
async function member(tag) {
  const { token, user } = await h.signup(api.base);
  const plant = await h.createPlant(api.base, token, { canonicalPlantId: "pl-tomato" });
  return { token, user, plant, tag };
}

describe("integrity is measured from the real bytes", () => {
  test("a real photo is hashed, stored and auto-approved", async () => {
    const { token, plant } = await member("MEASURE");
    const imageUrl = await h.photoDataUrl("MEASURE", { green: true });
    const res = await h.submitRawPhoto(api.base, token, plant.plant_id, imageUrl);

    assert.equal(res.status, 201);
    assert.match(res.body.image_sha256, /^[a-f0-9]{64}$/, "a sha256 of the bytes");
    assert.ok(res.body.storage_path, "the original is stored");
    assert.equal(res.body.approval_status, "approved");
    assert.equal(res.body.ai_provider, "heuristic");
    assert.equal(res.body.duplicate_status, "none");
    assert.equal(res.body.requires_review, false);
    assert.equal(res.body.verification_result.plantMatch, null, "no model, so identity is unknown");
  });

  test("a file that is not an image is rejected, not stored", async () => {
    const { token, plant } = await member("NOTIMAGE");
    const notAnImage = `data:image/jpeg;base64,${Buffer.from("definitely not an image").toString("base64")}`;
    const res = await h.submitRawPhoto(api.base, token, plant.plant_id, notAnImage);
    assert.equal(res.status, 400);
  });

  test("a dim, detail-free photo queues for review instead of approving", async () => {
    const { token, plant } = await member("DIMPHOTO");
    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("DIMPHOTO", { green: false })
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.approval_status, "pending");
  });
});

describe("duplicate protection", () => {
  test("the exact same photo cannot be submitted twice unnoticed", async () => {
    const { token, plant } = await member("DUP");
    const imageUrl = await h.photoDataUrl("DUP", { green: true });

    const first = await h.submitRawPhoto(api.base, token, plant.plant_id, imageUrl);
    assert.equal(first.body.duplicate_status, "none");

    const second = await h.submitRawPhoto(api.base, token, plant.plant_id, imageUrl);
    assert.equal(second.status, 201);
    assert.equal(second.body.duplicate_status, "exact");
    assert.equal(second.body.requires_review, true);
    assert.equal(second.body.approval_status, "pending", "a duplicate is never auto-approved");
  });

  test("a duplicate is caught across members, not just your own history", async () => {
    const a = await member("CROSSA");
    const b = await member("CROSSB");
    const imageUrl = await h.photoDataUrl("CROSS", { green: true });

    await h.submitRawPhoto(api.base, a.token, a.plant.plant_id, imageUrl);
    const res = await h.submitRawPhoto(api.base, b.token, b.plant.plant_id, imageUrl);

    assert.equal(res.body.duplicate_status, "exact");
    assert.equal(res.body.verification_result.crossUser, true);
    assert.equal(res.body.requires_review, true);
  });

  test("a recompressed copy is caught as a near duplicate", async () => {
    const { token, plant } = await member("NEAR");
    const original = await h.photoDataUrl("NEAR", { green: true });

    await h.submitRawPhoto(api.base, token, plant.plant_id, original);
    const variant = await h.reencodeDataUrl(original, 55);
    const res = await h.submitRawPhoto(api.base, token, plant.plant_id, variant);

    assert.equal(res.status, 201);
    assert.equal(res.body.duplicate_status, "near", "different bytes, same picture");
    assert.equal(res.body.requires_review, true);
  });

  test("two genuinely different photos are not flagged", async () => {
    const { token, plant } = await member("DISTINCT");
    await h.submitRawPhoto(api.base, token, plant.plant_id, await h.photoDataUrl("DISTINCT-A", { green: true }));
    const res = await h.submitRawPhoto(api.base, token, plant.plant_id, await h.photoDataUrl("DISTINCT-B", { green: true }));
    assert.equal(res.body.duplicate_status, "none");
  });
});

describe("verification challenges", () => {
  test("a milestone photo needs a code, and the code is single use", async () => {
    const { token, plant } = await member("CHALLENGE");

    const journeys = await h.get(api.base, "/journeys", { token });
    const journey = journeys.body.find((entry) => entry.user_plant_id === plant.plant_id);
    const milestone = journey.milestones[1];

    // Without a code: refused.
    const noCode = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("CHALLENGE-1", { green: true }),
      { milestoneId: milestone.milestone_id }
    );
    assert.equal(noCode.status, 400);

    const challenge = await h.issueChallenge(api.base, token, plant.plant_id);
    assert.ok(challenge.challengeId);
    assert.match(challenge.code, /^\d{4}$/, "a fresh 4-digit code");

    const accepted = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("CHALLENGE-2", { green: true }),
      { milestoneId: milestone.milestone_id, challengeId: challenge.challengeId }
    );
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.challenge_id, challenge.challengeId);
    assert.equal(accepted.body.milestone_id, milestone.milestone_id);
    assert.equal(accepted.body.approval_status, "pending", "a milestone photo is never auto-paid");
    assert.equal(accepted.body.requires_review, true, "no model, so the code cannot be confirmed");

    // The milestone now points at that verification.
    const refreshed = await h.get(api.base, `/journeys/${journey.journey_id}`, { token });
    const updated = refreshed.body.milestones.find((m) => m.milestone_id === milestone.milestone_id);
    assert.equal(updated.verification_status, "pending");
    assert.equal(updated.verification_id, accepted.body.verification_id);

    // Reusing the same code is refused.
    const reused = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("CHALLENGE-3", { green: true }),
      { milestoneId: milestone.milestone_id, challengeId: challenge.challengeId }
    );
    assert.equal(reused.status, 409);
  });

  test("an expired code is refused", async () => {
    const { token, plant } = await member("EXPIRED");
    const challenge = await h.issueChallenge(api.base, token, plant.plant_id);

    const { query } = require("../config/db");
    await query(
      "UPDATE verification_challenges SET expires_at = now() - interval '1 minute' WHERE challenge_id = $1",
      [challenge.challengeId]
    );

    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("EXPIRED", { green: true }),
      { challengeId: challenge.challengeId }
    );
    assert.equal(res.status, 410);
  });

  test("codes are unique per attempt", async () => {
    const { token, plant } = await member("CODES");
    const issued = [];
    for (let i = 0; i < 3; i += 1) issued.push(await h.issueChallenge(api.base, token, plant.plant_id));
    const ids = new Set(issued.map((c) => c.challengeId));
    assert.equal(ids.size, 3, "each request issues a new challenge");
  });
});

describe("multipart upload", () => {
  test("a multipart photo is accepted", async () => {
    const { token, plant } = await member("MULTIPART");
    const dataUrl = await h.photoDataUrl("MULTIPART", { green: true });
    const buffer = Buffer.from(dataUrl.split(",")[1], "base64");

    const res = await h.postMultipart(api.base, "/verifications", {
      token,
      file: { buffer, type: "image/jpeg", name: "plant.jpg" },
      fields: { plantId: plant.plant_id },
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.storage_path);
  });

  test("a non-image upload is refused", async () => {
    const { token, plant } = await member("MULTIPARTBAD");
    const res = await h.postMultipart(api.base, "/verifications", {
      token,
      file: { buffer: Buffer.from("hello"), type: "text/plain", name: "note.txt" },
      fields: { plantId: plant.plant_id },
    });
    assert.equal(res.status, 400);
  });

  test("an oversized upload is refused with 413", async () => {
    const { token, plant } = await member("MULTIPARTBIG");
    const res = await h.postMultipart(api.base, "/verifications", {
      token,
      file: { buffer: Buffer.alloc(500000, 7), type: "image/jpeg", name: "big.jpg" },
      fields: { plantId: plant.plant_id },
    });
    assert.equal(res.status, 413);
  });
});

describe("the original photo", () => {
  test("is served to its owner and to nobody else", async () => {
    const { token, plant } = await member("IMAGE");
    const created = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("IMAGE", { green: true })
    );

    const mine = await h.get(api.base, `/verifications/${created.body.verification_id}/image`, { token });
    assert.equal(mine.status, 200);
    assert.match(mine.headers.get("content-type"), /image\//);

    const stranger = await h.signup(api.base);
    const theirs = await h.get(api.base, `/verifications/${created.body.verification_id}/image`, {
      token: stranger.token,
    });
    assert.equal(theirs.status, 404);
  });
});
