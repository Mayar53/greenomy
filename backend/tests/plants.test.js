// tests/plants.test.js — the canonical catalog: one identity per plant,
// searchable in every supported language, with sourced facts and aliases.
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

describe("canonical identity", () => {
  test("every spelling of tomato resolves to ONE catalog row", async () => {
    const { body } = await h.get(api.base, "/catalog");

    const bySlug = body.filter((plant) => plant.slug === "tomato");
    assert.equal(bySlug.length, 1, "exactly one tomato row");

    const byScientific = body.filter((plant) => plant.scientific_name === "Solanum lycopersicum");
    assert.equal(byScientific.length, 1, "no duplicate canonical tomato by taxonomy");
    assert.equal(byScientific[0].id, bySlug[0].id);
  });

  test("the catalog carries taxonomy, stages and sourced facts", async () => {
    const { body } = await h.get(api.base, "/catalog/tomato");

    assert.equal(body.family, "Solanaceae");
    assert.equal(body.stage_template, "annual-vegetable");
    assert.ok(body.germination_duration_days > 0);
    assert.ok(body.soil_ph_min > 0 && body.soil_ph_max > body.soil_ph_min);
    assert.ok(body.varieties.length >= 2, "tomato has varieties");
    assert.ok(
      body.knowledge.some((fact) => fact.knowledge_type === "germination_duration_days"),
      "facts are stored as knowledge rows"
    );
    assert.ok(
      body.knowledge.every((fact) => fact.source_id),
      "every fact keeps its provenance"
    );
  });

  test("an unknown slug is a 404, not an empty 200", async () => {
    const res = await h.get(api.base, "/catalog/not-a-real-plant");
    assert.equal(res.status, 404);
  });
});

describe("search across languages", () => {
  const cases = [
    ["tomato", "en"],
    ["Tomatoes", "en"],
    ["Solanum lycopersicum", "en"],
    ["طماطم", "ar"],
    ["طماطة", "ar"],
    ["بندورة", "ar"],
    ["الطماطم", "ar"],
    ["تەماتە", "ku"],
  ];

  for (const [query, lang] of cases) {
    test(`"${query}" (${lang}) reaches the one tomato`, async () => {
      const { body } = await h.get(
        api.base,
        `/catalog/search?q=${encodeURIComponent(query)}&lang=${lang}`
      );
      assert.ok(body.length >= 1, `expected a match for "${query}"`);
      assert.equal(body[0].slug, "tomato", `"${query}" should resolve to tomato first`);
    });
  }

  test("other regional names reach their own plant", async () => {
    const checks = [
      ["خيار", "cucumber"],
      ["باذنجان", "eggplant"],
      ["ريحان", "basil"],
      ["جزر", "carrot"],
    ];
    for (const [query, slug] of checks) {
      const { body } = await h.get(api.base, `/catalog/search?q=${encodeURIComponent(query)}`);
      assert.equal(body[0] && body[0].slug, slug, `"${query}" should resolve to ${slug}`);
    }
  });

  test("a plant that does not exist returns nothing, not a guess", async () => {
    const { body } = await h.get(api.base, "/catalog/search?q=dragonfruit%20from%20mars");
    assert.deepEqual(body, []);
  });

  test("an empty query lists the catalog rather than erroring", async () => {
    const { body } = await h.get(api.base, "/catalog/search");
    assert.ok(Array.isArray(body) && body.length > 0);
  });

  test("category narrows the results", async () => {
    const { body } = await h.get(api.base, "/catalog/search?category=houseplants");
    assert.ok(body.length > 0);
    assert.ok(body.every((plant) => plant.category === "houseplants"));
  });
});

describe("search is not fooled by nesting", () => {
  test("/catalog/search is not treated as a slug", async () => {
    const res = await h.get(api.base, "/catalog/search?q=basil");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });
});

describe("members' plants link to the catalog", () => {
  test("a plant can be created from a canonical id", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.post(api.base, "/plants", {
      token,
      body: { canonicalPlantId: "pl-basil", plantingMethod: "From Seed" },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.canonical_plant_id, "pl-basil");
    assert.equal(res.body.plant_type, "Basil", "the display name comes from the catalog");
  });

  test("an id that is not in the catalog is rejected", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.post(api.base, "/plants", {
      token,
      body: { canonicalPlantId: "pl-not-real" },
    });
    assert.equal(res.status, 400);
  });

  test("a plant outside the catalog is still allowed, by name", async () => {
    const { token } = await h.signup(api.base);
    const res = await h.post(api.base, "/plants", {
      token,
      body: { customName: "Grandma's mystery pepper" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.canonical_plant_id, null);
  });

  test("legacy free-text plants are linked by an idempotent backfill", async () => {
    const { query } = require("../config/db");
    const seed = require("../database/seed");

    const { token, user } = await h.signup(api.base);

    // A plant created before the catalog existed: a name and nothing else.
    const inserted = await query(
      "INSERT INTO plants (user_id, plant_type) VALUES ($1, $2) RETURNING plant_id",
      [user.user_id, "Tomatoes"]
    );
    const plantId = inserted.rows[0].plant_id;

    await seed.normalizeExistingPlants({ query });

    const linked = await query("SELECT canonical_plant_id FROM plants WHERE plant_id = $1", [plantId]);
    assert.equal(linked.rows[0].canonical_plant_id, "pl-tomato", "the legacy name resolves to the canonical row");

    // Re-running must not churn anything.
    await seed.normalizeExistingPlants({ query });
    const again = await query("SELECT canonical_plant_id FROM plants WHERE plant_id = $1", [plantId]);
    assert.equal(again.rows[0].canonical_plant_id, "pl-tomato");
  });
});

describe("the normalizer folds local gardening terms", () => {
  const normalize = require("../services/plant-normalize.service");

  test("Iraqi and Kurdish words reach their English category", () => {
    assert.ok(normalize.terms("شلون اسقي الطماطة؟").has("water"), "اسقي reaches water");
    assert.ok(normalize.terms("مي").has("water"), "مي is water");
    assert.ok(normalize.terms("تراب").has("soil"), "تراب is soil");
    assert.ok(normalize.terms("سماد").has("fertilizer"), "سماد is fertilizer");
    assert.ok(normalize.terms("شتلة").has("seed"), "شتلة reaches seedling/seed");
  });

  test("Arabic letter variants and the definite article fold together", () => {
    assert.equal(normalize.normalizeAlias("طماطة"), normalize.normalizeAlias("طماطه"));
    assert.equal(normalize.normalizeAlias("الطماطم"), "طماطم");
  });

  test("the language of a message is detected", () => {
    assert.equal(normalize.detectLanguage("how do I water tomatoes?"), "en");
    assert.equal(normalize.detectLanguage("متى أزرع الطماطم؟"), "ar");
    assert.equal(normalize.detectLanguage("کەی تەماتە دەچێنم؟"), "ku");
  });
});
