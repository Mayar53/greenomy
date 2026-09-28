// services/bot-language.service.js — what each Telegram chat chose.
//
// A small JSON file beside the backend, because the bot runs as its own process
// and cannot share the app's single-connection database. Losing it is harmless:
// the bot simply asks again.
const fs = require("fs");
const path = require("path");

const STORE_FILE = () =>
  process.env.BOT_STATE_FILE || path.join(__dirname, "../.bot-state.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE(), "utf8"));
    cache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // No file yet, or unreadable — start empty rather than fail the bot.
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.writeFileSync(STORE_FILE(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn(`Could not save the bot's language choices: ${err.message}`);
  }
}

const entry = (chatId) => load()[String(chatId)] || {};

/** The language this chat picked, or null if it has not chosen yet. */
function get(chatId) {
  const language = entry(chatId).language;
  return typeof language === "string" ? language : null;
}

function set(chatId, language) {
  const key = String(chatId);
  load()[key] = { ...load()[key], language, updatedAt: new Date().toISOString() };
  save();
  return language;
}

/** True once the language question has been put to this chat, so a member who
 * ignores the buttons is not stuck in a loop and still gets a reply. */
function hasPrompted(chatId) {
  return Boolean(entry(chatId).promptedAt);
}

function markPrompted(chatId) {
  const key = String(chatId);
  if (!load()[key]) load()[key] = {};
  load()[key].promptedAt = new Date().toISOString();
  save();
}

/** Test helper: forget the cached copy so the file is re-read. */
function resetCache() {
  cache = null;
}

module.exports = { get, set, hasPrompted, markPrompted, resetCache, STORE_FILE };
