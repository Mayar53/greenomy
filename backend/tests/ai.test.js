// tests/ai.test.js — the optional AI features, exercised with NO key configured
// (the state this project ships in). The point is that everything degrades
// predictably rather than breaking.
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

const TINY_IMAGE = "data:image/jpeg;base64,AAAA";

describe("AI features without a key", () => {
  test("identify reports that AI is not configured, with a usable message", async () => {
    const { token } = await h.signup(api.base);

    const res = await h.post(api.base, "/ai/identify", { token, body: { imageUrl: TINY_IMAGE } });

    assert.equal(res.status, 503);
    assert.match(res.body.error, /not configured/i);
  });

  test("assistant reports that AI is not configured", async () => {
    const { token } = await h.signup(api.base);

    const res = await h.post(api.base, "/ai/assistant", { token, body: { message: "Why are my leaves yellow?" } });

    assert.equal(res.status, 503);
    assert.match(res.body.error, /not configured/i);
  });

  test("both are closed to anonymous callers", async () => {
    const identify = await h.post(api.base, "/ai/identify", { body: { imageUrl: TINY_IMAGE } });
    assert.equal(identify.status, 401);

    const assistant = await h.post(api.base, "/ai/assistant", { body: { message: "hi" } });
    assert.equal(assistant.status, 401);
  });

  test("input is validated before any provider call", async () => {
    const { token } = await h.signup(api.base);

    const noImage = await h.post(api.base, "/ai/identify", { token, body: {} });
    assert.equal(noImage.status, 400);

    const noMessage = await h.post(api.base, "/ai/assistant", { token, body: {} });
    assert.equal(noMessage.status, 400);
  });
});

describe("AI verification resilience", () => {
  test("selecting the AI provider without a usable key still verifies a photo", async () => {
    const previousProvider = process.env.VERIFICATION_PROVIDER;
    const previousKey = process.env.AI_API_KEY;
    const previousTimeout = process.env.AI_TIMEOUT_MS;

    // A key that is present but wrong: the provider is selected, the call fails,
    // and the controller must fall back to the heuristic scorer.
    process.env.VERIFICATION_PROVIDER = "ai";
    process.env.AI_API_KEY = "sk-invalid-test-key";
    process.env.AI_TIMEOUT_MS = "4000";

    try {
      const { token } = await h.signup(api.base);
      const plant = await h.createPlant(api.base, token);

      const submitted = await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, "AIFALLBACK");

      assert.equal(submitted.status, 201, "a provider failure must not fail the submission");
      assert.equal(submitted.body.approval_status, "approved");
      assert.equal(submitted.body.ai_provider, "heuristic", "should have fallen back to the heuristic");

      const wallet = await h.get(api.base, "/wallet", { token });
      assert.equal(wallet.body.currentPoints, 30, "points are still awarded");
    } finally {
      process.env.VERIFICATION_PROVIDER = previousProvider;
      if (previousKey === undefined) delete process.env.AI_API_KEY;
      else process.env.AI_API_KEY = previousKey;
      process.env.AI_TIMEOUT_MS = previousTimeout;
    }
  });

  test("the default provider stays offline (no AI key needed)", async () => {
    delete process.env.AI_API_KEY;
    process.env.AI_API_KEY = "";

    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token);
    const submitted = await h.submitPhoto(api.base, token, plant.plant_id, h.SHARP_GREEN_PHOTO, "HEURISTIC");

    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.ai_provider, "heuristic");
  });
});
