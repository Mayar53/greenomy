// rewards.js — public rewards showcase (read-only; redemption happens in-app)
import { getRewards } from "./contentservice.js";
import { t, localized } from "./language.js";

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function rewardCardHTML(reward) {
  const initials = String(reward.partner || "")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  return `
    <article class="card reward-card">
      <div class="reward-top">
        <div class="partner-logo">${escapeHtml(initials)}</div>
        <div>
          <strong>${escapeHtml(reward.partner)}</strong>
        </div>
      </div>
      <h3>${escapeHtml(localized(reward, "title"))}</h3>
      <p>${escapeHtml(localized(reward, "description"))}</p>
      <span class="points-tag">🏆 ${reward.pointsRequired} ${t("rewards.pointsRequired")}</span>
      <div class="reward-footer">
        <span>${t("rewards.expires")}: ${escapeHtml(reward.expiresAt)}</span>
      </div>
    </article>
  `;
}

async function renderRewards() {
  const grid = document.querySelector("[data-rewards-grid]");
  if (!grid) return;

  grid.innerHTML = `<div class="loading-state"><span class="emoji">🎁</span>${t("common.loading")}</div>`;

  try {
    const { data } = await getRewards();
    const active = data.filter((r) => r.isActive);
    if (!active.length) {
      grid.innerHTML = `<div class="empty-state"><span class="emoji">🎁</span>${t("common.emptyGeneric")}</div>`;
      return;
    }
    grid.innerHTML = active.map(rewardCardHTML).join("");
  } catch (err) {
    grid.innerHTML = `<div class="error-state">${t("common.errorGeneric")}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", renderRewards);
document.addEventListener("greenomy:translated", renderRewards);
