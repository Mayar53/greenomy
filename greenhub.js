// green-hub.js — Green Hub article grid + category filters
import { getGreenHubArticles } from "./contentservice.js";
import { t } from "./language.js";

const CATEGORY_LABELS = {
  all: "greenHub.filterAll",
  "food-seed-recycling": "greenHub.filterSeed",
  "home-gardening": "greenHub.filterGarden",
  "plant-care": "greenHub.filterCare",
};

function articleCardHTML(article) {
  return `
    <article class="card article-card">
      <div class="article-thumb" role="img" aria-label="${article.title}"></div>
      <div class="article-body">
        <div class="article-meta">
          <span>${t(CATEGORY_LABELS[article.category] || "greenHub.filterAll")}</span>
          <span>${article.readingTime} ${t("greenHub.minRead")}</span>
        </div>
        <h3>${article.title}</h3>
        <p>${article.description}</p>
        <a class="btn-ghost reading-time" href="#" data-slug="${article.slug}">${t("greenHub.readMore")} →</a>
      </div>
    </article>
  `;
}

async function renderArticles(category = "all") {
  const grid = document.querySelector("[data-hub-grid]");
  if (!grid) return;

  grid.innerHTML = `<div class="loading-state"><span class="emoji">🌱</span>${t("common.loading")}</div>`;

  try {
    const { data } = await getGreenHubArticles({ category });
    if (!data.length) {
      grid.innerHTML = `<div class="empty-state"><span class="emoji">🌱</span>${t("common.emptyGeneric")}</div>`;
      return;
    }
    grid.innerHTML = data.map(articleCardHTML).join("");
  } catch (err) {
    grid.innerHTML = `<div class="error-state">${t("common.errorGeneric")}</div>`;
  }
}

function initFilters() {
  const bar = document.querySelector("[data-hub-filters]");
  if (!bar) return;

  bar.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip) return;
    bar.querySelectorAll(".filter-chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    chip.setAttribute("aria-pressed", "true");
    renderArticles(chip.getAttribute("data-category"));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initFilters();
  renderArticles("all");
});

document.addEventListener("greenomy:translated", () => {
  const activeChip = document.querySelector('.filter-chip[aria-pressed="true"]');
  renderArticles(activeChip ? activeChip.getAttribute("data-category") : "all");
});