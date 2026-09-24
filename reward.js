// reward.js — public rewards showcase (read-only) plus in-app redemption.
// Rewards come from GET /api/rewards (snake_case) or the local rewards.json
// fallback (camelCase), so every record is normalized to one shape first.
import { getRewards } from "./contentservice.js";
import { api, ApiError } from "./servisapi.js";
import { isAuthenticated } from "./authservise.js";
import { t, localized } from "./language.js";
import { iconMarkup } from "./icons.js";

const CATEGORY_LABELS = {
  restaurant: "rewards.catRestaurant",
  courses: "rewards.catCourses",
  supplies: "rewards.catSupplies",
  university: "rewards.catUniversity",
};

let rewards = [];
let activeCategory = "all";
let balance = null; // cached points balance, refetched after a redemption
let busy = false;

const modal = { root: null, body: null };

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function normalizeReward(raw) {
  return {
    id: raw.reward_id ?? raw.id,
    partner: raw.partner || "",
    category: raw.category || "restaurant",
    title: raw.title,
    description: raw.description,
    pointsRequired: raw.points_required ?? raw.pointsRequired ?? 0,
    expiresAt: raw.expires_at ?? raw.expiresAt ?? null,
    isActive: raw.is_active ?? raw.isActive ?? true,
    i18n: raw.i18n,
  };
}

function categoryLabel(category) {
  return t(CATEGORY_LABELS[category] || "rewards.catAll");
}

function isExpired(reward) {
  return Boolean(reward.expiresAt) && new Date(reward.expiresAt) < new Date();
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function toLogin() {
  window.location.href = "login.html";
}

/* ------------------------------------------------------------- Rendering */
function rewardCardHTML(reward) {
  const initials = String(reward.partner)
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("");
  const expired = isExpired(reward);
  const action = isAuthenticated()
    ? `<button type="button" class="btn btn-primary btn-block" data-redeem="${escapeHtml(reward.id)}"${expired ? " disabled" : ""}>
         ${escapeHtml(expired ? t("rewards.expiredReward") : t("rewards.redeem"))}
       </button>`
    : `<a href="login.html" class="btn btn-secondary btn-block">${escapeHtml(t("rewards.redeemLogin"))}</a>`;

  return `
    <article class="card reward-card">
      <div class="reward-top">
        <div class="partner-logo">${escapeHtml(initials)}</div>
        <div><strong>${escapeHtml(reward.partner)}</strong></div>
      </div>
      <span class="category-tag">${escapeHtml(categoryLabel(reward.category))}</span>
      <h2>${escapeHtml(localized(reward, "title"))}</h2>
      <p>${escapeHtml(localized(reward, "description"))}</p>
      <span class="points-tag">${iconMarkup("trophy")} ${Number(reward.pointsRequired).toLocaleString()} ${escapeHtml(t("rewards.pointsRequired"))}</span>
      <div class="reward-footer">
        <span>${escapeHtml(t("rewards.expires"))}: ${escapeHtml(reward.expiresAt || "—")}</span>
      </div>
      ${action}
    </article>
  `;
}

function visibleRewards() {
  return rewards.filter((r) => r.isActive && (activeCategory === "all" || r.category === activeCategory));
}

function renderRewards() {
  const grid = document.querySelector("[data-rewards-grid]");
  if (!grid) return;

  const list = visibleRewards();
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state">${iconMarkup("gift")}${escapeHtml(t("rewards.emptyFilter"))}</div>`;
    return;
  }
  grid.innerHTML = list.map(rewardCardHTML).join("");
}

async function loadRewards() {
  const grid = document.querySelector("[data-rewards-grid]");
  if (!grid) return;

  grid.innerHTML = `<div class="loading-state">${iconMarkup("gift")}${escapeHtml(t("common.loading"))}</div>`;
  try {
    const { data } = await getRewards();
    rewards = (Array.isArray(data) ? data : []).map(normalizeReward);
    renderRewards();
  } catch (err) {
    grid.innerHTML = `<div class="error-state">${escapeHtml(t("common.errorGeneric"))}</div>`;
  }
}

/* ---------------------------------------------------------------- Modal */
function openModal(html) {
  if (!modal.root) return;
  modal.body.innerHTML = html;
  modal.root.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal() {
  if (!modal.root) return;
  modal.root.hidden = true;
  modal.body.innerHTML = "";
  document.body.style.overflow = "";
}

function modalMessage(message) {
  openModal(`
    <h2 class="heading-md" id="redeem-modal-title">${escapeHtml(t("rewards.redeem"))}</h2>
    <p class="form-status is-error">${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" data-modal-close>${escapeHtml(t("rewards.close"))}</button>
    </div>
  `);
}

function renderQR(container, payload) {
  if (!container) return;
  if (typeof window.QRCode === "function") {
    container.innerHTML = "";
    new window.QRCode(container, {
      text: payload,
      width: 200,
      height: 200,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    return;
  }
  // CDN unavailable (offline): the opaque token is itself the scannable payload.
  container.innerHTML = `<div class="qr-fallback">${escapeHtml(payload)}</div>`;
}

function showRedemption({ redemption, qrPayload }) {
  openModal(`
    <h2 class="heading-md" id="redeem-modal-title">${escapeHtml(t("rewards.successTitle"))}</h2>
    <p>${escapeHtml(t("rewards.qrHint"))}</p>
    <div class="qr-wrap" data-qr></div>
    <p class="qr-token"><span>${escapeHtml(t("rewards.tokenLabel"))}</span> <code>${escapeHtml(qrPayload)}</code></p>
    <p class="form-note">${escapeHtml(t("rewards.validUntil"))}: ${escapeHtml(fmtDateTime(redemption && redemption.expires_at))}</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-primary" data-modal-close>${escapeHtml(t("rewards.close"))}</button>
    </div>
  `);
  renderQR(modal.body.querySelector("[data-qr]"), qrPayload);
}

async function currentBalance() {
  if (typeof balance === "number") return balance;
  const wallet = await api.get("/wallet");
  balance = wallet.currentPoints;
  return balance;
}

async function beginRedeem(rewardId) {
  const reward = rewards.find((r) => r.id === rewardId);
  if (!reward) return;
  if (!isAuthenticated()) return toLogin();

  openModal(`<div class="loading-state">${iconMarkup("gift")}${escapeHtml(t("common.loading"))}</div>`);

  let available;
  try {
    available = await currentBalance();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return toLogin();
    modalMessage(t("rewards.redeemError"));
    return;
  }

  const after = available - reward.pointsRequired;
  const affordable = after >= 0;

  openModal(`
    <h2 class="heading-md" id="redeem-modal-title">${escapeHtml(t("rewards.confirmTitle"))}</h2>
    <p>${escapeHtml(localized(reward, "title"))} — <strong>${escapeHtml(reward.partner)}</strong></p>
    <ul class="redeem-summary">
      <li><span>${escapeHtml(t("rewards.cost"))}</span><strong>${Number(reward.pointsRequired).toLocaleString()} ${escapeHtml(t("rewards.pointsRequired"))}</strong></li>
      <li><span>${escapeHtml(t("rewards.balance"))}</span><strong>${Number(available).toLocaleString()}</strong></li>
      <li><span>${escapeHtml(t("rewards.after"))}</span><strong class="${affordable ? "" : "is-negative"}">${Number(after).toLocaleString()}</strong></li>
    </ul>
    ${affordable ? "" : `<p class="form-status is-error">${escapeHtml(t("rewards.notEnough"))}</p>`}
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" data-modal-close>${escapeHtml(t("rewards.cancel"))}</button>
      <button type="button" class="btn btn-primary" data-confirm-redeem="${escapeHtml(reward.id)}"${affordable ? "" : " disabled"}>${escapeHtml(t("rewards.confirmBtn"))}</button>
    </div>
  `);
}

async function confirmRedeem(rewardId) {
  if (busy) return;
  busy = true;
  const confirmBtn = modal.body.querySelector("[data-confirm-redeem]");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = t("common.loading");
  }

  try {
    const result = await api.post(`/rewards/${encodeURIComponent(rewardId)}/redeem`, {});
    balance = null; // refetch next time — points just changed
    showRedemption(result);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return toLogin();
    let message = t("rewards.redeemError");
    if (err instanceof ApiError && err.status === 402) message = t("rewards.notEnough");
    else if (err instanceof ApiError && err.status === 410) message = t("rewards.expiredReward");
    modalMessage(message);
  } finally {
    busy = false;
  }
}

/* ------------------------------------------------------------------ Init */
function initFilters() {
  const bar = document.querySelector("[data-reward-filters]");
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    bar.querySelectorAll(".filter-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    chip.setAttribute("aria-pressed", "true");
    activeCategory = chip.getAttribute("data-category");
    renderRewards();
  });
}

function initModal() {
  modal.root = document.querySelector("[data-redeem-modal]");
  if (!modal.root) return;
  modal.body = modal.root.querySelector("[data-modal-body]");

  modal.root.addEventListener("click", (e) => {
    if (e.target.closest("[data-modal-close]")) return closeModal();
    const confirm = e.target.closest("[data-confirm-redeem]");
    if (confirm) confirmRedeem(confirm.getAttribute("data-confirm-redeem"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.root.hidden) closeModal();
  });
}

function initGridActions() {
  const grid = document.querySelector("[data-rewards-grid]");
  if (!grid) return;
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-redeem]");
    if (btn && !btn.disabled) beginRedeem(btn.getAttribute("data-redeem"));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("[data-rewards-grid]")) return;
  initFilters();
  initModal();
  initGridActions();
  loadRewards();
});

document.addEventListener("greenomy:translated", renderRewards);
