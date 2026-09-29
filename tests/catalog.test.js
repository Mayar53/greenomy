// tests/catalog.test.js — the plant catalog (plants.json) is the single source
// of truth for plant identity, and the reviewer worklist is generated from it.
// These tests hold the data to its own contract and keep the generated doc from
// drifting away from the data it is generated from.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildReview, OUT_PATH } = require("../scripts/kurdish-review.js");

const ROOT = path.join(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "plants.json"), "utf8"));
const iconsSource = fs.readFileSync(path.join(ROOT, "icons.js"), "utf8");

const ICON_NAMES = new Set(
  [...iconsSource.matchAll(/^ {2}([A-Za-z]+):/gm)].map((match) => match[1])
);

const ku = (plant) => (plant.i18n && plant.i18n.ku) || {};
const ar = (plant) => (plant.i18n && plant.i18n.ar) || {};

describe("catalog integrity", () => {
  test("ids and slugs are unique", () => {
    const ids = new Set();
    const slugs = new Set();
    for (const plant of catalog.plants) {
      assert.ok(!ids.has(plant.id), `duplicate id ${plant.id}`);
      assert.ok(!slugs.has(plant.slug), `duplicate slug ${plant.slug}`);
      ids.add(plant.id);
      slugs.add(plant.slug);
    }
  });

  test("every plant names itself in English, Arabic and Kurdish, with a scientific name", () => {
    for (const plant of catalog.plants) {
      assert.ok(plant.name, `${plant.id} needs an English name`);
      assert.ok(plant.scientificName, `${plant.id} needs a scientific name`);
      assert.ok(plant.category, `${plant.id} needs a category`);
      assert.ok(ar(plant).name, `${plant.id} needs an Arabic name`);
      assert.ok(ku(plant).name, `${plant.id} needs a Kurdish (Sorani) name`);
    }
  });

  test("the scientific name identifies exactly one plant", () => {
    const seen = new Map();
    for (const plant of catalog.plants) {
      assert.ok(
        !seen.has(plant.scientificName),
        `"${plant.scientificName}" is shared by ${seen.get(plant.scientificName)} and ${plant.id}`
      );
      seen.set(plant.scientificName, plant.id);
    }
  });

  test("no Kurdish name is the Arabic name pasted in", () => {
    for (const plant of catalog.plants) {
      assert.notEqual(
        ku(plant).name,
        ar(plant).name,
        `${plant.id} ("${plant.name}") carries the Arabic name in its Kurdish field`
      );
    }
  });

  test("every plant says how its name was checked, and cites a real source", () => {
    const sourceIds = new Set(catalog.sources.map((source) => source.id));
    for (const plant of catalog.plants) {
      const status = ku(plant).nameStatus;
      assert.ok(
        ["verified", "needs_native_review"].includes(status),
        `${plant.id} must record nameStatus as verified or needs_native_review`
      );
      if (status === "verified") {
        assert.ok(ku(plant).nameSource, `${plant.id} is marked verified but cites no source`);
        assert.ok(
          sourceIds.has(ku(plant).nameSource),
          `${plant.id} cites the unknown source "${ku(plant).nameSource}"`
        );
      } else {
        assert.ok(
          ku(plant).nameReviewNote,
          `${plant.id} needs a nameReviewNote explaining why it is flagged`
        );
      }
    }
  });

  test("sources are unique, named, and typed", () => {
    const ids = new Set();
    for (const source of catalog.sources) {
      assert.ok(source.id && !ids.has(source.id), `source id missing or duplicated: ${source.id}`);
      assert.ok(source.name, `source ${source.id} needs a name`);
      ids.add(source.id);
    }
  });

  test("every plant's icon and stage template exist", () => {
    const templates = new Set(Object.keys(catalog.stageTemplates || {}));
    for (const plant of catalog.plants) {
      if (plant.icon) {
        assert.ok(ICON_NAMES.has(plant.icon), `${plant.id} uses the unknown icon "${plant.icon}"`);
      }
      if (plant.stageTemplate) {
        assert.ok(
          templates.has(plant.stageTemplate),
          `${plant.id} uses the unknown stage template "${plant.stageTemplate}"`
        );
      }
    }
  });
});

describe("the reviewer worklist is generated, not hand-written", () => {
  test("docs/KURDISH-NAMES-REVIEW.md matches plants.json", () => {
    const committed = fs.readFileSync(OUT_PATH, "utf8").replace(/\r\n/g, "\n").trimEnd();
    const generated = buildReview(catalog).replace(/\r\n/g, "\n").trimEnd();
    assert.equal(
      committed,
      generated,
      "docs/KURDISH-NAMES-REVIEW.md is stale — run `node scripts/kurdish-review.js`"
    );
  });

  test("the worklist lists every flagged name and every source", () => {
    const doc = buildReview(catalog);
    for (const plant of catalog.plants) {
      if (ku(plant).nameStatus === "needs_native_review") {
        assert.ok(doc.includes(`| ${plant.id} |`), `${plant.id} is missing from the worklist`);
      }
    }
    for (const source of catalog.sources) {
      assert.ok(doc.includes(`\`${source.id}\``), `source ${source.id} is missing from the worklist`);
    }
  });
});
