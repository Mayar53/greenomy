// routes/telegram.routes.js — the contact bot's public endpoints.
//
// Both are deliberately unauthenticated, because Telegram calls them and the
// site must read the bot's link before anyone has signed in:
//   GET  /api/telegram/info              what the contact page needs to link the bot
//   POST /api/telegram/webhook/:secret   Telegram's webhook
//
// The webhook is guarded by a shared secret in BOTH the path and the
// X-Telegram-Bot-Api-Secret-Token header, so a stranger cannot post fake
// contacts into the team's inbox. The secret is checked before anything else, so
// an unauthorised caller learns nothing about how the bot is configured.
const router = require("express").Router();
const crypto = require("crypto");
const { configured, getMe } = require("../services/telegram.service");
const { handleUpdate } = require("../services/contact-bot.service");

const webhookSecret = () => String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const botUrl = () => String(process.env.TELEGRAM_BOT_URL || "").trim();

/** The @username inside a t.me link, for display. */
function usernameFrom(url) {
  const match = String(url).match(/t\.me\/([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
}

/** Constant-time compare, so the secret cannot be discovered byte by byte. */
function safeEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** What the contact page needs. Reports nothing rather than a link to a bot that
 * is not configured. */
router.get("/info", async (req, res) => {
  // A configured link wins: no network call on every page view, and the site can
  // still link the bot before the token is in place.
  const known = botUrl();
  if (known) {
    return res.json({ configured: configured(), username: usernameFrom(known), url: known });
  }

  if (!configured()) return res.json({ configured: false, url: null, username: null });

  try {
    const me = await getMe();
    res.json({
      configured: true,
      username: me.username || null,
      url: me.username ? `https://t.me/${me.username}` : null,
    });
  } catch (err) {
    // A bad token is a configuration problem: say so in the log, and tell the
    // page there is no bot rather than handing out a dead link.
    console.warn(`Telegram getMe failed: ${err.message}`);
    res.json({ configured: false, url: null, username: null });
  }
});

router.post("/webhook/:secret", async (req, res) => {
  const expected = webhookSecret();
  if (!expected) return res.status(503).json({ error: "Telegram webhook secret is not configured" });

  const header = req.get("x-telegram-bot-api-secret-token") || "";
  if (!safeEqual(req.params.secret, expected) || !safeEqual(header, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!configured()) return res.status(503).json({ error: "Telegram bot is not configured" });

  // Always answer 200: an update we cannot process must not be retried forever.
  const result = await handleUpdate(req.body || {});
  res.json({ ok: true, handled: result.handled });
});

module.exports = router;
