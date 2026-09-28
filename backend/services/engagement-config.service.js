// services/engagement-config.service.js — reads engagement.json and resolves it
// into the shapes the rest of the system uses.
//
// This is the ONLY place that knows how the config file is laid out. Everything
// else asks a question ("what does this milestone pay?", "what is in the mystery
// pool?") and never reaches into the raw JSON. That is what makes the system
// data-driven: adding a plant, milestone reward, achievement, challenge, fact or
// item is an edit to engagement.json, not a code change.
const path = require("path");

const config = require(path.join(__dirname, "../../engagement.json"));
// The catalogue is the one place plant names live. A fact may point at a plant
// with `plantId` and write {plant} where its name goes, so the name is never
// copied into this file — in any language.
const plantSeed = require(path.join(__dirname, "../../plants.json"));

/** The name of the plant a fact is about, per language. */
function plantNames(plantId) {
  const plant = (plantSeed.plants || []).find((entry) => entry.id === plantId);
  if (!plant) return null;
  const names = { en: plant.name };
  for (const [lang, locale] of Object.entries(plant.i18n || {})) {
    if (locale && locale.name) names[lang] = locale.name;
  }
  return names;
}

/** Replaces {plant} in a fact's text with the catalogue name, per language. An
 * unknown id leaves no placeholder behind. */
function fillPlantName(text, names, lang) {
  if (typeof text !== "string") return text;
  return text.replace(/\{plant\}/g, (names && (names[lang] || names.en)) || "");
}

function localizeFact(fact) {
  const names = fact.plantId ? plantNames(fact.plantId) : null;
  if (!names) return fact;
  const out = { ...fact, title: fillPlantName(fact.title, names, "en"), body: fillPlantName(fact.body, names, "en") };
  if (fact.i18n) {
    out.i18n = {};
    for (const [lang, locale] of Object.entries(fact.i18n)) {
      out.i18n[lang] = { ...locale, title: fillPlantName(locale.title, names, lang), body: fillPlantName(locale.body, names, lang) };
    }
  }
  return out;
}

const CARE_ACTIONS = new Map((config.careActions || []).map((action) => [action.key, action]));
const FACTS = new Map((config.facts || []).map((fact) => [fact.id, localizeFact(fact)]));
const ACHIEVEMENTS = new Map((config.achievements || []).map((entry) => [entry.id, entry]));
const CHALLENGES = new Map((config.challenges || []).map((entry) => [entry.id, entry]));
const STAGE_ORDER = config.stageOrder || [];
const STAGE_INDEX = new Map(STAGE_ORDER.map((key, index) => [key, index]));
const LEVELS = (config.gardenLevels || []).slice().sort((a, b) => a.xp - b.xp);
const ITEMS = config.items || {};

const SEED_ITEM = {
  key: "seed",
  icon: "seed",
  name: "Seed",
  i18n: { ar: { name: "بذرة" }, ku: { name: "تۆو" } },
};

function careActions() {
  return (config.careActions || []).map((action) => ({ ...action }));
}

function careAction(key) {
  return CARE_ACTIONS.get(key) || null;
}

function streaks() {
  return (config.streaks || []).map((entry) => ({ ...entry }));
}

/** Days until the next watering for a plant with the given water need
 * (low | medium | high), falling back to a default. Drives care reminders. */
function reminderIntervalDays(waterNeed) {
  const reminders = config.reminders || {};
  const byNeed = reminders.byWaterNeed || {};
  const fallback = Number(reminders.defaultIntervalDays) || 3;
  const value = waterNeed && byNeed[waterNeed];
  return Number(value) > 0 ? Number(value) : fallback;
}

function gardenLevels() {
  return LEVELS.map((entry) => ({ ...entry }));
}

/** Position of a stage in the global order — used to decide "furthest reached". */
function stageIndex(stageKey) {
  return STAGE_INDEX.has(stageKey) ? STAGE_INDEX.get(stageKey) : -1;
}

function facts() {
  return (config.facts || []).map((fact) => ({ ...fact }));
}

function fact(id) {
  return FACTS.get(id) || null;
}

function achievements() {
  return (config.achievements || []).map((entry) => ({ ...entry }));
}

function achievement(id) {
  return ACHIEVEMENTS.get(id) || null;
}

function challenges() {
  return (config.challenges || []).map((entry) => ({ ...entry }));
}

function challenge(id) {
  return CHALLENGES.get(id) || null;
}

/**
 * What a milestone pays. Resolution order — a plant-specific entry beats its
 * template's, which beats the default — so a tomato and a basil genuinely get
 * different rewards even though both are simply "flowering".
 */
function milestoneReward({ plantId, template, stageKey }) {
  const defaults = (config.milestoneRewards && config.milestoneRewards.default) || {};
  const templates = (config.milestoneRewards && config.milestoneRewards.templates) || {};
  const plants = (config.milestoneRewards && config.milestoneRewards.plants) || {};

  const templateReward = (template && templates[template] && templates[template][stageKey]) || {};
  const plantReward = (plantId && plants[plantId] && plants[plantId][stageKey]) || {};

  return { ...(defaults[stageKey] || {}), ...templateReward, ...plantReward };
}

/** Display metadata for one owned item (or a fact, which carries its own). */
function describeItem(itemType, itemKey) {
  if (itemType === "fact") {
    const found = FACTS.get(itemKey);
    if (found) return { icon: found.icon || "book", name: found.title, body: found.body, i18n: found.i18n || null };
    return { icon: "book", name: itemKey, body: null, i18n: null };
  }
  if (itemType === "seed") return { ...SEED_ITEM };
  const item = ITEMS[itemKey];
  if (item) return { icon: item.icon || "gift", name: item.name, body: item.body || null, i18n: item.i18n || null };
  return { icon: "gift", name: itemKey, body: null, i18n: null };
}

/** True when a challenge's date window contains `now`. */
function challengeWindow(challenge_, now = new Date()) {
  const start = challenge_.startDate ? new Date(challenge_.startDate) : null;
  const end = challenge_.endDate ? new Date(`${challenge_.endDate}T23:59:59Z`) : null;
  if (start && now < start) return "upcoming";
  if (end && now > end) return "ended";
  return "active";
}

/** Weighted random pick from a mystery pool. */
function rollMystery(kind, random = Math.random) {
  const pool = (config.mysteryPools && config.mysteryPools[kind]) || [];
  const total = pool.reduce((sum, entry) => sum + (entry.weight || 1), 0);
  if (!total) return { xp: 20 };

  let roll = random() * total;
  for (const entry of pool) {
    roll -= entry.weight || 1;
    if (roll <= 0) {
      const { weight, ...payload } = entry;
      return payload;
    }
  }
  const { weight, ...last } = pool[pool.length - 1];
  return last;
}

/**
 * Turns a reward payload into a list the UI can render directly, so the frontend
 * never has to know the payload's internal keys.
 */
function describePayload(payload) {
  if (!payload) return [];
  const parts = [];
  if (payload.xp) parts.push({ type: "xp", amount: payload.xp, icon: "spark" });
  if (payload.points) parts.push({ type: "points", amount: payload.points, icon: "trophy" });
  if (payload.seeds) parts.push({ type: "seed", key: "seed", amount: payload.seeds, icon: "seed", name: SEED_ITEM.name, i18n: SEED_ITEM.i18n });
  if (payload.decoration) parts.push({ type: "decoration", key: payload.decoration, ...describeItem("decoration", payload.decoration) });
  if (payload.profileItem) parts.push({ type: "profile", key: payload.profileItem, ...describeItem("profile", payload.profileItem) });
  if (payload.gardenItem) parts.push({ type: "garden", key: payload.gardenItem, ...describeItem("garden", payload.gardenItem) });
  if (payload.rareItem) parts.push({ type: "rare", key: payload.rareItem, ...describeItem("rare", payload.rareItem) });
  if (payload.fact) parts.push({ type: "fact", key: payload.fact, ...describeItem("fact", payload.fact) });
  if (payload.boost) parts.push({ type: "boost", multiplier: payload.boost.multiplier, hours: payload.boost.hours, icon: "spark" });
  if (payload.mystery) parts.push({ type: "mystery", icon: "gift" });
  return parts;
}

module.exports = {
  careActions,
  careAction,
  streaks,
  reminderIntervalDays,
  gardenLevels,
  stageIndex,
  stageOrder: () => STAGE_ORDER.slice(),
  facts,
  fact,
  achievements,
  achievement,
  challenges,
  challenge,
  milestoneReward,
  describeItem,
  describePayload,
  challengeWindow,
  rollMystery,
};
