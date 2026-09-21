// auth.js — login & signup form logic (this file only runs on login.html /
// signup.html; it detects which form is present on the page).
import { signup, login, isAuthenticated } from "./authservise.js";
import { ApiError } from "./servisapi.js";

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

function initPasswordToggles() {
  document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = btn.closest(".password-field").querySelector("input");
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      btn.textContent = isHidden ? "Hide" : "Show";
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
    if (!fullName.value.trim()) { setFieldError(fullName, "Please enter your name."); valid = false; }
    else setFieldError(fullName, "");

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email.value.trim())) { setFieldError(email, "Please enter a valid email."); valid = false; }
    else setFieldError(email, "");

    if (password.value.length < 8) { setFieldError(password, "Password must be at least 8 characters."); valid = false; }
    else setFieldError(password, "");

    if (!valid) return;

    submitBtn.disabled = true;
    setStatus(status, "loading", "Creating your account...");

    try {
      await signup({
        fullName: fullName.value.trim(),
        email: email.value.trim(),
        password: password.value,
        city: city ? city.value.trim() : undefined,
      });
      setStatus(status, "success", "Account created! Redirecting...");
      window.location.href = "onboarding.html";
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      setStatus(status, "error", message);
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
    const status = form.querySelector("[data-form-status]");
    const submitBtn = form.querySelector('button[type="submit"]');

    let valid = true;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email.value.trim())) { setFieldError(email, "Please enter a valid email."); valid = false; }
    else setFieldError(email, "");
    if (!password.value) { setFieldError(password, "Please enter your password."); valid = false; }
    else setFieldError(password, "");

    if (!valid) return;

    submitBtn.disabled = true;
    setStatus(status, "loading", "Logging in...");

    try {
      await login({ email: email.value.trim(), password: password.value });
      setStatus(status, "success", "Welcome back! Redirecting...");
      window.location.href = "index.html";
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
      setStatus(status, "error", message);
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