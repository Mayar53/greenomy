// navigation.js — header behaviour shared by every page: the mobile menu, the
// active nav link, and the auth-aware account controls.

import { isAuthenticated, fetchCurrentUser, getCurrentUser, logout, clearSession } from "./authservise.js";
import { ApiError } from "./servisapi.js";

function initMobileMenu() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".main-nav");
  if (!toggle || !nav) return;

  const isOpen = () => nav.classList.contains("is-open");
  const setOpen = (open) => {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    // The page behind an open panel stays where it was.
    document.body.style.overflow = open ? "hidden" : "";
  };

  toggle.addEventListener("click", () => setOpen(!isOpen()));

  // Choosing a destination closes the panel.
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) setOpen(false);
  });

  // A tap anywhere off the panel closes it too. The toggle is excluded: its
  // own handler has already decided the new state by the time this runs.
  document.addEventListener("click", (e) => {
    if (!isOpen()) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    setOpen(false);
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
/* There is ONE source of session truth — the token and user that            */
/* authservise.js stores under `greenomy:token` / `greenomy:user`, which the  */
/* API client and every protected page already read. No page keeps its own    */
/* logged-in flag: header controls are marked `data-auth="guest"`,           */
/* `data-auth="user"` or `data-auth="admin"` and are repainted from that      */
/* single session on every load, so the Home page cannot disagree with the    */
/* rest of the app.                                                           */

const STAFF_ROLES = ["admin", "super_admin"];

/** Which header controls this visitor has earned the right to see. `admin` is a
 * stricter `user`: only staff get the dashboard link. */
function authStates() {
  const authenticated = isAuthenticated();
  const user = getCurrentUser();
  const staff = authenticated && Boolean(user) && STAFF_ROLES.includes(user.role);
  return { guest: !authenticated, user: authenticated, admin: staff };
}

function paintAuthState() {
  const states = authStates();
  document.querySelectorAll("[data-auth]").forEach((el) => {
    el.hidden = states[el.getAttribute("data-auth")] !== true;
  });
}

function initAuthHeader() {
  if (!document.querySelector("[data-auth]")) return; // this page has its own header

  // Paint straight from storage first — a page must never look logged out just
  // because the network check has not come back yet.
  paintAuthState();

  // Then confirm with the backend. ONLY an explicit rejection ends the session;
  // a network error, or a missing cached profile, does not.
  if (isAuthenticated()) {
    fetchCurrentUser()
      .then(() => paintAuthState())
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          clearSession();
          paintAuthState();
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
        paintAuthState();
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