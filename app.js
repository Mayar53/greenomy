// app.js — controller for the signed-in app pages: wallet.html and garden.html.
// One module drives both; a page's root container decides what gets rendered.
// Data comes from the service layer (plants/verifications) and the shared API
// client (wallet, which is account-scoped like the /users/me calls in onboarding.js).
import { requireAuthOrRedirect, logout } from "./authservise.js";
import { api, ApiError } from "./servisapi.js";
import { listMyPlants, listJourneys } from "./serviseplant.js";
import { listVerifications } from "./verifyservice.js";
import { t, localized, currentLanguage } from "./language.js";
import { getGreenHubArticles } from "./contentservice.js";
import { iconMarkup, plantIcon } from "./icons.js";

const state = {
  wallet: null,
  walletError: false,
  transactions: [],
  notifications: [],
  notificationsLoaded: false,
  plants: [],
  verifications: [],
  journeys: [],
  gardenLoaded: false,
  gardenError: false,
};

const STAGE_KEYS = { seed: "garden.stageSeed", sprout: "garden.stageSprout", plant: "garden.stagePlant" };
const TX_KEYS = {
  verification_approved: "wallet.txVerification",
  reward_earned: "wallet.txRewardEarned",
  reward_redeemed: "wallet.txReward",
};
const NOTIFICATION_KEYS = {
  verification_approved: "notifications.verification_approved",
  verification_pending: "notifications.verification_pending",
  verification_rejected: "notifications.verification_rejected",
  reward_redeemed: "notifications.reward_redeemed",
};
const VERDICT_KEYS = {
  approved: "garden.verificationApproved",
  pending: "garden.verificationPending",
  rejected: "garden.verificationRejected",
  none: "garden.neverVerified",
};

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function isAuthError(err) {
  return err instanceof ApiError && err.status === 401;
}

function gotoLogin() {
  window.location.href = "login.html";
}

/* ---------------------------------------------------------------- Wallet */
function renderWallet() {
  const summary = document.querySelector("[data-wallet-summary]");
  if (!summary) return;

  if (state.walletError) {
    summary.innerHTML = `<div class="error-state">${escapeHtml(t("wallet.loadError"))}</div>`;
    const history = document.querySelector("[data-wallet-history]");
    if (history) history.innerHTML = "";
    return;
  }
  if (!state.wallet) {
    summary.innerHTML = `<div class="loading-state">${iconMarkup("trophy")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }

  const { currentPoints, totalEarned, totalSpent } = state.wallet;
  summary.innerHTML = `
    <div class="card wallet-stat">
      <strong class="is-balance">${Number(currentPoints || 0).toLocaleString()}</strong>
      <span>${escapeHtml(t("wallet.balance"))}</span>
    </div>
    <div class="card wallet-stat">
      <strong>${Number(totalEarned || 0).toLocaleString()}</strong>
      <span>${escapeHtml(t("wallet.earned"))}</span>
    </div>
    <div class="card wallet-stat">
      <strong>${Number(totalSpent || 0).toLocaleString()}</strong>
      <span>${escapeHtml(t("wallet.spent"))}</span>
    </div>
  `;
  renderHistory();
}

function txItemHTML(tx) {
  const positive = tx.amount >= 0;
  const label = t(TX_KEYS[tx.transaction_type] || "wallet.txAdjustment");
  const amount = Number(Math.abs(tx.amount || 0)).toLocaleString();
  return `
    <div class="tx-item">
      <div>
        <span class="tx-label">${escapeHtml(label)}</span>
        <span class="tx-date">${escapeHtml(fmtDate(tx.created_at))}</span>
      </div>
      <span class="tx-amount ${positive ? "is-plus" : "is-minus"}">${positive ? "+" : "−"}${amount}</span>
    </div>
  `;
}

function renderHistory() {
  const host = document.querySelector("[data-wallet-history]");
  if (!host) return;

  if (!state.transactions.length) {
    host.innerHTML = `<div class="empty-state">${iconMarkup("trophy")}${escapeHtml(t("wallet.empty"))}</div>`;
    return;
  }

  const rows = [...state.transactions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  host.innerHTML = `<div class="tx-list">${rows.map(txItemHTML).join("")}</div>`;
}

/* --------------------------------------------------------- Notifications */
/** The stored title/message are English; `type` is the localisable key. */
function notificationItemHTML(notification) {
  const key = NOTIFICATION_KEYS[notification.type];
  return `
    <div class="tx-item">
      <div class="history-main">
        <span class="tx-label">${escapeHtml(key ? t(key) : notification.title)}</span>
        <span class="tx-date">${escapeHtml(notification.message || "")} · ${escapeHtml(fmtDate(notification.created_at))}</span>
      </div>
      ${notification.is_read ? "" : `<span class="status-badge is-pending">${escapeHtml(t("notifications.unread"))}</span>`}
    </div>
  `;
}

function renderNotifications() {
  const host = document.querySelector("[data-notifications]");
  if (!host) return;

  if (!state.notificationsLoaded) {
    host.innerHTML = `<div class="loading-state">${iconMarkup("bell")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }
  if (!state.notifications.length) {
    host.innerHTML = `<div class="empty-state">${iconMarkup("bell")}${escapeHtml(t("notifications.empty"))}</div>`;
    return;
  }

  const unread = state.notifications.filter((n) => !n.is_read).length;
  const banner = unread
    ? `<div class="app-actions">
         <button type="button" class="btn btn-secondary" data-mark-all-read>${escapeHtml(t("notifications.markAll"))}</button>
         <span class="form-note">${unread} ${escapeHtml(t("notifications.unread"))}</span>
       </div>`
    : "";

  host.innerHTML = `${banner}<div class="tx-list">${state.notifications.map(notificationItemHTML).join("")}</div>`;
}

/* ---------------------------------------------------------------- Garden */
function latestVerification(plantId) {
  const forPlant = state.verifications.filter((v) => v.plant_id === plantId);
  if (!forPlant.length) return null;
  return forPlant.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

function plantCardHTML(plant) {
  const verification = latestVerification(plant.plant_id);
  const status = verification ? verification.approval_status : "none";
  const stage = t(STAGE_KEYS[plant.stage] || "garden.stageSeed");

  return `
    <article class="card plant-card">
      <div class="plant-card-top">
        <div class="plant-card-icon" aria-hidden="true">${iconMarkup(plantIcon(plant))}</div>
        <div class="plant-card-id">
          <strong>${escapeHtml(plant.plant_type)}</strong>
          <p class="plant-card-loc">${escapeHtml(plant.location || t("garden.notSet"))}</p>
        </div>
        <span class="status-badge is-${status}">${escapeHtml(t(VERDICT_KEYS[status] || "garden.neverVerified"))}</span>
      </div>
      <div class="plant-card-meta">
        <span>${escapeHtml(t("garden.stage"))}: ${escapeHtml(stage)}</span>
        <span>${escapeHtml(t("garden.planted"))}: ${escapeHtml(fmtDate(plant.planting_date))}</span>
      </div>
      <a href="camera.html" class="btn btn-secondary btn-block">${escapeHtml(t("garden.verify"))}</a>
    </article>
  `;
}

function renderGarden() {
  const grid = document.querySelector("[data-garden-grid]");
  if (!grid) return;

  if (state.gardenError) {
    grid.innerHTML = `<div class="error-state">${escapeHtml(t("garden.loadError"))}</div>`;
    return;
  }
  if (!state.gardenLoaded) {
    grid.innerHTML = `<div class="loading-state">${iconMarkup("sprout")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }
  if (!state.plants.length) {
    grid.innerHTML = `
      <div class="empty-state">
        ${iconMarkup("sprout")}
        <p>${escapeHtml(t("garden.empty"))}</p>
        <a href="new-seed.html" class="btn btn-primary">${escapeHtml(t("garden.emptyCta"))}</a>
      </div>`;
    return;
  }

  grid.innerHTML = state.plants.map(plantCardHTML).join("");
}

function historyItemHTML(verification) {
  const plant = state.plants.find((p) => p.plant_id === verification.plant_id);
  const name = plant ? plant.plant_type : t("garden.title");
  const status = verification.approval_status || "none";
  const score = Math.round((verification.ai_confidence_score || 0) * 100);
  const thumb = verification.image_url
    ? `<img class="history-thumb" src="${escapeHtml(verification.image_url)}" alt="" />`
    : `<div class="history-thumb" aria-hidden="true"></div>`;

  return `
    <div class="tx-item history-item">
      ${thumb}
      <div class="history-main">
        <span class="tx-label">${escapeHtml(name)}</span>
        <span class="tx-date">${escapeHtml(fmtDate(verification.created_at))} · ${score}%</span>
      </div>
      <span class="status-badge is-${status}">${escapeHtml(t(VERDICT_KEYS[status] || "garden.neverVerified"))}</span>
    </div>
  `;
}

function renderVerificationHistory() {
  const host = document.querySelector("[data-verification-history]");
  if (!host) return;

  if (state.gardenError) {
    host.innerHTML = "";
    return;
  }
  if (!state.gardenLoaded) {
    host.innerHTML = `<div class="loading-state">${iconMarkup("camera")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }
  if (!state.verifications.length) {
    host.innerHTML = `<div class="empty-state">${iconMarkup("camera")}${escapeHtml(t("garden.historyEmpty"))}</div>`;
    return;
  }

  const rows = [...state.verifications].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  host.innerHTML = `<div class="tx-list">${rows.map(historyItemHTML).join("")}</div>`;
}

/* ------------------------------------------------------------- Assistant */
/** Titles for the guides an answer was grounded in, so a reply can link back to
 * what it drew on. Fetched once per session; failure just means no links. */
let guideTitlesRequest = null;
function guideTitles() {
  if (!guideTitlesRequest) {
    guideTitlesRequest = getGreenHubArticles()
      .then(({ data }) => {
        const titles = new Map();
        (data || []).forEach((article) => titles.set(article.slug, localized(article, "title") || article.slug));
        return titles;
      })
      .catch(() => new Map());
  }
  return guideTitlesRequest;
}

/** Built with textContent, never innerHTML: the reply is model output, so it
 * must never be treated as markup. */
function appendAssistantMessage(thread, who, text, sources = []) {
  if (!thread) return;

  const bubble = document.createElement("div");
  bubble.className = `assistant-msg is-${who === "you" ? "user" : "bot"}`;

  const label = document.createElement("span");
  label.className = "assistant-who";
  label.textContent = who === "you" ? t("assistant.you") : t("assistant.answerLabel");

  bubble.append(label, document.createTextNode(text));

  if (sources.length) {
    const line = document.createElement("span");
    line.className = "assistant-sources";
    line.append(`${t("assistant.sources")}: `);
    sources.forEach((source, index) => {
      if (index) line.append(", ");
      const link = document.createElement("a");
      link.href = `greenhub.html?slug=${encodeURIComponent(source.slug)}`;
      link.textContent = source.title;
      line.appendChild(link);
    });
    bubble.appendChild(line);
  }

  thread.appendChild(bubble);
  thread.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function initAssistant() {
  const form = document.querySelector("[data-assistant-form]");
  if (!form) return;

  const thread = document.querySelector("[data-assistant-thread]");
  const status = form.querySelector("[data-form-status]");

  // The conversation so far, sent with each question so follow-ups ("and in
  // summer?") are understood. Bounded — the backend also caps it.
  const history = [];
  const HISTORY_TURNS = 8;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = form.querySelector("#assistantMessage");
    const submitBtn = form.querySelector('button[type="submit"]');
    const message = input.value.trim();
    if (!message) return;

    appendAssistantMessage(thread, "you", message);
    input.value = "";
    submitBtn.disabled = true;
    status.className = "form-status is-loading";
    status.textContent = t("assistant.thinking");

    try {
      // The language is sent so a reply that falls back to our own guide text
      // comes back in the language the member is reading.
      const data = await api.post("/ai/assistant", { message, lang: currentLanguage(), history });

      const titles = data.sources && data.sources.length ? await guideTitles() : null;
      const sources = titles ? data.sources.map((slug) => ({ slug, title: titles.get(slug) || slug })) : [];
      appendAssistantMessage(thread, "bot", data.reply, sources);
      status.className = "form-status";
      status.textContent = "";

      // Remember this exchange so the next question has the context.
      history.push({ role: "user", content: message }, { role: "assistant", content: data.reply });
      if (history.length > HISTORY_TURNS * 2) history.splice(0, history.length - HISTORY_TURNS * 2);
    } catch (err) {
      if (isAuthError(err)) return gotoLogin();
      // A 503 here means no AI key is configured — the API's message says so.
      status.className = "form-status is-error";
      status.textContent = err instanceof ApiError ? err.message : t("assistant.error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------- Journeys */
/** The stage label, localized when we have a translation for the stage key. */
function stageLabel(milestone) {
  if (!milestone) return "";
  const key = `journey.stages.${milestone.stage_key}`;
  const translated = t(key);
  return translated === key ? milestone.label_en : translated;
}

function journeyItemHTML(journey) {
  const milestones = journey.milestones || [];
  const done = milestones.filter((milestone) => milestone.completed_at).length;
  const complete = journey.status === "completed";
  const next = milestones.find((milestone) => !milestone.completed_at) || null;
  const stage = complete ? t("journey.complete") : stageLabel(next) || journey.current_stage;

  const nextLine =
    next && !complete
      ? `<div class="plant-card-meta"><span>${escapeHtml(t("journey.next"))}: ${escapeHtml(stageLabel(next))}${
          next.recommended_window ? ` · ${escapeHtml(next.recommended_window)}` : ""
        }</span></div>`
      : "";

  return `
    <article class="card plant-card">
      <div class="plant-card-top">
        <div class="plant-card-icon" aria-hidden="true">${iconMarkup(plantIcon(journey))}</div>
        <div class="plant-card-id">
          <strong>${escapeHtml(journey.plant_type)}</strong>
          <p class="plant-card-loc">${escapeHtml(t("journey.stage"))}: ${escapeHtml(stage)}</p>
        </div>
        <span class="status-badge is-${complete ? "approved" : "pending"}">${done}/${milestones.length}</span>
      </div>
      ${nextLine}
    </article>
  `;
}

function renderJourneys() {
  const host = document.querySelector("[data-journey-list]");
  if (!host) return;

  if (state.gardenError) {
    host.innerHTML = "";
    return;
  }
  if (!state.gardenLoaded) {
    host.innerHTML = `<div class="loading-state">${iconMarkup("sprout")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }
  if (!state.journeys.length) {
    host.innerHTML = `<div class="empty-state">${iconMarkup("sprout")}${escapeHtml(t("garden.empty"))}</div>`;
    return;
  }

  host.innerHTML = state.journeys.map(journeyItemHTML).join("");
}

function renderAll() {
  renderWallet();
  renderGarden();
  renderVerificationHistory();
  renderJourneys();
  renderNotifications();
}

/* ------------------------------------------------------------------ Boot */
function wireLogout() {
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await logout();
      } finally {
        window.location.href = "index.html";
      }
    });
  });
}

function wireNotifications() {
  const host = document.querySelector("[data-notifications]");
  if (!host) return;

  host.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-mark-all-read]");
    if (!button) return;

    button.disabled = true;
    try {
      await api.post("/notifications/read-all", {});
      state.notifications = state.notifications.map((n) => ({ ...n, is_read: true }));
      renderNotifications();
    } catch (err) {
      if (isAuthError(err)) return gotoLogin();
      button.disabled = false;
    }
  });
}

async function loadWallet() {
  if (!document.querySelector("[data-wallet-summary]")) return;
  try {
    const [wallet, transactions] = await Promise.all([
      api.get("/wallet"),
      api.get("/wallet/transactions"),
    ]);
    state.wallet = wallet;
    state.transactions = Array.isArray(transactions) ? transactions : [];
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    state.walletError = true;
  }
}

async function loadGarden() {
  if (!document.querySelector("[data-garden-grid]")) return;
  try {
    const [plants, verifications, journeys] = await Promise.all([
      listMyPlants(),
      listVerifications(),
      listJourneys(),
    ]);
    state.plants = Array.isArray(plants) ? plants : [];
    state.verifications = Array.isArray(verifications) ? verifications : [];
    state.journeys = Array.isArray(journeys) ? journeys : [];
    state.gardenLoaded = true;
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    state.gardenError = true;
  }
}

async function loadNotifications() {
  if (!document.querySelector("[data-notifications]")) return;
  try {
    state.notifications = await api.get("/notifications");
  } catch (err) {
    if (isAuthError(err)) return gotoLogin();
    state.notifications = [];
  }
  state.notificationsLoaded = true;
}

async function init() {
  if (!requireAuthOrRedirect("login.html")) return;
  wireLogout();
  wireNotifications();
  initAssistant();
  renderAll(); // paint loading states immediately
  await Promise.all([loadWallet(), loadGarden(), loadNotifications()]);
  renderAll();
}

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("greenomy:translated", renderAll);
