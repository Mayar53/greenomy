// main.js — global initialization shared across every page.
// Page-specific logic lives in its own module (green-hub.js, rewards.js, etc.)
// and is imported only on the pages that need it.

import "./navigation.js";
import "./language.js";

document.addEventListener("DOMContentLoaded", () => {
  // Footer year, if present.
  const yearEl = document.querySelector("[data-current-year]");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});