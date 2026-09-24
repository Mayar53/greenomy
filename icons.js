// icons.js — the icon set, as one inline SVG sprite.
//
// No icon font and no CDN: the symbols are injected once per page and drawn with
// `currentColor`, so an icon inherits the colour of whatever it sits in — sage in
// a card, white on a dark badge. They follow the design language: 24x24, rounded
// stroke, no fills, which matches the rounded cards and the soft palette far
// better than the emoji they replace.
//
// Two ways to use one:
//   HTML   <span class="icon-badge" data-icon="trophy"></span>   (painted on load)
//   JS     `${iconMarkup("trophy")}`                            (inside templates)

const SYMBOLS = {
  // Growing things -------------------------------------------------------
  seed: '<path d="M12 3c3.6 3.4 5.3 6.2 5.3 8.8A5.3 5.3 0 0 1 12 17.2a5.3 5.3 0 0 1-5.3-5.4C6.7 9.2 8.4 6.4 12 3Z"/><path d="M12 17.2V21"/><path d="M9.4 11.8c1.7.6 2.8 1.7 3.4 3.3"/>',
  sprout: '<path d="M12 21v-8"/><path d="M12 13c0-3 1.9-5 4.8-5 0 3-1.9 5-4.8 5Z"/><path d="M12 13c0-3-1.9-5-4.8-5 0 3 1.9 5 4.8 5Z"/>',
  seedling: '<path d="M12 21v-7"/><path d="M5 21h14"/><path d="M12 14c0-2.6 1.8-4.6 4.6-4.6 0 2.6-1.8 4.6-4.6 4.6Z"/><path d="M12 14c0-2.6-1.8-4.6-4.6-4.6 0 2.6 1.8 4.6 4.6 4.6Z"/>',
  leaf: '<path d="M4.5 19.5C4.5 12 9.5 5.5 20 4c0 10.5-6.5 15.5-15.5 15.5Z"/><path d="M4.5 19.5c3.5-5.5 7.5-9 13-11.5"/>',
  herb: '<path d="M12 21V9"/><path d="M12 13.5c2.6 0 4.6-1.6 4.6-4.1-2.6 0-4.6 1.6-4.6 4.1Z"/><path d="M12 9c2.1 0 3.7-1.3 3.7-3.3C13.6 5.7 12 7 12 9Z"/><path d="M12 17.5c-2.6 0-4.6-1.6-4.6-4.1 2.6 0 4.6 1.6 4.6 4.1Z"/><path d="M12 13c-2.1 0-3.7-1.3-3.7-3.3C10.4 9.7 12 11 12 13Z"/>',
  fruit: '<circle cx="12" cy="14" r="6.2"/><path d="M12 7.8V4.5"/><path d="M12 6.4c1.6-2 3.6-2.6 5.2-2.6-.5 2.1-2.1 3.3-5.2 2.6Z"/>',
  root: '<path d="M12 21 9 9h6l-3 12Z"/><path d="M9.4 9h5.2"/><path d="M12 9V6"/><path d="M12 6.4c1.5-1.6 3-1.9 4.5-1.6-.5 1.8-2 2.7-4.5 1.6Z"/><path d="M12 6.4c-1.5-1.6-3-1.9-4.5-1.6.5 1.8 2 2.7 4.5 1.6Z"/>',
  leafy: '<path d="M4 16c0-5 3.6-9 8-9s8 4 8 9c0 2.6-3.6 4-8 4s-8-1.4-8-4Z"/><path d="M12 7v13"/><path d="M7.6 10.8c1.7 1 2.7 2.9 3 5.2"/><path d="M16.4 10.8c-1.7 1-2.7 2.9-3 5.2"/>',
  tree: '<path d="M12 21v-5"/><circle cx="12" cy="10" r="6"/><path d="M8.8 21h6.4"/>',
  pot: '<path d="M7 13h10l-1.1 8H8.1L7 13Z"/><path d="M12 13V8.4"/><path d="M12 10.4c0-2.6 1.8-4.6 4.6-4.6 0 2.6-1.8 4.6-4.6 4.6Z"/><path d="M12 10.4c0-2.6-1.8-4.6-4.6-4.6 0 2.6 1.8 4.6 4.6 4.6Z"/>',

  // Sustainability themes ------------------------------------------------
  recycle: '<path d="M4.4 12.6a7.6 7.6 0 0 1 7.6-7.6 7.6 7.6 0 0 1 6.2 3.3"/><path d="M19.6 11.4a7.6 7.6 0 0 1-7.6 7.6 7.6 7.6 0 0 1-6.2-3.3"/><path d="M19 4.4v4.2h-4.2"/><path d="M5 19.6v-4.2h4.2"/>',
  compost: '<path d="M4.5 12.5h15V17a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-4.5Z"/><path d="M12 12.5c0-3 1.7-5 4.5-5 0 3-1.7 5-4.5 5Z"/><path d="M12 12.5c0-3-1.7-5-4.5-5 0 3 1.7 5 4.5 5Z"/><path d="M8 17h8"/>',
  city: '<path d="M3 21h18"/><path d="M6 21V8h6v13"/><path d="M12 21V4h6v17"/><path d="M8.4 11h1.2M8.4 14.5h1.2M14.4 7.5h1.2M14.4 11h1.2M14.4 14.5h1.2"/>',
  globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.6 2.6 2.6 13.4 0 16-2.6-2.6-2.6-13.4 0-16Z"/>',
  lightbulb: '<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3a6 6 0 0 1 3.5 10.9V16h-7v-2.1A6 6 0 0 1 12 3Z"/>',
  spark: '<path d="M11 3.5 12.6 8 17 9.6 12.6 11.2 11 15.7 9.4 11.2 5 9.6 9.4 8 11 3.5Z"/><path d="M17.6 15.4 18.5 18l2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z"/>',
  book: '<path d="M4 6a3 3 0 0 1 3-3h13v15H7a3 3 0 0 0-3 3V6Z"/><path d="M20 18v4H7"/>',

  // Interface ------------------------------------------------------------
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.6 2.5H4.4L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  camera: '<path d="M4 8.5h3.2L8.8 6h6.4l1.6 2.5H20V19H4V8.5Z"/><circle cx="12" cy="13.5" r="3.4"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4.5v1.4A3.6 3.6 0 0 0 8 11.2"/><path d="M17 6h2.5v1.4A3.6 3.6 0 0 1 16 11.2"/><path d="M12 14v3.5"/><path d="M8.4 21h7.2l-.6-3.5H9l-.6 3.5Z"/>',
  gift: '<path d="M4 11.5h16V20H4v-8.5Z"/><path d="M3.5 8h17v3.5h-17V8Z"/><path d="M12 8v12"/><path d="M12 8c-1.6-3-3.1-4-4.6-3.5S6.6 7.6 8.6 8"/><path d="M12 8c1.6-3 3.1-4 4.6-3.5S17.4 7.6 15.4 8"/>',
  users: '<circle cx="9" cy="8.2" r="3.2"/><path d="M3.6 20a5.4 5.4 0 0 1 10.8 0"/><path d="M16 6.4a3.2 3.2 0 0 1 0 6"/><path d="M17.4 14.6A5.4 5.4 0 0 1 20.4 20"/>',
  user: '<circle cx="12" cy="8.4" r="3.8"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  store: '<path d="M5 10v10h14V10"/><path d="M4 10 5.6 4h12.8L20 10H4Z"/><path d="M9.5 20v-5.5h5V20"/>',
  file: '<path d="M6.5 3H14l4 4v14H6.5V3Z"/><path d="M14 3v4.5h4"/><path d="M9.5 13h5M9.5 17h5"/>',
  chart: '<path d="M4 20h16"/><path d="M7.5 20v-6M12 20V8.5M16.5 20v-9"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8 20 20"/>',
  inbox: '<path d="M4.5 13h3.8l1.4 3h4.6l1.4-3h3.8"/><path d="M6.5 4.5h11L20 13v4.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V13l2.5-8.5Z"/>',
  lock: '<path d="M5 11h14v9.5H5V11Z"/><path d="M8.4 11V7.8a3.6 3.6 0 0 1 7.2 0V11"/>',
  mail: '<path d="M4 6h16v12H4V6Z"/><path d="M4 7.2 12 13l8-5.8"/>',
  close: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevronRight: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  check: '<path d="M5 12.5 9.5 17 19 7"/>',
};

/** The sprite, injected once per page. */
function spriteMarkup() {
  const symbols = Object.entries(SYMBOLS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join("");
  return `<svg id="greenomy-icons" aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden">${symbols}</svg>`;
}

let injected = false;

/** Inline SVG for one icon — for use inside template strings. */
export function iconMarkup(name, className = "icon") {
  const known = SYMBOLS[name] ? name : "leaf";
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#i-${known}"></use></svg>`;
}

/** The icon name for a plant, falling back to something plant-shaped. */
export function plantIcon(plant) {
  if (!plant) return "sprout";
  if (plant.icon && SYMBOLS[plant.icon]) return plant.icon;
  // Legacy rows (and free-text plants) only have a name.
  const name = String(plant.plant_type || plant.name || "").toLowerCase();
  if (/tomato|cucumber|zucchini|pepper|chili|eggplant|aubergine|pumpkin|okra|corn|bean|pea|strawberr/.test(name)) return "fruit";
  if (/basil|mint|parsley|coriander|rosemary|thyme|dill|chives|oregano|sage|lavender|fennel|balm/.test(name)) return "herb";
  if (/lettuce|spinach|cabbage|cauliflower|broccoli|arugula|chard|celery|rocket/.test(name)) return "leafy";
  if (/carrot|radish|beet|turnip|onion|garlic|leek|potato|ginger/.test(name)) return "root";
  if (/tree|lemon|orange|fig|olive|pomegranate|grape|apple|apricot|peach|palm/.test(name)) return "tree";
  if (/pothos|snake|spider|aloe|zz|peace lily|monstera|jade|rubber/.test(name)) return "pot";
  return "sprout";
}

/** Paints every `[data-icon]` placeholder. Safe to call more than once, and
 * after new markup is inserted. */
export function initIcons(root = document) {
  if (!injected) {
    document.body.insertAdjacentHTML("afterbegin", spriteMarkup());
    injected = true;
  }

  root.querySelectorAll("[data-icon]").forEach((element) => {
    const name = element.getAttribute("data-icon");
    if (element.dataset.iconDone === "1") return;
    element.dataset.iconDone = "1";
    element.insertAdjacentHTML("afterbegin", iconMarkup(name, "icon"));
  });
}

export { SYMBOLS };
