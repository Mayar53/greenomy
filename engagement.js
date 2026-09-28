// engagement.js — the plant-journey and garden engagement layer for the
// signed-in pages (garden.html). It renders the member's garden level and XP,
// each plant's journey from its OWN milestone data, care actions, achievements,
// seasonal challenges and mystery rewards — and it is the only thing that talks
// to /api/engagement.
//
// Rendering only: the numbers, which milestones exist, what they pay and which
// achievements are unlocked all come from the API, so nothing plant-specific is
// hard-coded here.
import { api, ApiError } from "./servisapi.js";
import { listJourneys } from "./serviseplant.js";
import { t, localized, stageLabel } from "./language.js";
import { iconMarkup, plantIcon, initIcons } from "./icons.js";
import { getEngagement, recordCare, claimMystery, claimChallenge } from "./engagementservice.js";

const state = {
  engagement: null,
  journeys: [],
  loaded: false,
  error: false,
  busy: false,
};

/* ------------------------------------------------------------------ utils -- */
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function isAuthError(err) {
  return err instanceof ApiError && err.status === 401;
}

function gotoLogin() {
  window.location.href = "login.html";
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString();
}

function fmtDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function fmtRange(from, to) {
  const start = fmtDate(from);
  const end = fmtDate(to);
  return [start, end].filter(Boolean).join(" – ");
}

/** One reward part as human text. Item/fact names come localized from the API. */
function rewardPartLabel(part) {
  switch (part.type) {
    case "xp":
      return `+${fmtNumber(part.amount)} XP`;
    case "points":
      return `+${fmtNumber(part.amount)} ${t("engagement.points")}`;
    case "seed":
      return `+${fmtNumber(part.amount)} ${t("engagement.seed")}`;
    case "boost":
      return `${part.multiplier}× XP · ${part.hours} ${t("engagement.hours")}`;
    case "mystery":
      return t("engagement.mysteryReward");
    case "fact":
      return `${t("engagement.newFact")}: ${localized(part, "name") || part.name}`;
    default:
      return localized(part, "name") || part.name || part.type;
  }
}

function rewardLine(parts) {
  if (!parts || !parts.length) return "";
  const chips = parts
    .map((part) => `<span class="reward-chip">${iconMarkup(part.icon || "gift")}${escapeHtml(rewardPartLabel(part))}</span>`)
    .join("");
  return `<span class="reward-line">${chips}</span>`;
}

const loadingState = (icon) => `<div class="loading-state">${iconMarkup(icon)}${escapeHtml(t("common.loading"))}</div>`;

/* --------------------------------------------------------------- overview -- */
function levelHTML(garden) {
  const pct = Math.round((garden.progress || 0) * 100);
  const note = garden.nextXp
    ? `${fmtNumber(garden.xp)} / ${fmtNumber(garden.nextXp)} XP · ${fmtNumber(garden.xpForNext)} ${t("engagement.toNext")}`
    : `${fmtNumber(garden.xp)} XP · ${t("engagement.maxLevel")}`;

  const elements = (garden.elements || [])
    .map(
      (element) => `
      <span class="garden-element ${element.unlocked ? "is-unlocked" : "is-locked"}">
        ${iconMarkup(element.unlocked ? element.icon : "lock")}
        <span>${escapeHtml(t(`engagement.element.${element.element}`))}</span>
      </span>`
    )
    .join("");

  return `
    <div class="card garden-overview">
      <div class="garden-level">
        <div class="garden-level-badge">${iconMarkup(garden.icon || "sprout")}<strong>${garden.level}</strong></div>
        <div class="garden-level-main">
          <h2 class="heading-md">${escapeHtml(t("engagement.gardenLevel"))}</h2>
          <div class="xp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
            <div class="xp-bar-fill" style="width:${pct}%"></div>
          </div>
          <p class="form-note">${escapeHtml(note)}</p>
        </div>
      </div>
      <div class="garden-elements">${elements}</div>
    </div>`;
}

function statCard(icon, title, value, note) {
  return `
    <div class="card engagement-stat">
      <div class="engagement-stat-icon">${iconMarkup(icon)}</div>
      <strong>${escapeHtml(value)}</strong>
      <span class="engagement-stat-title">${escapeHtml(title)}</span>
      <span class="form-note">${escapeHtml(note)}</span>
    </div>`;
}

function streakNote(streak) {
  const next = (streak.milestones || []).find((entry) => entry.days > streak.days);
  if (!next) return t("engagement.streakMax");
  return `${next.days - streak.days} · ${t("engagement.streakToNext")}`;
}

function mysteryPanel(pending) {
  if (!pending.length) return "";
  const cards = pending
    .map(
      (entry) => `
      <div class="card mystery-card">
        <div class="mystery-icon">${iconMarkup("gift")}</div>
        <div class="mystery-body">
          <strong>${escapeHtml(t("engagement.mysteryGrowing"))}</strong>
          <p class="form-note">${escapeHtml(t("engagement.mysteryLead"))}</p>
        </div>
        <button type="button" class="btn btn-accent" data-mystery-claim="${escapeHtml(entry.grantId)}">
          ${escapeHtml(t("engagement.reveal"))}
        </button>
      </div>`
    )
    .join("");
  return `<div class="mystery-panel">${cards}</div>`;
}

function collectionHTML(items) {
  if (!items.length) return "";
  const chips = items
    .map(
      (item) => `
      <span class="garden-element is-unlocked">
        ${iconMarkup(item.icon || "gift")}
        <span>${escapeHtml(localized(item, "name") || item.name)}${item.quantity > 1 ? ` ×${item.quantity}` : ""}</span>
      </span>`
    )
    .join("");
  return `
    <div class="card collection-card">
      <h2 class="heading-md">${escapeHtml(t("engagement.collection"))}</h2>
      <p class="form-note">${escapeHtml(t("engagement.collectionLead"))}</p>
      <div class="garden-elements">${chips}</div>
    </div>`;
}

function renderOverview() {
  const host = document.querySelector("[data-garden-overview]");
  if (!host) return;

  if (state.error) {
    host.innerHTML = `<div class="error-state">${escapeHtml(t("engagement.loadError"))}</div>`;
    return;
  }
  if (!state.loaded) {
    host.innerHTML = loadingState("sprout");
    return;
  }

  const engagement = state.engagement;
  const activeChallenge = (engagement.challenges || []).find((entry) => entry.status === "active");
  const recent = (engagement.achievements || [])
    .filter((entry) => entry.unlocked)
    .sort((a, b) => new Date(b.unlockedAt || 0) - new Date(a.unlockedAt || 0))[0];

  host.innerHTML = [
    levelHTML(engagement.garden),
    `<div class="grid grid-3 engagement-stats">`,
    statCard("sprout", t("engagement.plantsGrowing"), fmtNumber(state.journeys.length), t("engagement.plantsGrowingHint")),
    statCard("droplet", t("engagement.careStreak"), fmtNumber(engagement.streak.days), streakNote(engagement.streak)),
    recent
      ? statCard(recent.icon, t("engagement.recentAchievement"), localized(recent, "name") || recent.name, t("engagement.unlocked"))
      : statCard("trophy", t("engagement.recentAchievement"), "—", t("engagement.noneYet")),
    `</div>`,
    activeChallenge ? renderChallenges([activeChallenge], true) : "",
    mysteryPanel(engagement.pendingMysteries || []),
    collectionHTML(engagement.inventory || []),
  ].join("");
}

/* --------------------------------------------------------------- journeys -- */
function milestoneItemHTML(milestone, next) {
  const done = !!milestone.completed_at;
  const isNext = next && next.milestone_id === milestone.milestone_id;
  const cls = done ? "is-done" : isNext ? "is-current" : "is-upcoming";
  const icon = done ? "check" : isNext ? "seedling" : "seed";

  return `
    <li class="milestone-item ${cls}">
      <span class="milestone-marker">${iconMarkup(icon)}</span>
      <div class="milestone-body">
        <span class="milestone-label">${escapeHtml(stageLabel(milestone))}</span>
        ${milestone.recommended_window ? `<span class="milestone-window">${escapeHtml(milestone.recommended_window)}</span>` : ""}
        ${rewardLine(milestone.reward)}
      </div>
    </li>`;
}

function careActionsHTML(journey) {
  const actions = (state.engagement && state.engagement.careActions) || [];
  const buttons = actions
    .map(
      (action) => `
      <button type="button" class="care-btn" data-care-action="${escapeHtml(action.key)}" data-plant-id="${escapeHtml(journey.user_plant_id)}">
        ${iconMarkup(action.icon)}<span>${escapeHtml(t(`care.${action.key}`))}</span>
      </button>`
    )
    .join("");
  return `<div class="care-actions">${buttons}</div>`;
}

function journeyCardHTML(journey) {
  const total = journey.milestones_total || (journey.milestones || []).length;
  const done = journey.milestones_done || 0;
  const pct = Math.round((journey.progress || 0) * 100);
  const next = journey.next_milestone;
  const complete = journey.status === "completed";
  const stage = complete ? t("journey.complete") : stageLabel(next) || journey.current_stage;
  const age = journey.age_days == null ? "—" : `${journey.age_days} ${t("engagement.days")}`;

  return `
    <article class="card journey-card">
      <div class="plant-card-top">
        <div class="plant-card-icon">${iconMarkup(plantIcon({ icon: journey.plant_icon, plant_type: journey.plant_name || journey.plant_type }))}</div>
        <div class="plant-card-id">
          <strong>${escapeHtml(journey.plant_name || journey.plant_type)}</strong>
          <p class="plant-card-loc">${escapeHtml(t("journey.stage"))}: ${escapeHtml(stage)}</p>
        </div>
        <span class="status-badge is-${complete ? "approved" : "pending"}">${done}/${total}</span>
      </div>

      <div class="xp-bar"><div class="xp-bar-fill" style="width:${pct}%"></div></div>
      <div class="plant-card-meta">
        <span>${escapeHtml(t("engagement.age"))}: ${escapeHtml(age)}</span>
        ${next && !complete ? `<span>${escapeHtml(t("journey.next"))}: ${escapeHtml(stageLabel(next))}</span>` : ""}
      </div>

      <ul class="milestone-list">${(journey.milestones || []).map((milestone) => milestoneItemHTML(milestone, next)).join("")}</ul>
      ${complete ? "" : careActionsHTML(journey)}
      <button type="button" class="btn btn-secondary btn-block" data-share-plant="${escapeHtml(journey.journey_id)}">
        ${iconMarkup("share")}<span>${escapeHtml(t("share.plantAction"))}</span>
      </button>
    </article>`;
}

function renderJourneys() {
  const host = document.querySelector("[data-journey-list]");
  if (!host) return;

  if (state.error) {
    host.innerHTML = "";
    return;
  }
  if (!state.loaded) {
    host.innerHTML = loadingState("sprout");
    return;
  }
  if (!state.journeys.length) {
    host.innerHTML = `
      <div class="empty-state">
        ${iconMarkup("sprout")}
        <p>${escapeHtml(t("garden.empty"))}</p>
        <a href="new-seed.html" class="btn btn-primary">${escapeHtml(t("garden.emptyCta"))}</a>
        <p class="form-note" style="margin-top: 10px;">${escapeHtml(t("garden.emptyNote"))}</p>
      </div>`;
    return;
  }

  host.innerHTML = state.journeys.map(journeyCardHTML).join("");
}

/* ----------------------------------------------------------- achievements -- */
function achievementCardHTML(entry) {
  const lockedSecret = !entry.unlocked && entry.secret;
  const name = lockedSecret ? t("engagement.secretName") : localized(entry, "name") || entry.name;
  const description = lockedSecret ? t("engagement.secretHint") : localized(entry, "description") || entry.description;

  return `
    <div class="card achievement-card ${entry.unlocked ? "is-unlocked" : "is-locked"}">
      <div class="achievement-icon">${iconMarkup(entry.unlocked ? entry.icon : "lock")}</div>
      <strong>${escapeHtml(name || "")}</strong>
      <p class="form-note">${escapeHtml(description || "")}</p>
      ${entry.unlocked ? rewardLine(entry.reward) : ""}
    </div>`;
}

function renderAchievements() {
  const host = document.querySelector("[data-achievements-list]");
  if (!host) return;

  if (state.error) {
    host.innerHTML = `<div class="error-state">${escapeHtml(t("engagement.loadError"))}</div>`;
    return;
  }
  if (!state.loaded) {
    host.innerHTML = loadingState("trophy");
    return;
  }

  host.innerHTML = state.engagement.achievements.map(achievementCardHTML).join("");
}

/* ------------------------------------------------------------- challenges -- */
function challengeCardHTML(entry) {
  const pct = Math.min(100, Math.round((entry.progress / (entry.target || 1)) * 100));
  const statusLabel = entry.claimed
    ? t("engagement.claimed")
    : entry.completed
      ? t("engagement.readyToClaim")
      : t(`engagement.challengeStatus.${entry.status}`);

  return `
    <div class="card challenge-card is-${entry.status}">
      <div class="challenge-top">
        <span class="challenge-icon">${iconMarkup(entry.icon)}</span>
        <strong>${escapeHtml(localized(entry, "title") || entry.title)}</strong>
        <span class="status-badge is-${entry.completed ? "approved" : "pending"}">${escapeHtml(statusLabel)}</span>
      </div>
      <p class="form-note">${escapeHtml(localized(entry, "description") || entry.description)}</p>
      <div class="xp-bar"><div class="xp-bar-fill" style="width:${pct}%"></div></div>
      <div class="plant-card-meta">
        <span>${entry.progress}/${entry.target}</span>
        <span>${escapeHtml(fmtRange(entry.startDate, entry.endDate))}</span>
      </div>
      ${rewardLine(entry.reward)}
      ${entry.canClaim ? `<button type="button" class="btn btn-primary" data-challenge-claim="${escapeHtml(entry.id)}">${escapeHtml(t("engagement.claim"))}</button>` : ""}
    </div>`;
}

function renderChallenges(list, embedded = false) {
  const host = document.querySelector("[data-challenges-list]");
  const markup = list.map(challengeCardHTML).join("");
  if (embedded) return `<div class="challenge-embedded">${markup}</div>`;
  if (!host) return "";

  if (state.error) {
    host.innerHTML = `<div class="error-state">${escapeHtml(t("engagement.loadError"))}</div>`;
    return "";
  }
  if (!state.loaded) {
    host.innerHTML = loadingState("flag");
    return "";
  }

  host.innerHTML = markup || `<div class="empty-state">${iconMarkup("flag")}${escapeHtml(t("engagement.noChallenges"))}</div>`;
  return "";
}

function renderAll() {
  renderOverview();
  renderJourneys();
  renderAchievements();
  renderChallenges(state.loaded ? state.engagement.challenges : []);
}

/* ------------------------------------------------------------ celebration -- */
let celebrationTimer = null;

/** A subtle, self-dismissing line of what just happened — never a popup. */
function celebration(messages) {
  const host = document.querySelector("[data-celebration]");
  if (!host || !messages.length) return;

  host.innerHTML = messages
    .map((message) => `<div class="celebration-toast">${iconMarkup(message.icon || "spark")}<span>${escapeHtml(message.text)}</span></div>`)
    .join("");
  host.hidden = false;

  clearTimeout(celebrationTimer);
  celebrationTimer = setTimeout(() => {
    host.hidden = true;
    host.innerHTML = "";
  }, 6000);
}

/* ---------------------------------------------------------------- loading -- */
async function load() {
  const [engagement, journeys] = await Promise.all([getEngagement(), listJourneys()]);
  state.engagement = engagement;
  state.journeys = Array.isArray(journeys) ? journeys : [];
  state.loaded = true;
}

async function refresh() {
  await load();
  renderAll();
  initIcons();
}

async function init() {
  if (
    !document.querySelector("[data-garden-overview]") &&
    !document.querySelector("[data-journey-list]") &&
    !document.querySelector("[data-achievements-list]") &&
    !document.querySelector("[data-challenges-list]")
  ) {
    return;
  }

  wireInteractions();
  renderAll();

  try {
    await load();
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    state.error = true;
  }

  renderAll();
  initIcons();
}

/* ------------------------------------------------------------- behaviour -- */
async function onCare(button) {
  if (state.busy) return;
  state.busy = true;
  button.disabled = true;

  try {
    const result = await recordCare({
      plantId: button.getAttribute("data-plant-id"),
      actionType: button.getAttribute("data-care-action"),
    });

    const messages = [];
    if (result.duplicate) {
      messages.push({ icon: "check", text: t("engagement.alreadyLogged") });
    } else {
      messages.push({ icon: "spark", text: `+${result.xp} XP${result.boosted ? ` · ${t("engagement.boosted")}` : ""}` });
      messages.push({ icon: "droplet", text: `${t("engagement.careStreak")}: ${result.streak}` });
    }
    (result.achievements || []).forEach((entry) =>
      messages.push({ icon: "trophy", text: `${t("engagement.achievementUnlocked")}: ${localized(entry, "name") || entry.name}` })
    );
    if ((result.challenges || []).some((entry) => entry.completed)) {
      messages.push({ icon: "flag", text: t("engagement.challengeComplete") });
    }

    await refresh();
    celebration(messages);
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    celebration([{ icon: "bell", text: err instanceof ApiError ? err.message : t("engagement.actionError") }]);
  } finally {
    state.busy = false;
  }
}

async function onClaimMystery(grantId, button) {
  button.disabled = true;
  try {
    const result = await claimMystery(grantId);
    await refresh();
    celebration(
      (result.rewards || []).map((part) => ({
        icon: part.icon || "gift",
        text: `${t("engagement.youRevealed")} ${rewardPartLabel(part)}`,
      }))
    );
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    celebration([{ icon: "bell", text: err instanceof ApiError ? err.message : t("engagement.actionError") }]);
    await refresh();
  }
}

async function onClaimChallenge(challengeId, button) {
  button.disabled = true;
  try {
    const result = await claimChallenge(challengeId);
    await refresh();
    const granted = result.grant && result.grant.payload ? Object.keys(result.grant.payload).length : 0;
    celebration([{ icon: "flag", text: granted ? t("engagement.challengeClaimed") : t("engagement.mysteryGrowing") }]);
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    celebration([{ icon: "bell", text: err instanceof ApiError ? err.message : t("engagement.actionError") }]);
    await refresh();
  }
}

function wireInteractions() {
  document.addEventListener("click", (event) => {
    const care = event.target.closest("[data-care-action]");
    if (care) return onCare(care);

    const mystery = event.target.closest("[data-mystery-claim]");
    if (mystery) return onClaimMystery(mystery.getAttribute("data-mystery-claim"), mystery);

    const challenge = event.target.closest("[data-challenge-claim]");
    if (challenge) return onClaimChallenge(challenge.getAttribute("data-challenge-claim"), challenge);

    return undefined;
  });
}

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("greenomy:translated", () => {
  if (state.loaded || state.error) {
    renderAll();
    initIcons();
  }
});
