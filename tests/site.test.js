// tests/site.test.js — structural integrity for the static frontend.
//
// There is no build step and no framework, so the things that can silently
// break are the ones nothing type-checks: a page linking to a file that was
// renamed, a `data-i18n` key that exists in English but not Arabic, an icon
// name that is not in the sprite, a locale file that drifts from its siblings,
// or an emoji creeping back into the UI. These tests read the real files.
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", ".commandcode", "backend", "docs", "scripts", "tests"]);

const iconsSource = fs.readFileSync(path.join(ROOT, "icons.js"), "utf8");
const ICON_NAMES = new Set(
  [...iconsSource.matchAll(/^ {2}([A-Za-z]+):/gm)].map((match) => match[1])
);

function walk(dir, extensions, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), extensions, out);
    } else if (extensions.includes(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const htmlFiles = walk(ROOT, [".html"]);
const sourceFiles = walk(ROOT, [".html", ".js", ".css", ".json"]);

const LOCALES = {
  en: JSON.parse(fs.readFileSync(path.join(ROOT, "local.json"), "utf8")),
  ar: JSON.parse(fs.readFileSync(path.join(ROOT, "localesar.json"), "utf8")),
  ku: JSON.parse(fs.readFileSync(path.join(ROOT, "localeku.json"), "utf8")),
};

function flattenKeys(obj, prefix = "", out = new Set()) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flattenKeys(value, full, out);
    else out.add(full);
  }
  return out;
}

const localeKeys = Object.fromEntries(
  Object.entries(LOCALES).map(([lang, dict]) => [lang, flattenKeys(dict)])
);

const rel = (file) => path.relative(ROOT, file).replace(/\\/g, "/");

describe("every page links only to files that exist", () => {
  for (const file of htmlFiles) {
    test(rel(file), () => {
      const html = fs.readFileSync(file, "utf8");
      const missing = [];
      for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (/^(https?:)?\/\//.test(ref) || /^(mailto:|tel:|data:|#)/.test(ref) || ref === "") continue;
        const clean = ref.split("?")[0].split("#")[0];
        if (clean === "") continue;
        const target = path.resolve(path.dirname(file), clean);
        if (!fs.existsSync(target)) missing.push(ref);
      }
      assert.deepEqual(missing, [], `broken link(s): ${missing.join(", ")}`);
    });
  }
});

describe("every translation key used in markup exists in all three languages", () => {
  for (const file of htmlFiles) {
    test(rel(file), () => {
      const html = fs.readFileSync(file, "utf8");
      const used = new Set();
      for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(key);
      for (const [, spec] of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
        for (const pair of spec.split(";")) {
          const [, key] = pair.split(":").map((part) => part && part.trim());
          if (key) used.add(key);
        }
      }
      const missing = [];
      for (const key of used) {
        for (const lang of Object.keys(LOCALES)) {
          if (!localeKeys[lang].has(key)) missing.push(`${key} [${lang}]`);
        }
      }
      assert.deepEqual(missing, [], `missing translation(s): ${missing.join(", ")}`);
    });
  }
});

describe("locale files stay in lock-step", () => {
  test("English, Arabic and Kurdish declare the same keys", () => {
    const en = localeKeys.en;
    for (const lang of ["ar", "ku"]) {
      const missingHere = [...en].filter((key) => !localeKeys[lang].has(key));
      const extraThere = [...localeKeys[lang]].filter((key) => !en.has(key));
      assert.deepEqual(missingHere, [], `${lang} is missing: ${missingHere.join(", ")}`);
      assert.deepEqual(extraThere, [], `${lang} has keys English lacks: ${extraThere.join(", ")}`);
    }
  });
});

describe("icon usage", () => {
  test("every data-icon name is in the sprite", () => {
    const unknown = [];
    for (const file of sourceFiles) {
      const text = fs.readFileSync(file, "utf8");
      for (const [, name] of text.matchAll(/data-icon="([^"]+)"/g)) {
        if (!ICON_NAMES.has(name)) unknown.push(`${rel(file)}: ${name}`);
      }
      for (const [, name] of text.matchAll(/iconMarkup\("([^"]+)"/g)) {
        if (!ICON_NAMES.has(name)) unknown.push(`${rel(file)}: ${name}`);
      }
    }
    assert.deepEqual(unknown, [], `unknown icon(s): ${unknown.join(", ")}`);
  });
});

describe("no emoji in the interface", () => {
  test("the UI uses the drawn icon set, not emoji glyphs", () => {
    const emoji =
      /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{2049}\u{203C}\u{2705}\u{274C}\u{2764}\u{2B50}]/u;
    const found = [];
    for (const file of sourceFiles) {
      const text = fs.readFileSync(file, "utf8");
      text.split(/\r?\n/).forEach((line, index) => {
        if (emoji.test(line)) found.push(`${rel(file)}:${index + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    assert.deepEqual(found, [], `emoji found: ${found.join(" | ")}`);
  });
});

describe("the sitemap points at real pages", () => {
  test("every <loc> that names a .html page exists on disk", () => {
    const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
    const missing = [];
    for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const clean = loc.split("?")[0].split("#")[0];
      if (!clean.endsWith(".html")) continue;
      const name = clean.split("/").pop();
      if (!fs.existsSync(path.join(ROOT, name))) missing.push(loc);
    }
    assert.deepEqual(missing, [], `sitemap points at missing page(s): ${missing.join(", ")}`);
  });
});
