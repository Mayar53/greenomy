// main.js — global initialization shared across every page.
// Page-specific logic lives in its own module (green-hub.js, rewards.js, etc.)
// and is imported only on the pages that need it.

import "./navigation.js";
import "./language.js";
import { initIcons } from "./icons.js";
import "./assistant.js";

document.addEventListener("DOMContentLoaded", () => {
  // Icons are inline SVG (see icons.js) — paint the placeholders before anything
  // else so nothing flashes as an empty box.
  initIcons();
});

// Page scripts render content containing icons after their own fetches; this
// catches anything a language switch re-renders.
document.addEventListener("greenomy:translated", () => initIcons());