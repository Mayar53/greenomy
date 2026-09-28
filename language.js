// language.js — i18n loader, RTL/LTR switching, persistence
// Usage: add `data-i18n="path.to.key"` to any element's text content,
// or `data-i18n-attr="placeholder:path.to.key"` for attributes.

const STORAGE_KEY = "greenomy:lang";
const SUPPORTED = ["en", "ar", "ku"];
const DEFAULT_LANG = "en";
const LOCALE_FILES = { en: "local.json", ar: "localesar.json", ku: "localeku.json" };
const RTL_LANGS = ["ar", "ku"];

let dictionary = {};

function getStoredLang() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return SUPPORTED.includes(stored) ? stored : DEFAULT_LANG;
}

function resolveKey(path) {
  return path.split(".").reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), dictionary);
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const value = resolveKey(el.getAttribute("data-i18n"));
    if (typeof value === "string") el.textContent = value;
  });

  document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    el.getAttribute("data-i18n-attr")
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const [attr, path] = pair.split(":").map((s) => s.trim());
        const value = resolveKey(path);
        if (attr && typeof value === "string") el.setAttribute(attr, value);
      });
  });

  document.dispatchEvent(new CustomEvent("greenomy:translated"));
}

async function loadDictionary(lang) {
  try {
    const res = await fetch(LOCALE_FILES[lang]);
    if (!res.ok) throw new Error("locale fetch failed");
    dictionary = await res.json();
  } catch (err) {
    console.error("Greenomy: failed to load locale", lang, err);
    dictionary = {};
  }
}

/** Language and reading direction are two different things here.
 *
 * Arabic and Kurdish are read right to left, but the *interface* is laid out
 * the same way in every language: the document keeps `dir="ltr"` so the
 * header, hero, grids, cards and footer stay put instead of mirroring, and
 * only the text of an RTL language is turned around. `data-text-dir` is that
 * signal — the stylesheet applies it at the text level and nowhere else. */
function setDocumentDirection(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = "ltr";
  document.documentElement.dataset.textDir = RTL_LANGS.includes(lang) ? "rtl" : "ltr";
}

function updateSwitchUI(lang) {
  document.querySelectorAll("[data-lang-option]").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.getAttribute("data-lang-option") === lang));
  });
}

export async function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) lang = DEFAULT_LANG;
  localStorage.setItem(STORAGE_KEY, lang);
  setDocumentDirection(lang);
  await loadDictionary(lang);
  applyTranslations();
  updateSwitchUI(lang);
}

export function t(path) {
  const value = resolveKey(path);
  return typeof value === "string" ? value : path;
}

/** The localized label for a growth stage, falling back to the record's English
 * label. `journey.stages.<key>` is the namespace every stage shares, so this is
 * defined once here rather than re-implemented by each page that shows one. */
export function stageLabel(milestone) {
  if (!milestone) return "";
  const key = `journey.stages.${milestone.stage_key}`;
  const translated = t(key);
  return translated === key ? milestone.label_en : translated;
}

/** Returns the active language's value for a data record field, falling back
 * to the record's base (English) field. Records may carry:
 *   { title, description, ..., i18n: { ar: { title, description, body } } } */
export function localized(record, field) {
  if (!record) return undefined;
  const lang = getStoredLang();
  const translated = record.i18n && record.i18n[lang] && record.i18n[lang][field];
  return translated !== undefined ? translated : record[field];
}

export function currentLanguage() {
  return getStoredLang();
}

export async function initLanguage() {
  const lang = getStoredLang();
  await setLanguage(lang);

  document.querySelectorAll("[data-lang-option]").forEach((btn) => {
    btn.addEventListener("click", () => setLanguage(btn.getAttribute("data-lang-option")));
  });
}

document.addEventListener("DOMContentLoaded", initLanguage);