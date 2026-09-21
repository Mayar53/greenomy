// contact.js — waitlist form: validation, submission, and loading/success/error states
import { joinWaitlist } from "./waitlist.js";
import { t } from "./language.js";

function setFieldError(field, message) {
  const wrapper = field.closest(".form-field");
  wrapper.classList.toggle("has-error", Boolean(message));
  const errorEl = wrapper.querySelector(".field-error");
  if (errorEl) errorEl.textContent = message || "";
}

function validate(form) {
  let valid = true;

  const fullName = form.querySelector("#fullName");
  if (!fullName.value.trim()) {
    setFieldError(fullName, "Please enter your full name.");
    valid = false;
  } else {
    setFieldError(fullName, "");
  }

  const email = form.querySelector("#email");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email.value.trim())) {
    setFieldError(email, "Please enter a valid email address.");
    valid = false;
  } else {
    setFieldError(email, "");
  }

  const city = form.querySelector("#city");
  if (!city.value.trim()) {
    setFieldError(city, "Please enter your city.");
    valid = false;
  } else {
    setFieldError(city, "");
  }

  return valid;
}

function initWaitlistForm() {
  const form = document.querySelector("[data-waitlist-form]");
  if (!form) return;

  const status = form.querySelector("[data-form-status]");
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validate(form)) return;

    status.className = "form-status is-loading";
    status.textContent = t("contact.sending");
    submitBtn.disabled = true;

    try {
      await joinWaitlist({
        fullName: form.querySelector("#fullName").value.trim(),
        email: form.querySelector("#email").value.trim(),
        city: form.querySelector("#city").value.trim(),
        gardeningInterests: form.querySelector("#interests").value.trim(),
      });
      status.className = "form-status is-success";
      status.textContent = t("contact.success");
      form.reset();
    } catch (err) {
      status.className = "form-status is-error";
      status.textContent = err.message || t("contact.error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", initWaitlistForm);