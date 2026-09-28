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

  test("a photo with no plant in it is rejected, not approved", async () => {
    const { token, plant } = await member("DIMPHOTO");
    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("DIMPHOTO", { green: false })
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.approval_status, "rejected");
    assert.equal(res.body.verification_result.reasonCode, "no_plant");
  });
});

describe("a single photo is never a reward", () => {
  /** The member's current points, straight from the server. */
  async function points(base, token) {
    const me = await h.get(base, "/auth/me", { token });
    return me.body.total_points;
  }

  test("an approved photo that evidences no milestone pays nothing", async () => {
    const { token, plant } = await member("NOPAY");
    const res = await h.submitRawPhoto(api.base, token, plant.plant_id, await h.photoDataUrl("NOPAY", { green: true }));

    assert.equal(res.status, 201);
    assert.equal(res.body.approval_status, "approved", "the photo itself is usable");
    assert.equal(await points(api.base, token), 0, "but one picture earns no points");
  });

  test("identification and authenticity are reported as separate answers", async () => {
    const { token, plant } = await member("TWOSTATES");
    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("TWOSTATES", { green: true })
    );

    assert.ok(["passed", "failed", "inconclusive"].includes(res.body.identification_status));
    assert.ok(["review_pending", "not_flagged", "rejected"].includes(res.body.authenticity_status));
    assert.notEqual(res.body.authenticity_status, "authentic", "we never claim an image is authentic");
  });

  test("a milestone photo is held for a human, never auto-approved", async () => {
    const { token, plant } = await member("MILESTONE");
    const journey = (await h.get(api.base, "/journeys", { token })).body.find(
      (entry) => entry.user_plant_id === plant.plant_id
    );
    const first = journey.milestones[0];
    const challenge = await h.issueChallenge(api.base, token, plant.plant_id);

    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("MILESTONE", { green: true }),
      { challengeId: challenge.challengeId, milestoneId: first.milestone_id }
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.approval_status, "pending", "a reward-eligible photo always queues for review");
    assert.equal(res.body.requires_review, true);
    assert.equal(res.body.authenticity_status, "review_pending");
    assert.equal(await points(api.base, token), 0, "nothing is paid before the review");
  });

  test("a milestone photo needs a challenge code", async () => {
    const { token, plant } = await member("NOCODE");
    const journey = (await h.get(api.base, "/journeys", { token })).body.find(
      (entry) => entry.user_plant_id === plant.plant_id
    );
    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("NOCODE", { green: true }),
      { milestoneId: journey.milestones[0].milestone_id }
    );
    assert.equal(res.status, 400);
  });
});

describe("the journey must be earned in order", () => {
  test("the final stage cannot be claimed before the earlier ones", async () => {
    const { token, plant } = await member("SKIP");
    const journey = (await h.get(api.base, "/journeys", { token })).body.find(
      (entry) => entry.user_plant_id === plant.plant_id
    );
    const last = journey.milestones[journey.milestones.length - 1];
    const challenge = await h.issueChallenge(api.base, token, plant.plant_id);

    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("SKIP", { green: true }),
      { challengeId: challenge.challengeId, milestoneId: last.milestone_id }
    );

    assert.equal(res.status, 409, "a mature plant cannot be claimed with no earlier evidence");
    assert.equal(res.body.nextStage, "planting", "it tells the member where to start");
    const me = await h.get(api.base, "/auth/me", { token });
    assert.equal(me.body.total_points, 0);
  });
});

describe("the same image cannot serve two plantings", () => {
  test("reusing an image in another planting record is caught", async () => {
    const { token } = await member("REUSE");
    const first = await h.createPlant(api.base, token, { canonicalPlantId: "pl-tomato" });
    const second = await h.createPlant(api.base, token, { canonicalPlantId: "pl-basil" });
    const imageUrl = await h.photoDataUrl("REUSE", { green: true });

    const one = await h.submitRawPhoto(api.base, token, first.plant_id, imageUrl);
    assert.equal(one.status, 201);

    const two = await h.submitRawPhoto(api.base, token, second.plant_id, imageUrl);
    assert.equal(two.body.duplicate_status, "exact", "the same bytes are recognised");
    assert.equal(two.body.approval_status, "rejected");
    assert.equal(two.body.authenticity_status, "rejected");
  });

  test("a lightly modified copy of a submitted image is flagged, not approved", async () => {
    const { token, plant } = await member("RECODE");
    const original = await h.photoDataUrl("RECODE", { green: true });
    await h.submitRawPhoto(api.base, token, plant.plant_id, original);

    const copy = await h.reencodeDataUrl(original);
    const res = await h.submitRawPhoto(api.base, token, plant.plant_id, copy);

    assert.notEqual(res.body.approval_status, "approved", "a re-encoded copy is not new evidence");
    assert.ok(["near", "exact"].includes(res.body.duplicate_status));
  });
});

describe("continuity with the plant's own history", () => {
  test("a first photo has no continuity, a second one is compared to it", async () => {
    const { token, plant } = await member("CONTINUITY");

    const first = await h.submitRawPhoto(api.base, token, plant.plant_id, await h.photoDataUrl("CONT-1", { green: true }));
    assert.equal(first.body.continuity_status, "first", "nothing to compare against yet");
    assert.equal(first.body.continuity_distance, null);

    const second = await h.submitRawPhoto(api.base, token, plant.plant_id, await h.photoDataUrl("CONT-2", { green: true }));
    assert.ok(second.body.continuity_distance !== null, "the earlier frame is compared");
    assert.ok(["consistent", "inconsistent"].includes(second.body.continuity_status));
  });

  test("an unrelated photo of the same plant does not extend the journey silently", async () => {
    const { token, plant } = await member("UNRELATED");
    await h.submitRawPhoto(api.base, token, plant.plant_id, await h.photoDataUrl("UNREL-1", { green: true }));

    const stranger = await h.submitRawPhoto(api.base, token, plant.plant_id, await h.photoDataUrl("STREET-PLANT", { green: true }));

    // A lone photo is only ever evidence: it earns nothing whether or not it
    // looks like the plant's earlier frames. If it does NOT look like them, a
    // human decides instead of the system accepting it quietly.
    const me = await h.get(api.base, "/auth/me", { token });
    assert.equal(me.body.total_points, 0, "no reward for a photo with no verified journey");
    if (stranger.body.continuity_status === "inconsistent") {
      assert.equal(stranger.body.requires_review, true);
      assert.equal(stranger.body.approval_status, "pending");
    }
  });
});

describe("capture challenges", () => {
  test("each challenge carries a fresh code and a randomised instruction", async () => {
    const { token, plant } = await member("CHALLENGE");
    const a = await h.issueChallenge(api.base, token, plant.plant_id);
    const b = await h.issueChallenge(api.base, token, plant.plant_id);

    assert.match(a.code, /^[0-9]{3,8}$/);
    assert.ok(typeof a.instruction === "string" && a.instruction.length > 10, "an instruction to follow");
    assert.notEqual(a.challengeId, b.challengeId, "a new challenge each time");
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
    assert.equal(second.body.approval_status, "rejected", "identical bytes already submitted are refused");
    assert.equal(second.body.verification_result.reasonCode, "duplicate");
  });

  test("a duplicate is caught across members, not just your own history", async () => {
    const a = await member("CROSSA");
    const b = await member("CROSSB");
    const imageUrl = await h.photoDataUrl("CROSS", { green: true });

    await h.submitRawPhoto(api.base, a.token, a.plant.plant_id, imageUrl);
    const res = await h.submitRawPhoto(api.base, b.token, b.plant.plant_id, imageUrl);

    assert.equal(res.body.duplicate_status, "exact");
    assert.equal(res.body.verification_result.crossUser, true);
    assert.equal(res.body.approval_status, "rejected", "another member's photo is refused too");
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
    // A journey is verified in order, so the stages before this one stand first;
    // this test is about the CHALLENGE, not about the order rule.
    await h.completeMilestonesBefore(journey, milestone.stage_key);

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

/** Uploads a fixture under a specific filename (multipart), so the
 * filename-based signals can be exercised. */
async function submitNamed(token, plantId, dataUrl, name) {
  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  const type = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";
  return h.postMultipart(api.base, "/verifications", {
    token,
    file: { buffer, type, name },
    fields: { plantId },
  });
}

describe("originality: images that did not come from the member's camera", () => {
  test("a screenshot is rejected as a screenshot, even with no filename", async () => {
    const { token, plant } = await member("SHOT");
    const res = await h.submitRawPhoto(api.base, token, plant.plant_id, await h.screenshotDataUrl());

    assert.equal(res.status, 201);
    assert.equal(res.body.approval_status, "rejected");
    assert.equal(res.body.verification_result.reasonCode, "screenshot");
    assert.ok(
      res.body.verification_result.provenance.indicators.includes("screenshot_signature"),
      "the screenshot signature should be recorded on the result"
    );
  });

  test("a stock-library filename is rejected as sourced", async () => {
    const { token, plant } = await member("STOCK");
    const res = await submitNamed(
      token,
      plant.plant_id,
      await h.photoDataUrl("STOCK", { green: true }),
      "shutterstock_123456789.jpg"
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.approval_status, "rejected");
    assert.equal(res.body.verification_result.reasonCode, "likely_sourced");
    assert.ok(res.body.verification_result.provenance.indicators.includes("stock_filename"));
  });

  test("a photographed screenshot filename is rejected too", async () => {
    const { token, plant } = await member("SHOTNAME");
    const res = await submitNamed(
      token,
      plant.plant_id,
      await h.photoDataUrl("SHOTNAME", { green: true }),
      "Screenshot 2026-09-24 at 10.00.00.jpg"
    );
    assert.equal(res.body.approval_status, "rejected");
    assert.equal(res.body.verification_result.reasonCode, "screenshot");
  });

  test("a generic filename alone is not a rejection", async () => {
    const { token, plant } = await member("GENERIC");
    const res = await submitNamed(
      token,
      plant.plant_id,
      await h.photoDataUrl("GENERIC", { green: true }),
      "image (1).jpg"
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.approval_status, "approved", "one weak hint must not block a member");
    assert.ok(res.body.verification_result.provenance.indicators.includes("generic_filename"));
  });

  test("a renamed file (png extension, jpeg bytes) is not rejected on that alone", async () => {
    const { token, plant } = await member("RENAMED");
    const res = await submitNamed(
      token,
      plant.plant_id,
      await h.photoDataUrl("RENAMED", { green: true }),
      "plant.png"
    );

    assert.equal(res.body.approval_status, "approved");
    assert.ok(res.body.verification_result.provenance.indicators.includes("renamed_file"));
  });
});

describe("legitimate camera photos still pass", () => {
  test("a camera photo with no EXIF at all is accepted", async () => {
    const { token, plant } = await member("NOEXIF");
    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("NOEXIF", { green: true })
    );

    assert.equal(res.body.approval_status, "approved");
    assert.equal(res.body.verification_result.provenance.checks.hasExif, false, "no metadata is not a strike");
    assert.equal(res.body.verification_result.provenance.verdict, "neutral");
  });

  test("a phone-named camera image with stripped metadata is accepted", async () => {
    const { token, plant } = await member("PHONENAME");
    const res = await submitNamed(
      token,
      plant.plant_id,
      await h.photoDataUrl("PHONENAME", { green: true }),
      "IMG_20260924_101500.jpg"
    );

    assert.equal(res.body.approval_status, "approved");
    assert.ok(res.body.verification_result.provenance.positive.includes("camera_filename"));
  });

  test("a real but unusable plant photo is held for review, not accepted", async () => {
    const { token, plant } = await member("POOR");
    const res = await h.submitRawPhoto(api.base, token, plant.plant_id, await h.blurryPlantDataUrl());

    assert.equal(res.body.approval_status, "pending");
    assert.equal(res.body.requires_review, true);
    assert.equal(res.body.verification_result.plantMatch, null, "no model, so the plant is only inferred");
  });

  test("a very low-resolution plant photo is held for review", async () => {
    const { token, plant } = await member("LOWRES");
    const res = await h.submitRawPhoto(
      api.base,
      token,
      plant.plant_id,
      await h.photoDataUrl("LOWRES", { green: true, width: 160, height: 120 })
    );

    assert.equal(res.body.approval_status, "pending");
    assert.ok(res.body.verification_result.provenance.indicators.includes("low_resolution"));
  });
});

describe("the model's capture verdict is enforced, not just the plant match", () => {
  /** Stubs only the provider call, so the test client's own HTTP still works. */
  async function withModelReply(payload, run) {
    const realFetch = global.fetch;
    const previousKey = process.env.AI_API_KEY;
    process.env.AI_API_KEY = "test-key";

    global.fetch = async (url, options) => {
      if (!String(url).includes("/chat/completions")) return realFetch(url, options);
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      };
    };

    try {
      await run();
    } finally {
      global.fetch = realFetch;
      if (previousKey === undefined) delete process.env.AI_API_KEY;
      else process.env.AI_API_KEY = previousKey;
    }
  }

  test("a downloaded plant photo is rejected even though a plant is visible", async () => {
    await withModelReply(
      { plantMatch: true, captured: false, screenshot: false, watermark: false, confidence: 0.95, reason: "stock-style studio shot" },
      async () => {
        const { token, plant } = await member("DOWNLOADED");
        const res = await h.submitRawPhoto(
          api.base,
          token,
          plant.plant_id,
          await h.photoDataUrl("DOWNLOADED", { green: true })
        );

        assert.equal(res.body.verification_result.plantMatch, true, "the plant check did pass");
        assert.equal(res.body.approval_status, "rejected", "but the image is not the member's own");
        assert.equal(res.body.verification_result.reasonCode, "likely_sourced");
      }
    );
  });

  test("a watermark rejects the photo", async () => {
    await withModelReply(
      { plantMatch: true, captured: true, screenshot: false, watermark: true, confidence: 0.9, reason: "watermarked" },
      async () => {
        const { token, plant } = await member("WATERMARK");
        const res = await h.submitRawPhoto(
          api.base,
          token,
          plant.plant_id,
          await h.photoDataUrl("WATERMARK", { green: true })
        );
        assert.equal(res.body.approval_status, "rejected");
      }
    );
  });

  test("no plant detected by the model rejects a clean, original photo", async () => {
    await withModelReply(
      { plantMatch: false, captured: true, screenshot: false, watermark: false, confidence: 0.9, reason: "no plant here" },
      async () => {
        const { token, plant } = await member("NOPLANT");
        const res = await h.submitRawPhoto(
          api.base,
          token,
          plant.plant_id,
          await h.photoDataUrl("NOPLANT", { green: true })
        );
        assert.equal(res.body.approval_status, "rejected");
        assert.equal(res.body.verification_result.reasonCode, "no_plant");
      }
    );
  });

  test("an unsure model never auto-accepts — it queues", async () => {
    await withModelReply(
      { plantMatch: true, captured: null, screenshot: null, watermark: null, confidence: 0.9, reason: "cannot tell" },
      async () => {
        const { token, plant } = await member("UNSURE");
        const res = await h.submitRawPhoto(
          api.base,
          token,
          plant.plant_id,
          await h.photoDataUrl("UNSURE", { green: true })
        );
        assert.equal(res.body.approval_status, "pending");
        assert.equal(res.body.requires_review, true);
      }
    );
  });

  test("an original photo the model confirms is approved", async () => {
    await withModelReply(
      { plantMatch: true, captured: true, screenshot: false, watermark: false, confidence: 0.92, reason: "looks like a home photo" },
      async () => {
        const { token, plant } = await member("ORIGINAL");
        const res = await h.submitRawPhoto(
          api.base,
          token,
          plant.plant_id,
          await h.photoDataUrl("ORIGINAL", { green: true })
        );
        assert.equal(res.body.approval_status, "approved");
        assert.equal(res.body.verification_result.captured, true);
      }
    );
  });
});

describe("the decision cannot be made from the client", () => {
  test("client-supplied verdict fields are ignored", async () => {
    const { token, plant } = await member("BYPASS");
    const res = await h.post(api.base, "/verifications", {
      token,
      body: {
        plantId: plant.plant_id,
        imageUrl: await h.photoDataUrl("BYPASS", { green: false }),
        // A member cannot assert their own result.
        verified: true,
        approvalStatus: "approved",
        approval_status: "approved",
        confidence: 1,
        requires_review: false,
      },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.approval_status, "rejected", "the server's own decision stands");
    assert.equal(res.body.verification_result.reasonCode, "no_plant");
  });
});

describe("the decision policy in isolation", () => {
  const ctrl = () => require("../controllers/verifications.controller");

  const base = {
    analysis: { pixelStats: { greenRatio: 0.6 } },
    duplicates: { status: "none", matches: [] },
    milestone: null,
    challengePassed: null,
    confidence: 0.9,
  };

  test("a plant match alone never accepts when provenance is suspicious", () => {
    const outcome = ctrl()._decide({
      ...base,
      signals: { plantMatch: true, captured: true, screenshot: false, watermark: false },
      provenance: { verdict: "suspicious", reasonCode: "screenshot" },
    });
    assert.equal(outcome.approvalStatus, "rejected");
    assert.equal(outcome.reasonCode, "screenshot");
  });

  test("no plant signal at all rejects", () => {
    const outcome = ctrl()._decide({
      ...base,
      analysis: { pixelStats: { greenRatio: 0 } },
      signals: null,
      provenance: { verdict: "neutral" },
    });
    assert.equal(outcome.approvalStatus, "rejected");
    assert.equal(outcome.reasonCode, "no_plant");
  });

  test("an uncertain provenance verdict queues instead of accepting", () => {
    const outcome = ctrl()._decide({
      ...base,
      signals: null,
      provenance: { verdict: "uncertain", reasonCode: "uncertain" },
    });
    assert.equal(outcome.approvalStatus, "pending");
    assert.equal(outcome.requiresReview, true);
  });

  test("a milestone photo is never auto-accepted", () => {
    const outcome = ctrl()._decide({
      ...base,
      signals: null,
      provenance: { verdict: "neutral" },
      milestone: { milestone_id: "m1" },
      challengePassed: true,
    });
    assert.equal(outcome.approvalStatus, "pending");
  });

  test("an approved plant photo is the only path to acceptance", () => {
    const outcome = ctrl()._decide({
      ...base,
      signals: null,
      provenance: { verdict: "neutral" },
    });
    assert.equal(outcome.approvalStatus, "approved");
    assert.equal(outcome.reasonCode, "ok");
  });
});

describe("provenance signals in isolation", () => {
  const provenance = require("../services/provenance.service");

  test("filename families are recognised", () => {
    assert.equal(provenance.extensionMismatch("plant.png", "jpeg"), true);
    assert.equal(provenance.extensionMismatch("plant.jpg", "jpeg"), false);
    assert.equal(provenance.looksLikeScreenSize(1280, 960), true);
    assert.equal(provenance.looksLikeScreenSize(4032, 3024), false);
  });

  test("missing metadata is neutral, never suspicious", () => {
    const result = provenance.assess({
      analysis: { format: "jpeg", width: 4032, height: 3024, metadata: { hasExif: false, text: "" }, bandStats: { top: 900, center: 1200, bottom: 800 } },
      filename: null,
    });
    assert.equal(result.verdict, "neutral");
    assert.deepEqual(result.indicators, []);
  });

  test("a screenshot signature needs several signals to agree", () => {
    // Busy screen-shaped PNG with flat bars and no metadata -> suspicious.
    const shot = provenance.assess({
      analysis: { format: "png", width: 1280, height: 720, metadata: { hasExif: false, text: "" }, bandStats: { top: 0, center: 400, bottom: 0 } },
    });
    assert.equal(shot.verdict, "suspicious");
    assert.equal(shot.reasonCode, "screenshot");

    // The same flat bars on a JPEG with camera metadata are just a plain photo.
    const photo = provenance.assess({
      analysis: { format: "jpeg", width: 4032, height: 3024, metadata: { hasExif: true, text: "apple iphone" }, bandStats: { top: 0, center: 400, bottom: 0 } },
    });
    assert.notEqual(photo.verdict, "suspicious");
  });
});

describe("what the pipeline refuses outright", () => {
  // The policy is pure, so these need no model and no network: they pin the
  // rules that stop an image earning points it cannot support.
  const { _decide } = require("../controllers/verifications.controller");

  const base = {
    analysis: { pixelStats: { greenRatio: 0.4 } },
    provenance: { verdict: "clean", score: 0.9, indicators: [], positive: [], checks: [] },
    duplicates: { status: "none", matches: [] },
    continuity: { status: "first", distance: null, compared: 0 },
    milestone: null,
    challengePassed: null,
    confidence: 0.99,
  };

  test("a fake plant is rejected however confident the model is", () => {
    const out = _decide({
      ...base,
      signals: { plantMatch: true, captured: true, artificialPlant: true, stageMatch: true },
    });
    assert.equal(out.approvalStatus, "rejected");
    assert.equal(out.reasonCode, "not_a_real_plant");
  });

  test("a fully grown plant cannot evidence an early stage", () => {
    const out = _decide({
      ...base,
      signals: { plantMatch: true, captured: true, stageMatch: false },
      milestone: { stage_key: "planting" },
    });
    assert.equal(out.approvalStatus, "rejected");
    assert.equal(out.reasonCode, "stage_mismatch");
  });

  test("a milestone photo without the challenge code is rejected", () => {
    const out = _decide({
      ...base,
      signals: { plantMatch: true, captured: true, challengePassed: false },
      milestone: { stage_key: "planting" },
    });
    assert.equal(out.approvalStatus, "rejected");
    assert.equal(out.reasonCode, "challenge_failed");
  });

  test("an image that looks taken from somewhere else is rejected", () => {
    const out = _decide({ ...base, signals: { plantMatch: true, captured: false } });
    assert.equal(out.approvalStatus, "rejected");
  });

  test("a photo of a plant with no milestone still earns nothing", () => {
    const out = _decide({ ...base, signals: { plantMatch: true, captured: true }, confidence: 1 });
    assert.equal(out.approvalStatus, "approved", "usable as evidence");
    // and the reward engine pays nothing for it — see the points tests
  });

  test("high confidence alone never approves a milestone photo", () => {
    const out = _decide({
      ...base,
      signals: { plantMatch: true, captured: true, challengePassed: true },
      milestone: { stage_key: "harvest" },
      confidence: 1,
    });
    assert.equal(out.approvalStatus, "pending");
    assert.equal(out.requiresReview, true);
  });

  test("an unknown signal asks a human instead of guessing", () => {
    const out = _decide({ ...base, signals: { plantMatch: null, captured: null }, milestone: { stage_key: "harvest" } });
    assert.equal(out.approvalStatus, "pending");
    assert.equal(out.requiresReview, true);
  });
});
