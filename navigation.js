// navigation.js — header behaviour shared by every page: the mobile menu, the
// active nav link, and the auth-aware account controls.

import { isAuthenticated, fetchCurrentUser, logout, clearSession } from "./authservise.js";
import { ApiError } from "./servisapi.js";

function initMobileMenu() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".main-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    document.body.style.overflow = isOpen ? "hidden" : "";
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    });
  });

  // Close on escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nav.classList.contains("is-open")) {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }
  });
}

function markActiveLink() {
  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".main-nav a[href]").forEach((link) => {
    const linkPath = link.getAttribute("href").split("/").pop();
    if (linkPath === currentPath) {
      link.setAttribute("aria-current", "page");
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Auth-aware header                                                       */
/*                                                                        */
/* There is ONE source of session truth — the token and user that          */
/* authservise.js stores under `greenomy:token` / `greenomy:user`, which   */
/* the API client and every protected page already read. No page keeps its */
/* own logged-in flag: header controls are marked `data-auth="guest"` or   */
/* `data-auth="user"` and are repainted from that single session on every  */
/* load, so the Home page cannot disagree with the rest of the app.        */
/* ---------------------------------------------------------------------- */

function paintAuthState(authenticated) {
  document.querySelectorAll("[data-auth]").forEach((el) => {
    el.hidden = el.getAttribute("data-auth") !== (authenticated ? "user" : "guest");
  });
}

function initAuthHeader() {
  if (!document.querySelector("[data-auth]")) return; // this page has its own header

  // Paint straight from storage first — a page must never look logged out just
  // because the network check has not come back yet.
  paintAuthState(isAuthenticated());

  // Then confirm with the backend. ONLY an explicit rejection ends the session;
  // a network error, or a missing cached profile, does not.
  if (isAuthenticated()) {
    fetchCurrentUser()
      .then(() => paintAuthState(true))
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          paintAuthState(false);
        }
      });
  }

  // Logout is the only action that intentionally clears the session.
  document.querySelectorAll("[data-auth-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await logout();
      } finally {
        paintAuthState(false);
        window.location.href = "index.html";
      }
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initMobileMenu();
  markActiveLink();
  initAuthHeader();
});