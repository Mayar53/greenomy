// jobs/telegram.js — run the contact bot.
//
// A webhook needs a public HTTPS URL, which local development does not have, so
// the default mode long-polls instead and works on localhost:
//
//   npm run telegram                                  poll for messages
//   npm run telegram -- webhook https://your.site     register the webhook
//   npm run telegram -- clear-webhook                 stop using the webhook
//   npm run telegram -- info                          who the bot is
//   npm run telegram -- profile                       apply bot.json's profile
//                                                     (name, description, photo)
require("dotenv").config();
const path = require("path");
const {
  configured,
  getMe,
  getUpdates,
  setWebhook,
  deleteWebhook,
  setMyName,
  setMyShortDescription,
  setMyDescription,
  setMyCommands,
  setMyProfilePhoto,
} = require("../services/telegram.service");
const { handleUpdate } = require("../services/contact-bot.service");

const botConfig = require(path.join(__dirname, "../../bot.json"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function info() {
  const me = await getMe();
  console.log(`Bot:  @${me.username}${me.first_name ? ` (${me.first_name})` : ""}`);
  console.log(`Link: https://t.me/${me.username}`);
}

async function webhook(url) {
  const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  if (!secret) throw new Error("Set TELEGRAM_WEBHOOK_SECRET first (see .env.example)");

  const target = `${url.replace(/\/$/, "")}/api/telegram/webhook/${secret}`;
  await setWebhook(target, secret);
  console.log(`Webhook registered: ${target}`);
}

async function clearWebhook() {
  await deleteWebhook();
  console.log("Webhook removed — Telegram will hold updates for polling again.");
}

/**
 * Applies the `profile` block of bot.json: the bot's name, its short
 * description (profile page and shared links), its full description (shown
 * before Start), its command list, and its profile photo.
 *
 * English is applied both as the default (no language_code, so any locale sees
 * something) and for `en`, then Arabic and Kurdish on top.
 */
async function applyProfile() {
  const profile = botConfig.profile || {};
  const codes = (botConfig.languages || []).map((language) => language.code);
  const englishCommands = () => commandList("en");

  function commandList(code) {
    return (profile.commands || [])
      .filter((entry) => entry.description && entry.description[code])
      .map((entry) => ({ command: entry.command, description: entry.description[code] }));
  }

  if (profile.name) {
    await setMyName(profile.name);
    console.log(`name              ${profile.name}`);
  }

  if (profile.shortDescription && profile.shortDescription.en) {
    await setMyShortDescription(profile.shortDescription.en);
    await setMyDescription(profile.description ? profile.description.en : "");
    await setMyCommands(englishCommands());
    console.log("description (en)  default");
  }

  for (const code of codes) {
    const short = profile.shortDescription && profile.shortDescription[code];
    const long = profile.description && profile.description[code];
    const commands = commandList(code);

    if (short) await setMyShortDescription(short, code);
    if (long) await setMyDescription(long, code);
    if (commands.length) await setMyCommands(commands, code);
    console.log(`description (${code})  default + ${code}`);
  }

  if (profile.photo) {
    const file = path.join(__dirname, "../../", profile.photo);
    await setMyProfilePhoto(file);
    console.log(`photo             ${profile.photo}`);
  }
}

/** Long-poll loop: ask for updates, handle them, repeat. */
async function poll() {
  await info();
  console.log("\nPolling for messages — press Ctrl+C to stop.\n");

  let offset = 0;
  for (;;) {
    let updates;
    try {
      updates = await getUpdates(offset, 30);
    } catch (err) {
      console.error(`Poll failed: ${err.message}`);
      await sleep(5000);
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      const result = await handleUpdate(update);
      if (result.handled) console.log(`handled ${result.kind} (update ${update.update_id})`);
    }
  }
}

async function main() {
  if (!configured()) {
    console.error("TELEGRAM_BOT_TOKEN is not set — add it to backend/.env (see .env.example).");
    process.exit(1);
  }

  const [command, argument] = process.argv.slice(2);
  if (command === "webhook") {
    if (!argument) throw new Error("Usage: npm run telegram -- webhook https://your-domain");
    return webhook(argument);
  }
  if (command === "clear-webhook") return clearWebhook();
  if (command === "profile") return applyProfile();
  if (command === "info") return info();
  return poll();
}

main().catch((err) => {
  console.error(`\nTelegram: ${err.message}`);
  process.exit(1);
});
