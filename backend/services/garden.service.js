// services/garden.service.js — garden level and the elements it unlocks.
//
// XP is a lifetime, never-spent value on the member. This service turns it into
// a level, the progress toward the next one, and the list of garden elements
// with their locked/unlocked state — all from engagement.json's gardenLevels.
const engagementConfig = require("./engagement-config.service");

/** The level a given amount of XP sits at. */
function levelFor(xp) {
  const levels = engagementConfig.gardenLevels();
  const safeXp = Math.max(0, Number(xp) || 0);

  let current = levels[0] || { level: 1, xp: 0, element: null, icon: "sprout" };
  let next = null;
  for (const entry of levels) {
    if (safeXp >= entry.xp) current = entry;
    else {
      next = entry;
      break;
    }
  }

  const floor = current.xp;
  const span = next ? next.xp - floor : 0;
  const into = safeXp - floor;

  return {
    level: current.level,
    xp: safeXp,
    levelXp: floor,
    nextXp: next ? next.xp : null,
    xpIntoLevel: into,
    xpForNext: next ? next.xp - safeXp : 0,
    progress: next ? Math.min(1, into / span) : 1,
    element: current.element,
    icon: current.icon,
    nextElement: next ? next.element : null,
  };
}

/** The full garden state: level plus every element and whether it is unlocked. */
function progressFor(xp) {
  const levels = engagementConfig.gardenLevels();
  const safeXp = Math.max(0, Number(xp) || 0);
  const state = levelFor(safeXp);

  return {
    ...state,
    elements: levels.map((entry) => ({
      level: entry.level,
      element: entry.element,
      icon: entry.icon,
      xp: entry.xp,
      unlocked: safeXp >= entry.xp,
    })),
  };
}

module.exports = { levelFor, progressFor };
