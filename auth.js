// auth.js — form logic for login.html, signup.html, forgot-password.html and
// reset-password.html (it detects which form is present on the page).
import {
  signup,
  login,
  isAuthenticated,
  requestPasswordReset,
  resetPassword,
} from "./authservise.js";
import { api, ApiError } from "./servisapi.js";
import { t } from "./language.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Mirrors the server's password rule so the failure is explained before the
 * form is submitted, instead of coming back as a bare 400.
 * Returns an i18n key, or null when the password is acceptable.
 */
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
  const errorEl = wrapper.querySelector(".field-error");
  if (errorEl) errorEl.textContent = message || "";
}

function setStatus(statusEl, mode, message) {
  statusEl.className = `form-status is-${mode}`;
  statusEl.textContent = message;
}

function errorMessage(err) {
  return err instanceof ApiError ? err.message : t("common.errorGeneric");
}

function initPasswordToggles() {
  document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".password-field").querySelector("input");
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.textContent = isHidden ? t("auth.hidePassword") : t("auth.showPassword");
    });
  });
}

function initSignupForm() {
  const form = document.querySelector("[data-signup-form]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullName = form.querySelector("#fullName");
    const email = form.querySelector("#email");
    const password = form.querySelector("#password");
    const city = form.querySelector("#city");
    const status = form.querySelector("[data-form-status]");
    const submitBtn = form.querySelector('button[type="submit"]');

    let valid = true;
    if (!fullName.value.trim()) { setFieldError(fullName, t("auth.errName")); valid = false; }
    else setFieldError(fullName, "");

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email.value.trim())) { setFieldError(email, t("auth.errEmail")); valid = false; }
    else setFieldError(email, "");

    const passwordIssue = passwordProblem(password.value);
    if (passwordIssue) { setFieldError(password, t(passwordIssue)); valid = false; }
    else setFieldError(password, "");

    const confirm = form.querySelector("#confirmPassword");
    if (confirm) {
      if (confirm.value !== password.value) {
        setFieldError(confirm, t("auth.errPasswordMismatch"));
        valid = false;
      } else {
        setFieldError(confirm, "");
      }
    }

    if (!valid) return;

    submitBtn.disabled = true;
    setStatus(status, "loading", t("auth.creating"));

    try {
      await signup({
        fullName: fullName.value.trim(),
        email: email.value.trim(),
        password: password.value,
        city: city ? city.value.trim() : undefined,
      });
      setStatus(status, "success", t("auth.created"));
      window.location.href = "onboarding.html";
    } catch (err) {
      setStatus(status, "error", errorMessage(err));
      submitBtn.disabled = false;
    }
  });
}

function initLoginForm() {
  const form = document.querySelector("[data-login-form]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.querySelector("#email");
    const password = form.querySelector("#password");
    const rememberInput = form.querySelector('input[name="remember"]');
    const status = form.querySelector("[data-form-status]");
    const submitBtn = form.querySelector('button[type="submit"]');

    let valid = true;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email.value.trim())) { setFieldError(email, t("auth.errEmail")); valid = false; }
    else setFieldError(email, "");
    if (!password.value) { setFieldError(password, t("auth.errPasswordRequired")); valid = false; }
    else setFieldError(password, "");

    if (!valid) return;

    submitBtn.disabled = true;
    setStatus(status, "loading", t("auth.loggingIn"));

    try {
      await login({
        email: email.value.trim(),
        password: password.value,
        remember: rememberInput ? rememberInput.checked : true,
      });
      setStatus(status, "success", t("auth.welcome"));
      window.location.href = "wallet.html";
    } catch (err) {
      setStatus(status, "error", errorMessage(err));
      submitBtn.disabled = false;
    }
  });
}

/**
 * Where no mail provider is configured the API keeps a development outbox, so
 * the reset link can still be followed locally. Silent when unavailable.
 */
async function revealDevMailLink(email) {
  const box = document.querySelector("[data-dev-mail]");
  const link = document.querySelector("[data-dev-mail-link]");
  if (!box || !link) return;

  try {
    const data = await api.get("/dev/mail", { auth: false });
    const message = (data.messages || []).find((m) => m.to === email);
    const match = message && String(message.text).match(/https?:\/\/\S*reset-password\.html\?token=[a-f0-9]+/);
    if (!match) return;
    link.href = match[0];
    box.hidden = false;
  } catch {
    // The outbox is development-only; in production there is nothing to show.
  }
}

function initForgotForm() {
  const form = document.querySelector("[data-forgot-form]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.querySelector("#email");
    const status = form.querySelector("[data-form-status]");
    const submitBtn = form.querySelector('button[type="submit"]');
    const address = email.value.trim();

    if (!EMAIL_PATTERN.test(address)) {
      setFieldError(email, t("auth.errEmail"));
      return;
    }
    setFieldError(email, "");

    submitBtn.disabled = true;
    setStatus(status, "loading", t("contact.sending"));

    try {
      await requestPasswordReset(address);
      // The response is deliberately generic — it never confirms whether the
      // address has an account.
      setStatus(status, "success", t("auth.resetSent"));
      await revealDevMailLink(address);
    } catch (err) {
      setStatus(status, "error", errorMessage(err));
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function initResetForm() {
  const form = document.querySelector("[data-reset-form]");
  if (!form) return;

  const token = new URLSearchParams(window.location.search).get("token");
  const status = form.querySelector("[data-form-status]");

  if (!token) {
    setStatus(status, "error", t("auth.resetInvalid"));
    form.querySelectorAll("input, button").forEach((el) => {
      el.disabled = true;
    });
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = form.querySelector("#newPassword");
    const confirm = form.querySelector("#confirmPassword");
    let valid = true;

    const passwordIssue = passwordProblem(password.value);
    if (passwordIssue) {
      setFieldError(password, t(passwordIssue));
      valid = false;
    } else {
      setFieldError(password, "");
    }

    if (confirm.value !== password.value) {
      setFieldError(confirm, t("auth.errPasswordMismatch"));
      valid = false;
    } else {
      setFieldError(confirm, "");
    }

    if (!valid) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    setStatus(status, "loading", t("common.loading"));

    try {
      await resetPassword({ token, newPassword: password.value });
      setStatus(status, "success", t("auth.resetDone"));
      form.hidden = true;
      const done = document.querySelector("[data-reset-done]");
      if (done) done.hidden = false;
    } catch (err) {
      setStatus(status, "error", errorMessage(err));
      submitBtn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // If already logged in, skip straight past the auth forms.
  if (isAuthenticated() && document.querySelector("[data-login-form], [data-signup-form]")) {
    window.location.href = "wallet.html";
    return;
  }
  initPasswordToggles();
  initSignupForm();
  initLoginForm();
  initForgotForm();
  initResetForm();
});
