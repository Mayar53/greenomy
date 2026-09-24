// tests/recommendations.test.js — the plant recommender.
//
// Two halves:
//  - the ranking is tested as a pure function with a FIXED "now", so the
//    assertions don't drift with the calendar;
//  - the API is tested against the seeded catalog with WEATHER_PROVIDER=offline
//    (set in helpers.js), so nothing here touches the network.
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

const {
  recommend,
  buildContext,
  scoreEntry,
  durationDaysFor,
  TOTAL_WEIGHT,
} = require("../services/recommendation.service");
const { seasonFor, northernMonthFor, climateZone, normaliseCity } = require("../services/weather.service");

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

// ---------------------------------------------------------------- fixtures ---
// Snake_case, as the DB returns them.
const entry = (over = {}) => ({
  id: "pl-x",
  name: "X",
  slug: "x",
  category: "vegetables",
  emoji: "🌱",
  days_to_harvest: 60,
  difficulty: "easy",
  indoor: true,
  outdoor: true,
  sun: "full",
  water: "medium",
  climates: ["temperate"],
  planting_months: [3, 4, 5],
  notes: null,
  i18n: {},
  ...over,
});

// September in the north: temperate, month 9.
const AUTUMN_NORTH = { climate: "temperate", northernMonth: 9, durationDays: Number.POSITIVE_INFINITY, space: "both", experience: null, plantTypes: [] };

describe("ranking (pure)", () => {
  test("a plant in season outscores the same plant out of season", () => {
    const inSeason = entry({ planting_months: [8, 9, 10] });
    const outOfSeason = entry({ planting_months: [3, 4, 5] });

    const a = scoreEntry(inSeason, AUTUMN_NORTH);
    const b = scoreEntry(outOfSeason, AUTUMN_NORTH);

    assert.ok(a.score > b.score, `${a.score} should beat ${b.score}`);
    assert.ok(a.reasons.includes("inSeason"));
    assert.ok(b.reasons.includes("outOfSeason"));
  });

  test("an empty plantingMonths list means any month is in season", () => {
    const anyTime = scoreEntry(entry({ planting_months: [] }), AUTUMN_NORTH);
    assert.ok(anyTime.reasons.includes("inSeason"));
  });

  test("a matching climate outscores a mismatched one", () => {
    const match = scoreEntry(entry({ climates: ["temperate"] }), AUTUMN_NORTH);
    const mismatch = scoreEntry(entry({ climates: ["tropical"] }), AUTUMN_NORTH);

    assert.ok(match.score > mismatch.score);
    assert.ok(match.reasons.includes("climateMatch"));
    assert.ok(mismatch.reasons.includes("differentClimate"));
  });

  test("a stated preference lifts that category and flags others", () => {
    const ctx = { ...AUTUMN_NORTH, plantTypes: ["herbs"] };
    const preferred = scoreEntry(entry({ category: "herbs" }), ctx);
    const other = scoreEntry(entry({ category: "vegetables" }), ctx);

    assert.ok(preferred.score > other.score);
    assert.ok(preferred.reasons.includes("matchesPreference"));
    assert.ok(other.reasons.includes("outsidePreference"));
  });

  test("with no stated preference nothing is penalised", () => {
    const { reasons } = scoreEntry(entry({ category: "herbs" }), AUTUMN_NORTH);
    assert.ok(!reasons.includes("outsidePreference"));
  });

  test("a beginner is not credited for a hard plant", () => {
    const easy = scoreEntry(entry({ difficulty: "easy" }), { ...AUTUMN_NORTH, experience: "beginner" });
    const hard = scoreEntry(entry({ difficulty: "hard" }), { ...AUTUMN_NORTH, experience: "beginner" });

    assert.ok(easy.reasons.includes("fitsExperience"));
    assert.ok(hard.reasons.includes("needsExperience"));
    assert.ok(easy.score > hard.score);
  });

  test("an entry is never credited beyond the total weight", () => {
    const perfect = scoreEntry(entry({ climates: ["temperate"], planting_months: [], category: "vegetables" }), {
      ...AUTUMN_NORTH,
      plantTypes: ["vegetables"],
      experience: "expert",
    });
    assert.ok(perfect.score <= TOTAL_WEIGHT);
    assert.equal(perfect.score, TOTAL_WEIGHT);
  });
});

describe("hard filters", () => {
  test("duration maps to a day budget", () => {
    assert.equal(durationDaysFor("weeks"), 30);
    assert.equal(durationDaysFor("months"), 120);
    assert.equal(durationDaysFor("season"), 270);
    assert.equal(durationDaysFor("any"), Number.POSITIVE_INFINITY);
    assert.equal(durationDaysFor("nonsense"), Number.POSITIVE_INFINITY);
  });

  test("duration=weeks excludes a tree that takes years", () => {
    const catalog = [entry({ id: "pl-radish", days_to_harvest: 25 }), entry({ id: "pl-lemon", days_to_harvest: 1095 })];
    const ctx = buildContext({ climate: "temperate", northernMonth: 9 }, { duration: "weeks" });

    const ids = recommend(catalog, ctx).map((r) => r.id);
    assert.deepEqual(ids, ["pl-radish"]);
  });

  test("space=indoor excludes an outdoor-only plant", () => {
    const catalog = [entry({ id: "pl-pothos", indoor: true, outdoor: false }), entry({ id: "pl-carrot", indoor: false, outdoor: true })];
    const ctx = buildContext({ climate: "temperate", northernMonth: 9 }, { space: "indoor" });

    assert.deepEqual(recommend(catalog, ctx).map((r) => r.id), ["pl-pothos"]);
  });

  test("results are capped and carry the score plus reasons", () => {
    const catalog = Array.from({ length: 12 }, (_, i) => entry({ id: `pl-${i}`, name: `Plant ${i}` }));
    const ctx = buildContext({ climate: "temperate", northernMonth: 9 }, {});

    const results = recommend(catalog, ctx, 6);
    assert.equal(results.length, 6);
    for (const item of results) {
      assert.equal(typeof item.score, "number");
      assert.equal(item.maxScore, TOTAL_WEIGHT);
      assert.ok(Array.isArray(item.reasons) && item.reasons.length > 0);
    }
  });
});

describe("weather helpers (offline)", () => {
  test("seasons map correctly in both hemispheres", () => {
    assert.equal(seasonFor(4, "northern"), "spring");
    assert.equal(seasonFor(7, "northern"), "summer");
    assert.equal(seasonFor(10, "northern"), "autumn");
    assert.equal(seasonFor(1, "northern"), "winter");
    // A southern July is a winter month.
    assert.equal(seasonFor(7, "southern"), "winter");
    assert.equal(seasonFor(1, "southern"), "summer");
  });

  test("a southern month is mapped north before comparing planting months", () => {
    assert.equal(northernMonthFor(7, "northern"), 7);
    assert.equal(northernMonthFor(7, "southern"), 1);
    assert.equal(northernMonthFor(1, "southern"), 7);
  });

  test("climate zones stay within the catalog vocabulary", () => {
    const allowed = ["tropical", "arid", "subtropical", "mediterranean", "temperate", "continental", "cold"];
    const cases = [
      { latitude: 5, temperature: 28, weeklyRain: 40 },
      { latitude: 30, temperature: 38, weeklyRain: 0 },
      { latitude: 36, temperature: 25, weeklyRain: 10 },
      { latitude: 41, temperature: 24, weeklyRain: 20 },
      { latitude: 52, temperature: 6, weeklyRain: 30 },
      { latitude: 65, temperature: -5, weeklyRain: 10 },
    ];
    for (const input of cases) {
      assert.ok(allowed.includes(climateZone(input)), `${JSON.stringify(input)} -> ${climateZone(input)}`);
    }
  });

  test("city names are normalised so 'New York' matches 'newyork'", () => {
    assert.equal(normaliseCity(" New  York "), "newyork");
  });
});

describe("GET /api/recommendations", () => {
  test("requires a session", async () => {
    const res = await h.get(api.base, "/recommendations");
    assert.equal(res.status, 401);
  });

  test("returns conditions and a ranked list from the catalog, with no network", async () => {
    const { token } = await h.signup(api.base);
    await h.patch(api.base, "/users/me", { token, body: { city: "Erbil" } });

    const res = await h.get(api.base, "/recommendations", { token });
    assert.equal(res.status, 200);

    assert.equal(res.body.conditions.source, "climate-table");
    assert.equal(res.body.conditions.city, "Erbil");
    assert.equal(res.body.conditions.climate, "subtropical");
    assert.ok(res.body.recommendations.length > 0);

    // Descending score.
    const scores = res.body.recommendations.map((r) => r.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  test("every recommendation comes from the catalog — nothing is invented", async () => {
    const { token } = await h.signup(api.base);
    const recs = await h.get(api.base, "/recommendations", { token });
    const catalog = await h.get(api.base, "/catalog");

    assert.equal(catalog.status, 200);
    const known = new Set(catalog.body.map((entry) => entry.id));

    for (const item of recs.body.recommendations) {
      assert.ok(known.has(item.id), `${item.id} is not in the catalog`);
      assert.ok(item.daysToHarvest > 0);
      assert.ok(["vegetables", "herbs", "fruit-trees", "houseplants"].includes(item.category));
    }
  });

  test("duration=weeks never returns a slow crop", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.get(api.base, "/recommendations?duration=weeks", { token });

    assert.ok(res.body.recommendations.length > 0);
    for (const item of res.body.recommendations) {
      assert.ok(item.daysToHarvest <= 30, `${item.name} takes ${item.daysToHarvest} days`);
    }
  });

  test("space=indoor never returns an outdoor-only plant", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.get(api.base, "/recommendations?space=indoor", { token });

    assert.ok(res.body.recommendations.length > 0);
    for (const item of res.body.recommendations) {
      assert.equal(item.indoor, true, `${item.name} cannot live indoors`);
    }
  });

  test("an unrecognised city falls back to a general climate instead of erroring", async () => {
    const { token } = await h.signup(api.base);
    await h.patch(api.base, "/users/me", { token, body: { city: "Zzzznowhere" } });

    const res = await h.get(api.base, "/recommendations", { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.conditions.approximate, true);
    assert.equal(res.body.conditions.climate, "temperate");
    assert.ok(res.body.recommendations.length > 0);
  });

  test("a member's stored preference is applied and echoed back", async () => {
    const { token } = await h.signup(api.base);
    await h.patch(api.base, "/users/me", { token, body: { plantTypes: ["houseplants"] } });

    const res = await h.get(api.base, "/recommendations", { token });
    assert.deepEqual(res.body.appliedPreference.plantTypes, ["houseplants"]);

    for (const item of res.body.recommendations) {
      if (item.category === "houseplants") {
        assert.ok(item.reasons.includes("matchesPreference"), `${item.name} should be flagged as preferred`);
      } else {
        assert.ok(!item.reasons.includes("matchesPreference"), `${item.name} should not be flagged as preferred`);
      }
    }
  });
});

describe("preferences survive on the account", () => {
  test("experience, plant types and interests are stored and returned", async () => {
    const { token } = await h.signup(api.base);

    const saved = await h.patch(api.base, "/users/me", {
      token,
      body: {
        experience: "beginner",
        plantTypes: ["herbs", "houseplants"],
        interests: ["composting", "zero-waste"],
      },
    });
    assert.equal(saved.status, 200);

    const me = await h.get(api.base, "/auth/me", { token });
    assert.equal(me.body.experience, "beginner");
    assert.deepEqual(me.body.plant_types, ["herbs", "houseplants"]);
    assert.deepEqual(me.body.interests, ["composting", "zero-waste"]);
  });

  test("a partial update leaves the other preferences alone", async () => {
    const { token } = await h.signup(api.base);
    await h.patch(api.base, "/users/me", { token, body: { experience: "expert", plantTypes: ["herbs"] } });

    await h.patch(api.base, "/users/me", { token, body: { city: "Erbil" } });

    const me = await h.get(api.base, "/auth/me", { token });
    assert.equal(me.body.experience, "expert");
    assert.deepEqual(me.body.plant_types, ["herbs"]);
    assert.equal(me.body.city, "Erbil");
  });

  test("an unknown experience level is rejected with 400, not a database error", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.patch(api.base, "/users/me", { token, body: { experience: "wizard" } });
    assert.equal(res.status, 400);
  });

  test("unknown categories are dropped rather than stored", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.patch(api.base, "/users/me", {
      token,
      body: { plantTypes: ["herbs", "not-a-category"], interests: ["composting", "nonsense"] },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.plant_types, ["herbs"]);
    assert.deepEqual(res.body.interests, ["composting"]);
  });
});
