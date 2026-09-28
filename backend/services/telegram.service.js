// services/telegram.service.js — the thin side of the Telegram Bot API.
//
// Only wraps the HTTP API over fetch, so there is no SDK to keep in sync and no
// extra dependency. Same shape as the other providers: the app asks for what it
// wants and never touches the vendor's payload shape.
const fs = require("fs");
const path = require("path");
const API_ROOT = "https://api.telegram.org";

// The bot needs to see button taps (callback_query) as well as messages.
const ALLOWED_UPDATES = ["message", "callback_query"];

const botToken = () => String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

/** True when a bot token is configured. Without one the bot is simply off. */
function configured() {
  return Boolean(botToken());
}

function fail(method, response, body) {
  const detail = (body && (body.description || body.error_code)) || response.status;
  return new Error(`Telegram ${method} failed: ${detail}`);
}

/**
 * Calls one Bot API method. Throws with the API's own description on failure, so
 * a bad token reports "Unauthorized" instead of a bare "fetch failed".
 */
async function call(method, payload = {}) {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const response = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok !== true) throw fail(method, response, body);
  return body.result;
}

/**
 * Calls a method that uploads a file. Telegram's convention is to name the part
 * in the field (`attach://avatar`) and send the file under that name, so the
 * profile photo travels inside `photo` rather than as a loose form field.
 */
async function callWithFile(method, fields, fileField, filePath) {
  const token = botToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  form.append(
    fileField,
    new Blob([fs.readFileSync(filePath)], { type: "image/png" }),
    path.basename(filePath)
  );

  const response = await fetch(`${API_ROOT}/bot${token}/${method}`, { method: "POST", body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok !== true) throw fail(method, response, body);
  return body.result;
}

/* --------------------------------------------------------------- messages -- */
const sendMessage = (chatId, text, options = {}) =>
  call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...options });

/** Dismisses the spinner on a button tap. */
const answerCallbackQuery = (callbackQueryId, text) =>
  call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });

/** Replaces a message's buttons — used to take them away once one is tapped. */
const editMessageReplyMarkup = (chatId, messageId) =>
  call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });

/* ---------------------------------------------------------------- updates -- */
const getUpdates = (offset, timeoutSeconds = 30) =>
  call("getUpdates", { offset, timeout: timeoutSeconds, allowed_updates: ALLOWED_UPDATES });

const setWebhook = (url, secretToken) =>
  call("setWebhook", { url, secret_token: secretToken, allowed_updates: ALLOWED_UPDATES });

const deleteWebhook = () => call("deleteWebhook", {});

const getMe = () => call("getMe");

/* ---------------------------------------------------------------- profile -- */
const getMyName = (languageCode) => call("getMyName", languageCode ? { language_code: languageCode } : {});
const setMyName = (name, languageCode) =>
  call("setMyName", { name, ...(languageCode ? { language_code: languageCode } : {}) });

const getMyShortDescription = (languageCode) =>
  call("getMyShortDescription", languageCode ? { language_code: languageCode } : {});
const setMyShortDescription = (shortDescription, languageCode) =>
  call("setMyShortDescription", {
    short_description: shortDescription,
    ...(languageCode ? { language_code: languageCode } : {}),
  });

const getMyDescription = (languageCode) =>
  call("getMyDescription", languageCode ? { language_code: languageCode } : {});
const setMyDescription = (description, languageCode) =>
  call("setMyDescription", { description, ...(languageCode ? { language_code: languageCode } : {}) });

const setMyCommands = (commands, languageCode) =>
  call("setMyCommands", { commands, ...(languageCode ? { language_code: languageCode } : {}) });

/** Accepts the structured form the current Bot API expects; falls back to the
 * bare attach token on older deployments. */
const setMyProfilePhoto = async (filePath) => {
  try {
    return await callWithFile(
      "setMyProfilePhoto",
      { photo: { type: "static", photo: "attach://avatar" } },
      "avatar",
      filePath
    );
  } catch (err) {
    if (!/photo/i.test(err.message)) throw err;
    return callWithFile("setMyProfilePhoto", { photo: "attach://avatar" }, "avatar", filePath);
  }
};

module.exports = {
  configured,
  call,
  callWithFile,
  sendMessage,
  answerCallbackQuery,
  editMessageReplyMarkup,
  getUpdates,
  setWebhook,
  deleteWebhook,
  getMe,
  getMyName,
  setMyName,
  getMyShortDescription,
  setMyShortDescription,
  getMyDescription,
  setMyDescription,
  setMyCommands,
  setMyProfilePhoto,
  ALLOWED_UPDATES,
};
