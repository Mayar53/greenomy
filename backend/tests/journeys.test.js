// tests/journeys.test.js — a plant becomes a journey with stage-based
// milestones, and completing them walks the plant through its growth stages.
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

/** Creates a plant and returns its journey (with milestones) from the API. */
async function plantWithJourney(base, token, body) {
  const plant = await h.post(base, "/plants", { token, body });
  assert.equal(plant.status, 201, JSON.stringify(plant.body));

  const journeys = await h.get(base, "/journeys", { token });
  const journey = journeys.body.find((entry) => entry.user_plant_id === plant.body.plant_id);
  assert.ok(journey, "the new plant has a journey");
  return { plant: plant.body, journey };
}

describe("journey creation", () => {
  test("creating a plant starts a stage-based journey", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-tomato" });

    const stages = journey.milestones.map((m) => m.stage_key);
    assert.equal(stages[0], "planting");
    assert.equal(stages[stages.length - 1], "harvest");
    assert.ok(stages.includes("flowering"), "a fruiting crop has a flowering stage");
    assert.equal(journey.milestones.length, 7);
    assert.equal(journey.status, "active");
  });

  test("milestone windows are ordered and end at the plant's harvest day", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-tomato" });

    const last = journey.milestones[journey.milestones.length - 1];
    assert.equal(last.expected_day_to, 70, "tomato harvests at 70 days");
    assert.equal(journey.expected_duration_days, 70);

    let previous = -1;
    for (const milestone of journey.milestones) {
      assert.ok(milestone.expected_day_from >= previous, `${milestone.stage_key} is in order`);
      previous = milestone.expected_day_from;
    }
  });

  test("different plants get different schedules", async () => {
    const { token } = await h.signup(api.base);
    const radish = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-radish" });
    const lemon = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-lemon-tree" });

    assert.equal(radish.journey.expected_duration_days, 25);
    assert.equal(lemon.journey.expected_duration_days, 1095);
    assert.notEqual(
      radish.journey.milestones.at(-1).recommended_window,
      lemon.journey.milestones.at(-1).recommended_window
    );
  });

  test("starting from a seedling skips germination", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, {
      canonicalPlantId: "pl-tomato",
      plantingMethod: "Transplanted Seedling",
    });

    assert.ok(!journey.milestones.some((m) => m.stage_key === "germination"));
  });

  test("a plant with no catalog match still gets a journey", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { customName: "Mystery pepper" });
    assert.ok(journey.milestones.length > 0);
  });

  test("requesting a journey twice returns the same one", async () => {
    const { token } = await h.signup(api.base);
    const { plant } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-basil" });

    const again = await h.post(api.base, "/journeys", { token, body: { plantId: plant.plant_id } });
    assert.equal(again.status, 200, "not a second journey");
    assert.equal(again.body.created, false);
  });

  test("a plant that is not yours has no journey", async () => {
    const owner = await h.signup(api.base);
    const { plant } = await plantWithJourney(api.base, owner.token, { canonicalPlantId: "pl-basil" });

    const stranger = await h.signup(api.base);
    const res = await h.post(api.base, "/journeys", { token: stranger.token, body: { plantId: plant.plant_id } });
    assert.equal(res.status, 404);
  });

  test("journeys require a session", async () => {
    const res = await h.get(api.base, "/journeys");
    assert.equal(res.status, 401);
  });
});

describe("milestones", () => {
  test("completing a milestone advances the stage", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-tomato" });

    const first = journey.milestones[0];
    const res = await h.post(api.base, `/journeys/${journey.journey_id}/milestones/${first.milestone_id}/complete`, {
      token,
      body: {},
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.journey.current_stage, "planting");
    assert.ok(res.body.milestones[0].completed_at, "the milestone is closed");

    // Idempotent: closing it again changes nothing.
    const again = await h.post(api.base, `/journeys/${journey.journey_id}/milestones/${first.milestone_id}/complete`, {
      token,
      body: {},
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.milestones[0].completed_at, res.body.milestones[0].completed_at);
  });

  test("an unknown milestone is a 404", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-tomato" });

    const res = await h.post(
      api.base,
      `/journeys/${journey.journey_id}/milestones/00000000-0000-0000-0000-000000000000/complete`,
      { token, body: {} }
    );
    assert.equal(res.status, 404);
  });

  test("completing every milestone completes the journey", async () => {
    const { token } = await h.signup(api.base);
    const { journey } = await plantWithJourney(api.base, token, { canonicalPlantId: "pl-radish" });

    let last;
    for (const milestone of journey.milestones) {
      last = await h.post(
        api.base,
        `/journeys/${journey.journey_id}/milestones/${milestone.milestone_id}/complete`,
        { token, body: {} }
      );
      assert.equal(last.status, 200);
    }

    assert.equal(last.body.journey.status, "completed");
    assert.ok(last.body.journey.completed_at);
    assert.equal(last.body.journey.current_stage, "harvest");
  });
});
