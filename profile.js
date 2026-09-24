// profile.js — the signed-in user's own page: account summary, name/city
// editing, and password change.
//
// Note: fetchCurrentUser() normalises the API's snake_case into camelCase
// (fullName, totalPoints, createdAt), so this module reads camelCase.
import { requireAuthOrRedirect, changePassword, logout, fetchCurrentUser } from "./authservise.js";
import { api, ApiError } from "./servisapi.js";
import { t } from "./language.js";
import { iconMarkup } from "./icons.js";

const ROLE_LABELS = {
  user: "admin.roleUser",
  admin: "admin.roleAdmin",
  super_admin: "admin.roleSuperAdmin",
};

let user = null;

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

const toLogin = () => {
  window.location.href = "login.html";
};

const isAuthError = (err) => err instanceof ApiError && err.status === 401;

/** Mirrors the server's rule so the failure is explained before submitting. */
function passwordProblem(value) {
  if (typeof value !== "string" || value.length < 8) return "auth.errPasswordShort";
  if (!/[A-Za-z]/.test(value)) return "auth.errPasswordLetter";
  if (!/[0-9]/.test(value)) return "auth.errPasswordNumber";
  return null;
}

function setFieldError(input, message) {
  const wrapper = input.closest(".form-field");
  if (!wrapper) return;
  wrapper.classList.toggle("has-error", Boolean(message));
  const el = wrapper.querySelector(".field-error");
  if (el) el.textContent = message || "";
}

function setStatus(statusEl, mode, message) {
  if (!statusEl) return;
  statusEl.className = mode ? `form-status is-${mode}` : "form-status";
  statusEl.textContent = message || "";
}

function renderSummary() {
  const host = document.querySelector("[data-profile-summary]");
  if (!host) return;

  if (!user) {
    host.innerHTML = `<div class="loading-state">${iconMarkup("user")}${escapeHtml(t("common.loading"))}</div>`;
    return;
  }

  host.innerHTML = `
    <h2 class="heading-md">${escapeHtml(t("profile.detailsTitle"))}</h2>
    <ul class="redeem-summary">
      <li><span>${escapeHtml(t("profile.emailLabel"))}</span><strong>${escapeHtml(user.email)}</strong></li>
      <li><span>${escapeHtml(t("profile.roleLabel"))}</span><strong>${escapeHtml(t(ROLE_LABELS[user.role] || "admin.roleUser"))}</strong></li>
      <li><span>${escapeHtml(t("profile.joinedLabel"))}</span><strong>${escapeHtml(fmtDate(user.createdAt))}</strong></li>
      <li><span>${escapeHtml(t("profile.pointsLabel"))}</span><strong>${Number(user.totalPoints || 0).toLocaleString()}</strong></li>
    </ul>
  `;
}

/* Preference tiles. The same toggle behaviour as the onboarding wizard, which
 * lives in onboarding.js and isn't loaded on this page. */
function initTileGroup(container) {
  container.addEventListener("click", (e) => {
    const tile = e.target.closest(".option-tile");
    if (!tile) return;
    if (!container.hasAttribute("data-multi")) {
      container.querySelectorAll(".option-tile").forEach((t) => t.setAttribute("aria-pressed", "false"));
    }
    tile.setAttribute("aria-pressed", tile.getAttribute("aria-pressed") === "true" ? "false" : "true");
  });
}

function selectedValues(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll('.option-tile[aria-pressed="true"]')).map((t) => t.dataset.value);
}

function setTileSelection(container, values) {
  if (!container) return;
  const wanted = new Set(values || []);
  container.querySelectorAll(".option-tile").forEach((tile) => {
    tile.setAttribute("aria-pressed", wanted.has(tile.dataset.value) ? "true" : "false");
  });
}

function fillProfileForm() {
  const form = document.querySelector("[data-profile-form]");
  if (!form || !user) return;
  form.querySelector("#fullName").value = user.fullName || "";
  form.querySelector("#city").value = user.city || "";
  setTileSelection(form.querySelector('[data-tile-group="experience"]'), user.experience ? [user.experience] : []);
  setTileSelection(form.querySelector('[data-tile-group="plantTypes"]'), user.plantTypes);
  setTileSelection(form.querySelector('[data-tile-group="interests"]'), user.interests);
}

function initProfileForm() {
  const form = document.querySelector("[data-profile-form]");
  if (!form) return;

  form.querySelectorAll("[data-tile-group]").forEach(initTileGroup);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = form.querySelector("#fullName");
    const cityInput = form.querySelector("#city");
    const status = form.querySelector("[data-form-status]");
    const submitBtn = form.querySelector('button[type="submit"]');

    const fullName = nameInput.value.trim();
    if (!fullName) {
      setFieldError(nameInput, t("auth.errName"));
      return;
    }
    setFieldError(nameInput, "");

    // Sent explicitly (including empty arrays) so clearing a preference sticks.
    const experience = selectedValues(form.querySelector('[data-tile-group="experience"]'))[0] || null;
    const plantTypes = selectedValues(form.querySelector('[data-tile-group="plantTypes"]'));
    const interests = selectedValues(form.querySelector('[data-tile-group="interests"]'));

    submitBtn.disabled = true;
    setStatus(status, "loading", t("wizard.saving"));

    try {
      await api.patch("/users/me", {
        fullName,
        city: cityInput.value.trim(),
        experience,
        plantTypes,
        interests,
      });
      // Re-read rather than merging: the API returns snake_case and
      // fetchCurrentUser is what normalises it.
      user = await fetchCurrentUser();
      renderSummary();
      fillProfileForm();
      setStatus(status, "success", t("profile.saved"));
    } catch (err) {
      if (isAuthError(err)) return toLogin();
      setStatus(status, "error", err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function initPasswordForm() {
  const form = document.querySelector("[data-password-form]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const current = form.querySelector("#currentPassword");
    const next = form.querySelector("#newPassword");
    const status = form.querySelector("[data-form-status]");
    const submitBtn = form.querySelector('button[type="submit"]');

    let valid = true;
    if (!current.value) {
      setFieldError(current, t("auth.errPasswordRequired"));
      valid = false;
    } else {
      setFieldError(current, "");
    }
    const passwordIssue = passwordProblem(next.value);
    if (passwordIssue) {
      setFieldError(next, t(passwordIssue));
      valid = false;
    } else {
      setFieldError(next, "");
    }
    if (!valid) return;

    submitBtn.disabled = true;
    setStatus(status, "loading", t("wizard.saving"));

    try {
      await changePassword({ currentPassword: current.value, newPassword: next.value });
      form.reset();
      setStatus(status, "success", t("profile.passwordUpdated"));
    } catch (err) {
      // 401 means the session died; anything else is feedback about the input.
      if (isAuthError(err)) return toLogin();
      setFieldError(current, err instanceof ApiError ? err.message : "");
      setStatus(status, "", "");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

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

async function init() {
  if (!requireAuthOrRedirect("login.html")) return;

  wireLogout();
  initProfileForm();
  initPasswordForm();
  renderSummary();

  try {
    user = await fetchCurrentUser();
  } catch (err) {
    if (isAuthError(err)) return toLogin();
    const host = document.querySelector("[data-profile-summary]");
    if (host) host.innerHTML = `<div class="error-state">${escapeHtml(t("profile.loadError"))}</div>`;
    return;
  }

  renderSummary();
  fillProfileForm();
}

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("greenomy:translated", () => {
  renderSummary();
  fillProfileForm();
});
