// scripts/kurdish-review.js — regenerate docs/KURDISH-NAMES-REVIEW.md from
// plants.json. The catalog is the single source of truth; this file is a
// by-product, so it is generated, never hand-edited.
//
//   node scripts/kurdish-review.js
//
// tests/catalog.test.js regenerates the same markdown in memory and asserts the
// committed file still matches, so the doc cannot silently drift from the data.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "plants.json");
const OUT_PATH = path.join(ROOT, "docs", "KURDISH-NAMES-REVIEW.md");

const RULE = "| --- | --- | --- | --- | --- | --- |";

/** A markdown table cell cannot contain a raw pipe. */
function cell(value) {
  return String(value == null ? "" : value).replace(/\|/g, "\\|").trim();
}

/** Build the whole worklist from a parsed plants.json object. */
function buildReview(catalog) {
  const sources = catalog.sources || [];
  const plants = catalog.plants || [];

  const sourceLabel = new Map(
    sources.map((source) => [
      source.id,
      source.organization ? `${source.name} (${source.organization})` : source.name,
    ])
  );

  const kuName = (plant) => ((plant.i18n && plant.i18n.ku) || {}).name || "";
  const kuStatus = (plant) => ((plant.i18n && plant.i18n.ku) || {}).nameStatus || "";
  const arName = (plant) => ((plant.i18n && plant.i18n.ar) || {}).name || "";

  const pending = plants.filter((plant) => kuStatus(plant) === "needs_native_review");
  const verified = plants.filter((plant) => kuStatus(plant) === "verified");

  const lines = [
    "# Kurdish plant names — reviewer worklist",
    "",
    "Generated from `plants.json`, which is the single source of truth. This file is a",
    "by-product — change the catalog and regenerate it, never edit this list directly.",
    "",
    "Regenerate with:",
    "",
    "```",
    "node scripts/kurdish-review.js",
    "```",
    "",
    "## How to read the status column",
    "",
    "- `verified` — the Kurdish name was checked against a registered reference source.",
    "- `needs_native_review` — the name is in use and understandable, but no reference",
    "  source could confirm it. It has NOT been verified, and it is not claimed to be.",
    "",
    "## Summary",
    "",
    `- plants in the catalog: **${plants.length}**`,
    `- Kurdish names verified against a source: **${verified.length}**`,
    `- awaiting a native Sorani reviewer: **${pending.length}**`,
    "",
    "## What a reviewer needs to supply",
    "",
    "For each row below, the useful answer is one line:",
    "",
    "```",
    "<plant id> | yes/no (is the current name acceptable) | the name you would use | the source you checked",
    "```",
    "",
    "If the current name is fine, \"yes\" is the whole answer. If it is wrong, the name you",
    "give replaces it and the old one is kept as a search alias, so nothing is lost.",
    "",
    "## Waiting for review",
    "",
    "| plant id | scientific name | English | Arabic | current Kurdish | why flagged |",
    RULE,
  ];

  for (const plant of pending) {
    const ku = (plant.i18n && plant.i18n.ku) || {};
    lines.push(
      `| ${cell(plant.id)} | ${cell(plant.scientificName)} | ${cell(plant.name)} | ${cell(
        arName(plant)
      )} | ${cell(kuName(plant))} | ${cell(ku.nameReviewNote || "No reference source could confirm this name.")} |`
    );
  }

  lines.push("", "## Sources registered in the catalog", "");
  for (const source of sources) {
    lines.push(`- \`${source.id}\` — ${sourceLabel.get(source.id)}`);
  }
  lines.push("");

  return lines.join("\n");
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const markdown = buildReview(catalog);
  fs.writeFileSync(OUT_PATH, markdown, "utf8");
  const pending = (catalog.plants || []).filter(
    (plant) => ((plant.i18n && plant.i18n.ku) || {}).nameStatus === "needs_native_review"
  ).length;
  console.log(
    `Wrote ${path.relative(ROOT, OUT_PATH).replace(/\\/g, "/")} — ${pending} name(s) awaiting review.`
  );
}

if (require.main === module) main();

module.exports = { buildReview, OUT_PATH, CATALOG_PATH };
