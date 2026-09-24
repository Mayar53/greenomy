// services/recommendation.service.js — ranks catalog plants against where the
// member is, what season it is, how long they'll wait, and what they said they
// like.
//
// Deliberately deterministic and AI-free: every fact (climate suitability,
// days to harvest, planting months) comes from plant_catalog, so a
// recommendation can never invent a plant, a season or a harvest time. It is
// also free, instant, translatable, and unit-testable without any network.

const WEIGHTS = {
  climateMatch: 30,
  inSeason: 25,
  matchesPreference: 20,
  fitsDuration: 15,
  fitsExperience: 5,
  fitsSpace: 5,
};

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((sum, n) => sum + n, 0);

// "How long are you willing to wait for a harvest?"
const DURATION_DAYS = {
  weeks: 30,
  months: 120,
  season: 270,
  any: Number.POSITIVE_INFINITY,
};

const EXPERIENCE_RANK = { beginner: 0, "some-experience": 1, experienced: 2, expert: 3 };
const DIFFICULTY_RANK = { easy: 0, medium: 1, hard: 2 };

const DEFAULT_COMPETENCE = 1; // treat an unknown experience level as "some experience"

function durationDaysFor(duration) {
  const key = String(duration || "any").toLowerCase();
  return Object.prototype.hasOwnProperty.call(DURATION_DAYS, key) ? DURATION_DAYS[key] : DURATION_DAYS.any;
}

function fitsSpaceOf(entry, space) {
  if (space === "both") return entry.indoor === true || entry.outdoor === true;
  if (space === "indoor") return entry.indoor === true;
  if (space === "outdoor") return entry.outdoor === true;
  return true; // unset: don't filter
}

/**
 * Scores one catalog entry. Returns the score plus reason codes the UI renders
 * as chips, so the "why" is translated text rather than generated prose.
 */
function scoreEntry(entry, ctx) {
  const reasons = [];
  let score = 0;

  const climates = entry.climates || [];
  if (climates.length === 0 || climates.includes(ctx.climate)) {
    score += WEIGHTS.climateMatch;
    reasons.push("climateMatch");
  } else {
    reasons.push("differentClimate");
  }

  // The catalog lists northern-hemisphere months; ctx.northernMonth is already
  // mapped for southern-hemisphere members.
  const months = entry.planting_months || [];
  if (months.length === 0 || months.includes(ctx.northernMonth)) {
    score += WEIGHTS.inSeason;
    reasons.push("inSeason");
  } else {
    reasons.push("outOfSeason");
  }

  const prefs = ctx.plantTypes || [];
  if (prefs.length === 0 || prefs.includes(entry.category)) {
    score += WEIGHTS.matchesPreference;
    if (prefs.length > 0) reasons.push("matchesPreference");
  } else {
    reasons.push("outsidePreference");
  }

  if (entry.days_to_harvest <= ctx.durationDays) {
    score += WEIGHTS.fitsDuration;
    reasons.push("fitsDuration");
  }

  const competence = EXPERIENCE_RANK[ctx.experience] ?? DEFAULT_COMPETENCE;
  if (DIFFICULTY_RANK[entry.difficulty] <= competence) {
    score += WEIGHTS.fitsExperience;
    reasons.push("fitsExperience");
  } else {
    reasons.push("needsExperience");
  }

  if (fitsSpaceOf(entry, ctx.space)) {
    score += WEIGHTS.fitsSpace;
    reasons.push("fitsSpace");
  } else {
    reasons.push("wrongSpace");
  }

  return { score, reasons };
}

/** Builds the scoring context from conditions plus the member's own choices. */
function buildContext(conditions, { duration, space, experience, plantTypes } = {}) {
  return {
    climate: conditions?.climate || "temperate",
    northernMonth: conditions?.northernMonth || new Date().getMonth() + 1,
    durationDays: durationDaysFor(duration),
    space: space || "both",
    experience: experience || null,
    plantTypes: Array.isArray(plantTypes) ? plantTypes : [],
  };
}

/**
 * Ranks the catalog. Two hard filters, because neither is a matter of taste:
 * a plant that cannot live in the space they have, and one that takes longer
 * than they said they would wait. Everything else is graded, not excluded, so
 * a coarse climate guess never hides a good option.
 */
function recommend(catalog, ctx, limit = 6) {
  const scored = [];

  for (const entry of catalog) {
    const { score, reasons } = scoreEntry(entry, ctx);
    if (!fitsSpaceOf(entry, ctx.space)) continue;
    if (entry.days_to_harvest > ctx.durationDays) continue;
    scored.push({ entry, score, reasons });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.days_to_harvest - b.entry.days_to_harvest ||
      String(a.entry.name).localeCompare(String(b.entry.name))
  );

  return scored.slice(0, limit).map(({ entry, score, reasons }) => ({
    id: entry.id,
    name: entry.name,
    slug: entry.slug,
    category: entry.category,
    icon: entry.icon,
    daysToHarvest: entry.days_to_harvest,
    difficulty: entry.difficulty,
    sun: entry.sun,
    water: entry.water,
    indoor: entry.indoor,
    outdoor: entry.outdoor,
    notes: entry.notes,
    i18n: entry.i18n,
    score,
    maxScore: TOTAL_WEIGHT,
    reasons,
  }));
}

module.exports = { recommend, buildContext, scoreEntry, durationDaysFor, WEIGHTS, TOTAL_WEIGHT, DURATION_DAYS };
