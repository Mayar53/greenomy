// onboarding.js — drives eco-profile.html and new-seed.html.
// Answers are held in sessionStorage as the user moves through
// onboarding → eco-profile → new-seed, then persisted for real
// (PATCH /users/me, POST /plants) at each page's completion.
import { requireAuthOrRedirect } from "./authservise.js";
import { api } from "./servisapi.js";
import { createPlant } from "./serviseplant.js";

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
      status.textContent = "Please fill in your name and city.";
      return;
    }

    submitBtn.disabled = true;
    status.className = "form-status is-loading";
    status.textContent = "Saving your profile...";

    try {
      await api.patch("/users/me", { fullName, city });
      saveDraft({ fullName, city, experience, plantTypes, interests });
      window.location.href = "new-seed.html";
    } catch (err) {
      status.className = "form-status is-error";
      status.textContent = err.message || "Something went wrong. Please try again.";
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

  function renderConfirmation() {
    const summary = wizard.querySelector("[data-seed-summary]");
    if (!summary) return;
    summary.innerHTML = `
      <div class="card plant-preview-card">
        <div class="plant-preview-emoji">🌱</div>
        <div>
          <strong>${draft.seed.plantType || "Your plant"}</strong>
          <p style="margin:2px 0 0; font-size:0.88rem;">
            ${draft.seed.plantingMethod || "—"} · Planting ${draft.seed.plantingDate || "today"} · ${draft.seed.location || "Location not set"}
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
      status.textContent = "Planting your first seed...";

      try {
        await createPlant({
          plantType: draft.seed.plantType,
          plantingMethod: draft.seed.plantingMethod,
          plantingDate: draft.seed.plantingDate,
          location: draft.seed.location,
        });
        sessionStorage.removeItem(DRAFT_KEY);
        status.className = "form-status is-success";
        status.textContent = "Your plant has been created! Redirecting...";
        window.location.href = "index.html";
      } catch (err) {
        status.className = "form-status is-error";
        status.textContent = err.message || "Something went wrong. Please try again.";
        createBtn.disabled = false;
      }
    });
  }

  renderStep();
}

document.addEventListener("DOMContentLoaded", () => {
  initEcoProfilePage();
  initNewSeedWizard();
});