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

  test("a member's own plant is named in the reader's language", async () => {
    const { token } = await h.signup(api.base);
    await h.post(api.base, "/plants", { token, body: { canonicalPlantId: "pl-tomato" } });

    const en = await h.get(api.base, "/plants?lang=en", { token });
    const ar = await h.get(api.base, "/plants?lang=ar", { token });
    const ku = await h.get(api.base, "/plants?lang=ku", { token });

    assert.equal(en.body[0].plant_name, "Tomato");
    assert.equal(ar.body[0].plant_name, "طماطم");
    assert.equal(ku.body[0].plant_name, "تەماتە");

    // The identity is the catalog id, and plant_type stays the stored English
    // name — the display name is resolved, never stored.
    assert.equal(ku.body[0].canonical_plant_id, "pl-tomato");
    assert.equal(ku.body[0].plant_type, "Tomato");
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

describe("Kurdish names (Sorani) are audited, not guessed", () => {
  const seed = require("../../plants.json");
  const normalize = require("../services/plant-normalize.service");

  const kurdish = (plant) => (plant.i18n && plant.i18n.ku) || {};
  const sourceIds = new Set((seed.sources || []).map((source) => source.id));

  test("every plant names itself in English, Arabic and Kurdish, with a scientific name", () => {
    for (const plant of seed.plants) {
      assert.ok(plant.name, `${plant.id} needs a common English name`);
      assert.ok(plant.scientificName, `${plant.id} needs a scientific name`);
      assert.ok(plant.category, `${plant.id} needs a category`);
      assert.ok((plant.i18n.ar || {}).name, `${plant.id} needs an Arabic name`);
      assert.ok(kurdish(plant).name, `${plant.id} needs a Kurdish (Sorani) name`);
    }
  });

  test("the scientific name identifies one plant on its own", () => {
    const seen = new Map();
    for (const plant of seed.plants) {
      assert.ok(
        !seen.has(plant.scientificName),
        `"${plant.scientificName}" is shared by ${seen.get(plant.scientificName)} and ${plant.id}`
      );
      seen.set(plant.scientificName, plant.id);
    }
  });

  test("no Kurdish name is the Arabic name pasted in", () => {
    for (const plant of seed.plants) {
      assert.notEqual(
        kurdish(plant).name,
        (plant.i18n.ar || {}).name,
        `${plant.id} ("${plant.name}") carries the Arabic name in its Kurdish field`
      );
    }
  });

  test("Kurdish names are unique and every plant says how its name was checked", () => {
    const claimed = new Map();
    for (const plant of seed.plants) {
      const ku = kurdish(plant);
      const key = normalize.unifyArabic(ku.name);
      assert.ok(
        !claimed.has(key),
        `"${ku.name}" is claimed by both ${claimed.get(key)} and ${plant.id}`
      );
      claimed.set(key, plant.id);

      assert.ok(
        ["verified", "needs_native_review"].includes(ku.nameStatus),
        `${plant.id} must record nameStatus as verified or needs_native_review`
      );
      if (ku.nameStatus === "verified") {
        assert.ok(ku.nameSource, `${plant.id} is marked verified but cites no source`);
        assert.ok(sourceIds.has(ku.nameSource), `${plant.id} cites the unknown source "${ku.nameSource}"`);
      }
    }
  });

  test("the corrected Sorani names are the ones in the catalog", () => {
    const byId = new Map(seed.plants.map((plant) => [plant.id, plant]));
    const expected = {
      "pl-spinach": "سپێناخ",
      "pl-beetroot": "چەوەندەر",
      "pl-cabbage": "کەلەرم",
      "pl-pea": "پۆڵکە",
      "pl-broad-bean": "باقڵا",
      "pl-turnip": "شێلم",
      "pl-strawberry": "تووفەرەنگی",
      "pl-zucchini": "کولەکە",
      "pl-chives": "پیازەکێوی",
      "pl-cauliflower": "قەرنابیت",
      "pl-dill": "شویت",
    };
    for (const [id, name] of Object.entries(expected)) {
      assert.equal(kurdish(byId.get(id)).name, name, `${id} should carry the verified Sorani name`);
    }
  });

  test("a Kurdish plant name folds onto its own plant, never a different one", () => {
    // باقڵا is the broad bean and پۆڵکە is the pea; the pair used to be swapped.
    assert.ok(normalize.terms("باقڵا").has("broad-bean"), "باقڵا is the broad bean");
    assert.ok(!normalize.terms("باقڵا").has("pea"), "باقڵا must not resolve to the pea");
    assert.ok(normalize.terms("پۆڵکە").has("pea"), "پۆڵکە is the pea");
    assert.ok(normalize.terms("سپێناخ").has("spinach"), "سپێناخ is spinach");
    assert.ok(normalize.terms("کەلەرم").has("cabbage"), "کەلەرم is cabbage");
    assert.ok(normalize.terms("چەوەندەر").has("beetroot"), "چەوەندەر is beetroot");
    assert.ok(normalize.terms("تووفەرەنگی").has("strawberry"), "تووفەرەنگی is the strawberry");
  });

  test("the corrected Kurdish names are searchable through the catalogue API", async () => {
    const cases = [
      ["سپێناخ", "spinach"],
      ["پۆڵکە", "pea"],
      ["باقڵا", "broad-bean"],
      ["چەوەندەر", "beetroot"],
      ["کەلەرم", "cabbage"],
      ["کولەکە", "zucchini"],
      ["قەرنابیت", "cauliflower"],
    ];
    for (const [query, slug] of cases) {
      const { body } = await h.get(api.base, `/catalog/search?q=${encodeURIComponent(query)}&lang=ku`);
      assert.equal(body[0] && body[0].slug, slug, `"${query}" should resolve to ${slug}`);
    }
  });
});
