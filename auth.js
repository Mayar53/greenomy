// auth.js — login & signup form logic (this file only runs on login.html /
// signup.html; it detects which form is present on the page).
import { signup, login, isAuthenticated } from "./authservise.js";
import { ApiError } from "./servisapi.js";
import { t } from "./language.js";

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

    if (password.value.length < 8) { setFieldError(password, t("auth.errPasswordShort")); valid = false; }
    else setFieldError(password, "");

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
      window.location.href = "index.html";
    } catch (err) {
      setStatus(status, "error", errorMessage(err));
      submitBtn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // If already logged in, skip straight past the auth forms.
  if (isAuthenticated() && document.querySelector("[data-login-form], [data-signup-form]")) {
    window.location.href = "index.html";
    return;
  }
  initPasswordToggles();
  initSignupForm();
  initLoginForm();
});
