// portal.js — controller for partner.html (redemption-code validation).
// The admin dashboard lives in admin.js; this module only handles the
// partner-facing page.
import { isAuthenticated, logout } from "./authservise.js";
import { api, ApiError } from "./servisapi.js";
import { t, localized } from "./language.js";

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function toLogin() {
  window.location.href = "login.html";
}

function partnerError(err) {
  if (!(err instanceof ApiError)) return t("partner.errGeneric");
  if (err.status === 404) return t("partner.errInvalid");
  if (err.status === 409) return t("partner.errUsed");
  if (err.status === 410) return t("partner.errExpired");
  return t("partner.errGeneric");
}

function renderPartnerResult(host, data) {
  const reward = data.reward || {};
  const title = localized({ title: reward.title, i18n: reward.i18n }, "title");
  host.innerHTML = `
    <ul class="redeem-summary">
      <li><span>${escapeHtml(t("partner.successReward"))}</span><strong>${escapeHtml(title || "—")}</strong></li>
      <li><span>${escapeHtml(t("partner.successPartner"))}</span><strong>${escapeHtml(reward.partner || "—")}</strong></li>
      <li><span>${escapeHtml(t("partner.successPoints"))}</span><strong>${Number((data.redemption && data.redemption.points_spent) || 0).toLocaleString()}</strong></li>
    </ul>
  `;
}

function gatePartnerForm() {
  const form = document.querySelector("[data-redeem-validate]");
  const gate = document.querySelector("[data-partner-gate]");
  if (!form || !gate) return;

  if (isAuthenticated()) {
    form.hidden = false;
    gate.hidden = true;
    gate.innerHTML = "";
    return;
  }
  form.hidden = true;
  gate.hidden = false;
  gate.innerHTML = `<a href="login.html" class="btn btn-secondary btn-block">${escapeHtml(t("nav.login"))}</a>`;
}

function initPartnerPage() {
  const form = document.querySelector("[data-redeem-validate]");
  if (!form) return;
  gatePartnerForm();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = form.querySelector("[data-form-status]");
    const result = document.querySelector("[data-partner-result]");
    const input = form.querySelector("#redeemToken");
    const submitBtn = form.querySelector('button[type="submit"]');
    const token = input.value.trim();

    result.innerHTML = "";

    if (!token) {
      status.className = "form-status is-error";
      status.textContent = t("partner.errEmpty");
      return;
    }

    submitBtn.disabled = true;
    status.className = "form-status is-loading";
    status.textContent = t("partner.validating");

    try {
      const data = await api.post("/rewards/validate", { token });
      status.className = "form-status is-success";
      status.textContent = t("partner.successTitle");
      input.value = "";
      renderPartnerResult(result, data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      status.className = "form-status is-error";
      status.textContent = partnerError(err);
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

document.addEventListener("DOMContentLoaded", () => {
  wireLogout();
  if (document.querySelector("[data-redeem-validate]")) initPartnerPage();
});

document.addEventListener("greenomy:translated", gatePartnerForm);
