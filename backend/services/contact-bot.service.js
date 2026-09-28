// services/contact-bot.service.js — what the contact bot says and does.
//
// The bot answers in Telegram and nowhere else: a message is never emailed to
// the team, so the reply in the chat IS the outcome. Anything the bot cannot
// answer is written to a local log (services note below) so it can still be read
// back, and the sender is pointed at the email address for a human reply.
//
// Every decision here is a pure function — the language, the topic match, the
// record — so the behaviour can be tested without touching the network.
const fs = require("fs");
const path = require("path");
const {
  sendMessage,
  answerCallbackQuery,
  editMessageReplyMarkup,
} = require("./telegram.service");
const botLanguage = require("./bot-language.service");

const config = require(path.join(__dirname, "../../bot.json"));

const messagesFile = () =>
  process.env.BOT_MESSAGES_FILE || path.join(__dirname, "../.bot-messages.jsonl");

/* ------------------------------------------------------------- language -- */
// Kurdish-specific letters, so a Kurdish message is not mistaken for Arabic.
const KURDISH_LETTERS = /[ێۆڕڵگچپژڤ]/;
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** Which language to answer in: the one the sender wrote in, else English. */
function detectLanguage(text) {
  const value = String(text || "");
  if (KURDISH_LETTERS.test(value)) return "ku";
  if (ARABIC_SCRIPT.test(value)) return "ar";
  return "en";
}

/** The configured text for a language, falling back to English. */
function textFor(record, language) {
  if (!record) return "";
  return record[language] || record.en || "";
}

/* ---------------------------------------------------------------- match -- */
/** Lower-case and strip punctuation, so "Vision?" and "vision" are the same. */
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[!?.,;:()[\]{}"'’«»،؛؟]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the message mentions the keyword. Latin keywords match whole words
 * (so "app" does not fire inside "happy"); other scripts match anywhere. */
function mentions(normalized, keyword) {
  const needle = normalize(keyword);
  if (!needle) return false;
  if (/^[a-z0-9 ]+$/.test(needle)) {
    return new RegExp(`(^|\\s)${escapeRegExp(needle)}(\\s|$)`).test(normalized);
  }
  return normalized.includes(needle);
}

/** True when the message is short enough to be a question the bot can answer.
 * A longer message is treated as a real contact and goes to the team — that is
 * what stops "I emailed you last week and got no reply" being answered with the
 * contact blurb and never reaching a human. */
function isShortQuestion(normalized, maxWords) {
  return normalized.split(" ").filter(Boolean).length <= maxWords;
}

/** The topic a message is asking about, or null. A menu label ("Vision") counts
 * as a keyword too, so the listed topics are tappable. */
function matchTopic(text) {
  const normalized = normalize(text);
  if (!normalized || !isShortQuestion(normalized, config.maxQuestionWords || 5)) return null;

  for (const topic of config.topics || []) {
    const keywords = [...(topic.keywords || []), ...Object.values(topic.label || {})];
    if (keywords.some((keyword) => mentions(normalized, keyword))) return topic;
  }
  return null;
}

const isGreeting = (text) => {
  const normalized = normalize(text);
  if (!normalized || !isShortQuestion(normalized, 3)) return false;
  return (config.greetings || []).some((word) => mentions(normalized, word));
};

const isStart = (text) => /^\/(start|help)\b/.test(String(text || "").trim());
const isLanguageCommand = (text) => /^\/language\b/.test(String(text || "").trim());

/* ---------------------------------------------------------- language pick -- */
/** The three language buttons, as an inline keyboard. */
function languageKeyboard() {
  return {
    inline_keyboard: (config.languages || []).map((language) => [
      { text: language.label, callback_data: `lang:${language.code}` },
    ]),
  };
}

/** The language code behind a button tap, or null for anything else. */
function languageFromCallback(data) {
  const match = String(data || "").match(/^lang:([a-z]{2})$/);
  if (!match) return null;
  const codes = (config.languages || []).map((language) => language.code);
  return codes.includes(match[1]) ? match[1] : null;
}

/** The welcome plus the list of things the bot answers directly. */
function greetingMessage(language) {
  const labels = (config.topics || [])
    .map((topic) => `• ${textFor(topic.label, language)}`)
    .join("\n");
  return `${textFor(config.greeting, language)}\n\n${labels}`;
}

/* --------------------------------------------------------------- record --- */
/** Everything worth keeping about one message. Pure. */
function messageRecord({ name, username, chatId, text }, at = new Date().toISOString()) {
  return { at, chatId, name, username: username || null, text };
}

/**
 * Appends an unanswered message to a local log.
 *
 * This is a RECORD, not a queue: the bot does not email and nothing is pushed to
 * anyone, so the file is the only trace of a message the bot could not answer.
 * It exists so those messages can be read back (and used to improve the topics)
 * instead of vanishing.
 */
function logMessage(record) {
  try {
    fs.appendFileSync(messagesFile(), `${JSON.stringify(record)}\n`);
  } catch (err) {
    console.warn(`Could not log a bot message: ${err.message}`);
  }
}
/** Everything the handler needs from one Telegram update, or null when the
 * update carries no message we can act on. Pure. */
function readMessage(update) {
  const message = update && (update.message || update.edited_message);
  if (!message || !message.chat) return null;

  const from = message.from || {};
  const name =
    [from.first_name, from.last_name].filter(Boolean).join(" ") ||
    (from.username ? `@${from.username}` : "") ||
    message.chat.title ||
    "Unknown";

  return {
    chatId: message.chat.id,
    name,
    username: from.username || null,
    text: typeof message.text === "string" ? message.text.trim() : "",
  };
}

/* -------------------------------------------------------------- handler -- */
/** A tap on one of the language buttons: remember it, take the buttons away and
 * greet the sender in the language they picked. */
async function handleLanguageChoice(callbackQuery) {
  const chatId = callbackQuery.message && callbackQuery.message.chat ? callbackQuery.message.chat.id : null;
  const language = languageFromCallback(callbackQuery.data);

  try {
    if (!chatId || !language) {
      await answerCallbackQuery(callbackQuery.id);
      return { handled: true, kind: "language-ignored" };
    }

    botLanguage.set(chatId, language);
    // Remove the buttons so the prompt cannot be tapped twice.
    await editMessageReplyMarkup(chatId, callbackQuery.message.message_id).catch(() => {});
    await answerCallbackQuery(callbackQuery.id);
    await sendMessage(chatId, greetingMessage(language));
    return { handled: true, kind: `language:${language}` };
  } catch (err) {
    console.warn(`Telegram language choice failed: ${err.message}`);
    return { handled: false, error: err.message };
  }
}

/**
 * Handles one update: asks for a language once, answers what it knows, forwards
 * the rest, and never throws — a failure here must not make Telegram retry the
 * same update.
 */
async function handleUpdate(update) {
  // A button tap arrives as its own update type, not as a message.
  if (update && update.callback_query) return handleLanguageChoice(update.callback_query);

  const message = readMessage(update);
  if (!message) return { handled: false };

  const chosen = botLanguage.get(message.chatId);
  const language = chosen || detectLanguage(message.text);

  try {
    // First contact: ask which language to speak before anything else.
    if (!chosen) {
      if (isLanguageCommand(message.text) || !botLanguage.hasPrompted(message.chatId)) {
        botLanguage.markPrompted(message.chatId);
        await sendMessage(message.chatId, config.languagePrompt, { reply_markup: languageKeyboard() });
        return { handled: true, kind: "language-prompt" };
      }
      // Asked once already and no answer: carry on in the detected language
      // rather than trapping the sender in the prompt.
    }

    if (isLanguageCommand(message.text)) {
      await sendMessage(message.chatId, config.languagePrompt, { reply_markup: languageKeyboard() });
      return { handled: true, kind: "language-prompt" };
    }

    if (isStart(message.text) || isGreeting(message.text)) {
      await sendMessage(message.chatId, greetingMessage(language));
      return { handled: true, kind: "greeting" };
    }

    if (!message.text) {
      await sendMessage(message.chatId, textFor(config.fallback, language));
      return { handled: true, kind: "unsupported" };
    }

    // Anything the bot already knows is answered on the spot — no email, no
    // waiting for a human.
    const topic = matchTopic(message.text);
    if (topic) {
      await sendMessage(message.chatId, textFor(topic.answer, language));
      return { handled: true, kind: `faq:${topic.id}` };
    }

    // Reach here only when the bot has no answer. No email is sent — the chat
    // is the whole channel — so the message is recorded for reading back, and
    // the sender is pointed at the address for a human reply.
    logMessage(messageRecord(message));
    await sendMessage(message.chatId, textFor(config.unknownReply, language));
    return { handled: true, kind: "unanswered" };
  } catch (err) {
    console.warn(`Telegram contact handling failed: ${err.message}`);
    return { handled: false, error: err.message };
  }
}

module.exports = {
  handleUpdate,
  handleLanguageChoice,
  readMessage,
  messageRecord,
  logMessage,
  detectLanguage,
  matchTopic,
  greetingMessage,
  languageKeyboard,
  languageFromCallback,
  textFor,
  normalize,
  isGreeting,
  isStart,
  isLanguageCommand,
};
