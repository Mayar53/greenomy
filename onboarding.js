// onboarding.js — drives eco-profile.html and new-seed.html.
// Answers are held in sessionStorage as the user moves through
// onboarding → eco-profile → new-seed, then persisted for real
// (PATCH /users/me, POST /plants) at each page's completion.
import { requireAuthOrRedirect } from "./authservise.js";
import { api, ApiError } from "./servisapi.js";
import { createPlant } from "./serviseplant.js";
import { t, localized } from "./language.js";

const DRAFT_KEY = "greenomy:onboarding-draft";

function loadDraft() {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDraft(patch) {
  const draft = { ...loadDraft(), ...patch };
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  return draft;
}

function initTileGroup(container) {
  container.addEventListener("click", (e) => {
    const tile = e.target.closest(".option-tile");
    if (!tile) return;
    const multi = container.hasAttribute("data-multi");
    if (!multi) {
      container.querySelectorAll(".option-tile").forEach((t) => t.setAttribute("aria-pressed", "false"));
    }
    tile.setAttribute("aria-pressed", tile.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });
}

function getSelectedValues(container) {
  return Array.from(container.querySelectorAll('.option-tile[aria-pressed="true"]')).map((t) => t.dataset.value);
}

/* ------------------------------------------------------------------ */
/* eco-profile.html                                                    */
/* ------------------------------------------------------------------ */
function initEcoProfilePage() {
  const form = document.querySelector("[data-eco-profile-form]");
  if (!form) return;
  if (!requireAuthOrRedirect("login.html")) return;

  document.querySelectorAll("[data-tile-group]").forEach(initTileGroup);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = form.querySelector("[data-form-status]");
    const submitBtn = form.querySelector('button[type="submit"]');

    const fullName = form.querySelector("#fullName").value.trim();
    const city = form.querySelector("#city").value.trim();
    const experience = getSelectedValues(document.querySelector('[data-tile-group="experience"]'))[0] || null;
    const plantTypes = getSelectedValues(document.querySelector('[data-tile-group="plantTypes"]'));
    const interests = getSelectedValues(document.querySelector('[data-tile-group="interests"]'));

    if (!fullName || !city) {
      status.className = "form-status is-error";
      status.textContent = t("wizard.errProfile");
      return;
    }

    submitBtn.disabled = true;
    status.className = "form-status is-loading";
    status.textContent = t("wizard.saving");

    try {
      // The preferences now persist on the account instead of being dropped —
      // the recommender on the next page ranks against them.
      await api.patch("/users/me", { fullName, city, experience, plantTypes, interests });
      saveDraft({ fullName, city });
      window.location.href = "new-seed.html";
    } catch (err) {
      status.className = "form-status is-error";
      status.textContent = err.message || t("common.errorGeneric");
      submitBtn.disabled = false;
    }
  });
}

/* ------------------------------------------------------------------ */
/* new-seed.html — multi-step wizard                                   */
/* ------------------------------------------------------------------ */
function initNewSeedWizard() {
  const wizard = document.querySelector("[data-seed-wizard]");
  if (!wizard) return;
  if (!requireAuthOrRedirect("login.html")) return;

  const steps = Array.from(wizard.querySelectorAll("[data-step]"));
  // Scoped to the wizard card itself — new-seed.html also has a separate,
  // static 3-step page-level progress indicator outside this element.
  const dots = Array.from(wizard.querySelectorAll(".step-dot"));
  let current = 0;
  const draft = loadDraft();
  draft.seed = draft.seed || {};

  function renderStep() {
    steps.forEach((el, i) => el.toggleAttribute("hidden", i !== current));
    dots.forEach((dot, i) => {
      dot.classList.toggle("is-active", i === current);
      dot.classList.toggle("is-complete", i < current);
    });

    if (current === steps.length - 1) renderConfirmation();
  }

  const PLANT_TYPE_KEYS = {
    "Tomato": "wizard.plantTomato",
    "Basil": "wizard.plantBasil",
    "Orange Tree": "wizard.plantOrange",
    "Pothos": "wizard.plantPothos",
  };
  const PLANTING_METHOD_KEYS = {
    "From Seed": "wizard.methodSeed",
    "From Cutting": "wizard.methodCutting",
    "Transplanted Seedling": "wizard.methodSeedling",
    "Regrown From Scraps": "wizard.methodScraps",
  };

  function localizedValue(value, map, fallbackKey) {
    if (!value) return t(fallbackKey);
    return map[value] ? t(map[value]) : value;
  }

  function renderConfirmation() {
    const summary = wizard.querySelector("[data-seed-summary]");
    if (!summary) return;
    const plantType = localizedValue(draft.seed.plantType, PLANT_TYPE_KEYS, "wizard.yourPlant");
    const method = draft.seed.plantingMethod
      ? localizedValue(draft.seed.plantingMethod, PLANTING_METHOD_KEYS)
      : "—";
    summary.innerHTML = `
      <div class="card plant-preview-card">
        <div class="plant-preview-emoji">🌱</div>
        <div>
          <strong>${plantType}</strong>
          <p style="margin:2px 0 0; font-size:0.88rem;">
            ${method} · ${t("wizard.plantingLabel")} ${draft.seed.plantingDate || t("wizard.today")} · ${draft.seed.location || t("wizard.notSet")}
          </p>
        </div>
      </div>
    `;
  }

  wizard.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Capture the current step's inputs before advancing.
      const stepEl = steps[current];
      const tileGroup = stepEl.querySelector("[data-tile-group]");
      if (tileGroup) {
        const key = tileGroup.dataset.tileGroup;
        const values = getSelectedValues(tileGroup);
        if (!values.length) return; // require a selection before advancing
        draft.seed[key] = tileGroup.hasAttribute("data-multi") ? values : values[0];
      }
      const dateInput = stepEl.querySelector('input[type="date"]');
      if (dateInput) draft.seed.plantingDate = dateInput.value || null;
      const locationInput = stepEl.querySelector('input[name="location"]');
      if (locationInput) draft.seed.location = locationInput.value.trim() || null;

      saveDraft(draft);
      if (current < steps.length - 1) {
        current += 1;
        renderStep();
      }
    });
  });

  wizard.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (current > 0) {
        current -= 1;
        renderStep();
      }
    });
  });

  document.querySelectorAll('[data-tile-group="plantType"], [data-tile-group="plantingMethod"]').forEach(initTileGroup);

  const createBtn = wizard.querySelector("[data-create-plant]");
  if (createBtn) {
    createBtn.addEventListener("click", async () => {
      const status = wizard.querySelector("[data-form-status]");
      createBtn.disabled = true;
      status.className = "form-status is-loading";
      status.textContent = t("wizard.plantingStatus");

      try {
        await createPlant({
          plantType: draft.seed.plantType,
          plantingMethod: draft.seed.plantingMethod,
          plantingDate: draft.seed.plantingDate,
          location: draft.seed.location,
        });
        sessionStorage.removeItem(DRAFT_KEY);
        status.className = "form-status is-success";
        status.textContent = t("wizard.planted");
        window.location.href = "camera.html";
      } catch (err) {
        status.className = "form-status is-error";
        status.textContent = err.message || t("common.errorGeneric");
        createBtn.disabled = false;
      }
    });
  }

  renderStep();
}

/* ------------------------------------------------------------------ */
/* Optional AI: identify the plant from a photo (new-seed.html step 1) */
/* ------------------------------------------------------------------ */
const IDENTIFY_MAX = 640; // shrink before sending — vision calls are priced by size

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, IDENTIFY_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("unreadable image"));
    };
    img.src = URL.createObjectURL(file);
  });
}

/** Selects the matching tile, or adds one when the plant isn't in our catalog. */
function selectPlantType(group, value) {
  if (!group) return;

  group.querySelectorAll(".option-tile").forEach((t) => t.setAttribute("aria-pressed", "false"));

  const match = Array.from(group.querySelectorAll(".option-tile")).find(
    (tile) => (tile.dataset.value || "").toLowerCase() === value.toLowerCase()
  );
  if (match) {
    match.setAttribute("aria-pressed", "true");
    return;
  }

  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "option-tile";
  tile.dataset.value = value;
  tile.setAttribute("aria-pressed", "true");

  const emoji = document.createElement("span");
  emoji.className = "tile-emoji";
  emoji.textContent = "🌱";

  const name = document.createElement("strong");
  name.textContent = value;

  tile.append(emoji, name);
  group.appendChild(tile);
}

function initIdentify() {
  const input = document.querySelector("#seedPhoto");
  const status = document.querySelector("[data-identify-status]");
  const group = document.querySelector('[data-tile-group="plantType"]');
  if (!input || !status) return;

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;

    status.className = "form-status is-loading";
    status.textContent = t("identify.checking");

    try {
      const imageUrl = await fileToDataUrl(file);
      const result = await api.post("/ai/identify", { imageUrl });

      if (result.plantType) {
        selectPlantType(group, result.plantType);
        status.className = "form-status is-success";
        status.textContent = `${t("identify.found")}: ${result.plantType}`;
      } else {
        status.className = "form-status is-error";
        status.textContent = t("identify.none");
      }
    } catch (err) {
      // A 503 means no AI key is configured — the API's message explains that.
      status.className = "form-status is-error";
      status.textContent = err instanceof ApiError ? err.message : t("identify.error");
    } finally {
      input.value = "";
    }
  });
}

/* ------------------------------------------------------------------ */
/* Recommended for you (new-seed.html step 1)                          */
/*                                                                     */
/* Ranked server-side from the plant catalog by the member's city and  */
/* climate, the current season, how long they'll wait, and the         */
/* preferences they just gave. Picking a card selects that plant and   */
/* carries on with the wizard.                                         */
/* ------------------------------------------------------------------ */
const DURATION_DEFAULT = "months";
const POSITIVE_REASONS = ["climateMatch", "inSeason", "matchesPreference", "fitsDuration", "fitsExperience", "fitsSpace"];
const CAVEAT_REASONS = ["outOfSeason", "differentClimate", "outsidePreference", "needsExperience"];

function reasonChip(code, isCaveat) {
  const chip = document.createElement("span");
  chip.className = isCaveat ? "reason-chip is-caveat" : "reason-chip";
  chip.textContent = t(`recommend.reason.${code}`);
  return chip;
}

function recommendationCard(item, onPick) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "recommend-card";
  card.dataset.value = item.name;

  const head = document.createElement("span");
  head.className = "recommend-card-head";

  const emoji = document.createElement("span");
  emoji.className = "recommend-emoji";
  emoji.textContent = item.emoji || "🌱";

  const name = document.createElement("strong");
  name.textContent = localized(item, "name") || item.name;

  const days = document.createElement("span");
  days.className = "recommend-days";
  days.textContent = `${item.daysToHarvest} ${t("recommend.daysUnit")}`;

  head.append(emoji, name, days);

  const reasons = document.createElement("span");
  reasons.className = "recommend-reasons";
  item.reasons
    .filter((code) => POSITIVE_REASONS.includes(code))
    .slice(0, 3)
    .forEach((code) => reasons.appendChild(reasonChip(code, false)));
  item.reasons
    .filter((code) => CAVEAT_REASONS.includes(code))
    .slice(0, 1)
    .forEach((code) => reasons.appendChild(reasonChip(code, true)));

  const notes = document.createElement("span");
  notes.className = "recommend-notes";
  notes.textContent = localized(item, "notes") || item.notes || "";

  const category = document.createElement("span");
  category.className = "recommend-category";
  category.textContent = `${t(`category.${item.category}`)} · ${t(`difficulty.${item.difficulty}`)}`;

  card.append(head, reasons, notes, category);
  card.addEventListener("click", () => onPick(item));
  return card;
}

function renderRecommendations(container, payload) {
  const list = container.querySelector("[data-recommend-list]");
  const conditionsEl = container.querySelector("[data-recommend-conditions]");

  // "Erbil · autumn · 24°C · subtropical"
  const conditions = payload.conditions || {};
  const parts = [];
  if (conditions.city) parts.push(conditions.city);
  if (conditions.season) parts.push(t(`season.${conditions.season}`));
  if (typeof conditions.current?.temperature === "number") {
    parts.push(`${Math.round(conditions.current.temperature)}°C`);
  }
  if (conditions.climate) parts.push(t(`climate.${conditions.climate}`));
  if (conditions.approximate) parts.push(t("recommend.approximate"));
  conditionsEl.textContent = parts.join(" · ");

  list.replaceChildren();

  const group = document.querySelector('[data-tile-group="plantType"]');
  for (const item of payload.recommendations) {
    list.appendChild(
      recommendationCard(item, (chosen) => {
        selectPlantType(group, chosen.name);
        // Reuse the wizard's own Continue handler, which reads the selection.
        const next = document.querySelector("[data-seed-wizard] [data-next]");
        if (next) next.click();
      })
    );
  }
}

async function loadRecommendations(container, duration) {
  const status = container.querySelector("[data-recommend-status]");
  status.className = "form-status is-loading";
  status.textContent = t("recommend.loading");

  try {
    const payload = await api.get(`/recommendations?duration=${encodeURIComponent(duration)}`);
    renderRecommendations(container, payload);
    container.hidden = false;
    status.className = "form-status";
    status.textContent = "";
  } catch (err) {
    // The recommender is a bonus — if it fails the wizard's own tiles still work.
    container.hidden = true;
    console.warn("Recommendations unavailable:", err.message);
  }
}

function initRecommendations() {
  const container = document.querySelector("[data-recommend]");
  if (!container) return;
  if (!requireAuthOrRedirect("login.html")) return;

  const durationGroup = container.querySelector("[data-recommend-duration]");
  let duration = DURATION_DEFAULT;

  function markActive() {
    durationGroup.querySelectorAll("[data-value]").forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.value === duration);
      chip.setAttribute("aria-pressed", chip.dataset.value === duration ? "true" : "false");
    });
  }

  durationGroup.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-value]");
    if (!chip) return;
    duration = chip.dataset.value;
    markActive();
    loadRecommendations(container, duration);
  });

  markActive();
  loadRecommendations(container, duration);
}

document.addEventListener("DOMContentLoaded", () => {
  initEcoProfilePage();
  initNewSeedWizard();
  initIdentify();
  initRecommendations();
});
document.addEventListener("greenomy:translated", () => {
  // Re-render so the chips, names and reasons follow a language switch.
  const container = document.querySelector("[data-recommend]");
  if (container && !container.hidden) {
    const active = container.querySelector("[data-recommend-duration] [aria-pressed='true']");
    loadRecommendations(container, active ? active.dataset.value : DURATION_DEFAULT);
  }
});
