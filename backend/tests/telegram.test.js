// tests/telegram.test.js — the Telegram contact bot's public endpoints and the
// parsing behind them.
//
// No test here touches the network: the suite pins TELEGRAM_BOT_TOKEN to empty
// (see helpers), so the API is exercised only up to the point where it would
// call Telegram.
const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./helpers");

let dbDir;
let api;

before(async () => {
  dbDir = h.createTestDatabase();
  api = await h.startServer();
});

after(async () => {
  await api.close();
  // Close PGlite before its directory is removed: otherwise a pending write
  // lands in a deleted folder and surfaces as an unhandled rejection.
  try {
    await require("../config/db").pool.end();
  } catch {
    /* already closed */
  }
  h.cleanup(dbDir);
});

/** The webhook needs a custom header, which the shared helpers do not send. */
async function postWebhook(path, { secretHeader, body = {} } = {}) {
  const response = await fetch(`${api.base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secretHeader ? { "X-Telegram-Bot-Api-Secret-Token": secretHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

const withSecret = async (value, fn) => {
  const saved = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = value;
  try {
    return await fn();
  } finally {
    process.env.TELEGRAM_WEBHOOK_SECRET = saved;
  }
};

describe("telegram contact bot", () => {
  test("with no bot configured, the site is told there is none", async () => {
    const res = await h.get(api.base, "/telegram/info");
    assert.equal(res.status, 200);
    assert.equal(res.body.configured, false);
    assert.equal(res.body.url, null, "the page must not link to a bot that does not exist");
  });

  test("a configured bot link is served without calling Telegram", async () => {
    const saved = process.env.TELEGRAM_BOT_URL;
    process.env.TELEGRAM_BOT_URL = "https://t.me/Greenomy_bot";
    try {
      const res = await h.get(api.base, "/telegram/info");
      assert.equal(res.status, 200);
      assert.equal(res.body.url, "https://t.me/Greenomy_bot");
      assert.equal(res.body.username, "Greenomy_bot");
      assert.equal(
        res.body.configured,
        false,
        "the link is known, but the bot is not connected to the API yet"
      );
    } finally {
      process.env.TELEGRAM_BOT_URL = saved;
    }
  });

  test("the webhook will not run without a configured secret", async () => {
    const res = await postWebhook("/telegram/webhook/anything");
    assert.equal(res.status, 503);
  });

  test("the webhook rejects a wrong secret before anything else", async () => {
    await withSecret("the-real-secret", async () => {
      const wrongPath = await postWebhook("/telegram/webhook/wrong", { secretHeader: "the-real-secret" });
      assert.equal(wrongPath.status, 401);

      const wrongHeader = await postWebhook("/telegram/webhook/the-real-secret", { secretHeader: "wrong" });
      assert.equal(wrongHeader.status, 401);

      const missingHeader = await postWebhook("/telegram/webhook/the-real-secret");
      assert.equal(missingHeader.status, 401, "the header is required too, not just the URL");
    });
  });

  test("with the secret right but no bot token, the webhook says so", async () => {
    await withSecret("the-real-secret", async () => {
      const res = await postWebhook("/telegram/webhook/the-real-secret", { secretHeader: "the-real-secret" });
      assert.equal(res.status, 503);
    });
  });
});

describe("contact message parsing", () => {
  const { readMessage, messageRecord, logMessage, isStart } = require("../services/contact-bot.service");

  test("reads the sender and the text from a Telegram update", () => {
    const message = readMessage({
      update_id: 1,
      message: {
        chat: { id: 42 },
        from: { first_name: "Mayar", last_name: "R" },
        text: "  hello  ",
      },
    });

    assert.equal(message.chatId, 42);
    assert.equal(message.name, "Mayar R");
    assert.equal(message.text, "hello");
  });

  test("falls back to the username when there is no name", () => {
    const message = readMessage({ message: { chat: { id: 7 }, from: { username: "grower" }, text: "hi" } });
    assert.equal(message.name, "@grower");
  });

  test("ignores an update with nothing to act on", () => {
    assert.equal(readMessage({ update_id: 2 }), null);
    assert.equal(readMessage({ message: {} }), null);
    assert.equal(readMessage(null), null);
  });

  test("records who wrote and what they said", () => {
    const record = messageRecord(
      { name: "Mayar", username: "mayar", chatId: 42, text: "Do you ship to Erbil?" },
      "2026-01-01T00:00:00.000Z"
    );

    assert.equal(record.chatId, 42);
    assert.equal(record.name, "Mayar");
    assert.equal(record.username, "mayar");
    assert.equal(record.text, "Do you ship to Erbil?");
    assert.equal(record.at, "2026-01-01T00:00:00.000Z");
  });

  test("an unanswered message is written to the local log — the bot emails nobody", () => {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greenomy-botlog-"));
    const file = path.join(dir, "messages.jsonl");
    const saved = process.env.BOT_MESSAGES_FILE;
    process.env.BOT_MESSAGES_FILE = file;

    try {
      logMessage(messageRecord({ name: "Mayar", chatId: 1, text: "my basil is dying" }));

      const lines = fs.readFileSync(file, "utf8").trim().split("\n");
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]).text, "my basil is dying");
    } finally {
      if (saved === undefined) delete process.env.BOT_MESSAGES_FILE;
      else process.env.BOT_MESSAGES_FILE = saved;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("/start is recognised, and only /start", () => {
    assert.equal(isStart("/start"), true);
    assert.equal(isStart("/start hello"), true);
    assert.equal(isStart("start"), false);
    assert.equal(isStart("/startle"), false);
  });
});

describe("direct answers", () => {
  const bot = require("../services/contact-bot.service");

  test("answers the things the site already documents", () => {
    assert.equal(bot.matchTopic("vision").id, "vision");
    assert.equal(bot.matchTopic("What's your vision?").id, "vision");
    assert.equal(bot.matchTopic("instagram").id, "social");
    assert.equal(bot.matchTopic("social media").id, "social");
    assert.equal(bot.matchTopic("how it works").id, "how");
    assert.equal(bot.matchTopic("رؤيتنا").id, "vision");
    assert.equal(bot.matchTopic("خەڵات").id, "rewards");
    assert.equal(bot.matchTopic("Vision").id, "vision", "a menu label works too");
  });

  test("stays quiet on unrelated or long messages, so a real contact still reaches the team", () => {
    assert.equal(bot.matchTopic("my tomato has yellow leaves"), null);
    assert.equal(bot.matchTopic("I emailed you last week and still got no reply"), null);
    assert.equal(bot.matchTopic(""), null);
    assert.equal(bot.matchTopic(null), null);
  });

  test("a keyword inside a longer word does not fire", () => {
    assert.equal(bot.matchTopic("happy"), null, "'app' must not match inside 'happy'");
  });

  test("answers in the language the sender wrote in", () => {
    assert.equal(bot.detectLanguage("hello"), "en");
    assert.equal(bot.detectLanguage("مرحبا"), "ar");
    assert.equal(bot.detectLanguage("سڵاو"), "ku");

    const vision = bot.matchTopic("رؤيتنا");
    assert.match(bot.textFor(vision.answer, "ar"), /غرينومي/);
  });

  test("the greeting lists what the bot can answer", () => {
    const text = bot.greetingMessage("en");
    assert.match(text, /Welcome to Greenomy/);
    assert.match(text, /Vision/);
    assert.match(text, /Social media/);
  });

  test("'hi' is a greeting, not a message that gets emailed away", () => {
    assert.equal(bot.isGreeting("hi"), true);
    assert.equal(bot.isGreeting("Hello!"), true);
    assert.equal(bot.isGreeting("hi, my plant is dying and I need help"), false);
  });
});

describe("language choice", () => {
  const bot = require("../services/contact-bot.service");

  test("offers one button per configured language", () => {
    const keyboard = bot.languageKeyboard();
    assert.deepEqual(
      keyboard.inline_keyboard.map((row) => row[0].callback_data),
      ["lang:en", "lang:ar", "lang:ku"]
    );
    assert.equal(keyboard.inline_keyboard[0][0].text, "English");
    assert.equal(keyboard.inline_keyboard[1][0].text, "العربية");
  });

  test("reads the language out of a button tap, and ignores anything else", () => {
    assert.equal(bot.languageFromCallback("lang:ar"), "ar");
    assert.equal(bot.languageFromCallback("lang:ku"), "ku");
    assert.equal(bot.languageFromCallback("lang:xx"), null, "an unknown code is ignored");
    assert.equal(bot.languageFromCallback("nonsense"), null);
    assert.equal(bot.languageFromCallback(undefined), null);
  });

  test("/language is the command to change it", () => {
    assert.equal(bot.isLanguageCommand("/language"), true);
    assert.equal(bot.isLanguageCommand("/languages"), false);
  });
});

describe("bot language store", () => {
  const store = require("../services/bot-language.service");
  const os = require("os");
  const fs = require("fs");
  const path = require("path");

  test("remembers a chat's language, and whether it was already asked", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "greenomy-bot-"));
    const saved = process.env.BOT_STATE_FILE;
    process.env.BOT_STATE_FILE = path.join(dir, "state.json");
    store.resetCache();

    try {
      assert.equal(store.get(42), null);
      assert.equal(store.hasPrompted(42), false);

      store.set(42, "ar");
      assert.equal(store.get(42), "ar");

      store.markPrompted(7);
      assert.equal(store.hasPrompted(7), true);
      assert.equal(store.get(7), null, "being prompted is not the same as choosing");

      // A fresh read of the file — as the next run of the bot would do.
      store.resetCache();
      assert.equal(store.get(42), "ar");
      assert.equal(store.hasPrompted(7), true);
    } finally {
      if (saved === undefined) delete process.env.BOT_STATE_FILE;
      else process.env.BOT_STATE_FILE = saved;
      store.resetCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
