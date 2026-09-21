// green-hub.js — Green Hub article grid + category filters + article view
import { getGreenHubArticles } from "./contentservice.js";
import { t, localized } from "./language.js";

const CATEGORY_LABELS = {
  all: "greenHub.filterAll",
  "food-seed-recycling": "greenHub.filterSeed",
  "home-gardening": "greenHub.filterGarden",
  "plant-care": "greenHub.filterCare",
};

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function articleCardHTML(article) {
  const title = localized(article, "title");
  return `
    <article class="card article-card">
      <div class="article-thumb" role="img" aria-label="${escapeHtml(title)}"></div>
      <div class="article-body">
        <div class="article-meta">
          <span>${t(CATEGORY_LABELS[article.category] || "greenHub.filterAll")}</span>
          <span>${article.readingTime} ${t("greenHub.minRead")}</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(localized(article, "description"))}</p>
        <a class="btn-ghost reading-time" href="greenhub.html?slug=${encodeURIComponent(article.slug)}">${t("greenHub.readMore")} →</a>
      </div>
    </article>
  `;
}

function articleViewHTML(article) {
  const body = localized(article, "body");
  const paragraphs = Array.isArray(body)
    ? body
    : body
      ? [body]
      : [localized(article, "description")];

  return `
    <article class="card article-card" style="grid-column: 1 / -1;">
      <a class="btn-ghost" href="greenhub.html">← ${t("greenHub.backToList")}</a>
      <div class="article-meta" style="margin-top:16px;">
        <span>${t(CATEGORY_LABELS[article.category] || "greenHub.filterAll")}</span>
        <span>${article.readingTime} ${t("greenHub.minRead")}</span>
      </div>
      <h1 class="heading-lg" style="margin-top:8px;">${escapeHtml(localized(article, "title"))}</h1>
      <p class="section-lead">${escapeHtml(localized(article, "description"))}</p>
      ${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
    </article>
  `;
}

async function loadArticles(category) {
  const { data } = await getGreenHubArticles({ category });
  return data;
}

async function renderArticles(category = "all") {
  const grid = document.querySelector("[data-hub-grid]");
  if (!grid) return;

  grid.innerHTML = `<div class="loading-state"><span class="emoji">🌱</span>${t("common.loading")}</div>`;

  try {
    const data = await loadArticles(category);
    if (!data.length) {
      grid.innerHTML = `<div class="empty-state"><span class="emoji">🌱</span>${t("common.emptyGeneric")}</div>`;
      return;
    }
    grid.innerHTML = data.map(articleCardHTML).join("");
  } catch (err) {
    grid.innerHTML = `<div class="error-state">${t("common.errorGeneric")}</div>`;
  }
}

async function renderArticle(slug) {
  const grid = document.querySelector("[data-hub-grid]");
  if (!grid) return;

  const bar = document.querySelector("[data-hub-filters]");
  if (bar) bar.setAttribute("hidden", "");

  grid.innerHTML = `<div class="loading-state"><span class="emoji">🌱</span>${t("common.loading")}</div>`;

  try {
    const data = await loadArticles("all");
    const article = data.find((a) => a.slug === slug);
    if (!article) {
      grid.innerHTML = `<div class="empty-state"><span class="emoji">🌱</span>${t("common.emptyGeneric")}</div>`;
      return;
    }
    grid.innerHTML = articleViewHTML(article);
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

function currentSlug() {
  return new URLSearchParams(window.location.search).get("slug");
}

document.addEventListener("DOMContentLoaded", () => {
  const slug = currentSlug();
  if (slug) {
    renderArticle(slug);
    return;
  }
  initFilters();
  renderArticles("all");
});

document.addEventListener("greenomy:translated", () => {
  const slug = currentSlug();
  if (slug) {
    renderArticle(slug);
    return;
  }
  const activeChip = document.querySelector('.filter-chip[aria-pressed="true"]');
  renderArticles(activeChip ? activeChip.getAttribute("data-category") : "all");
});
