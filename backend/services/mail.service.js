// services/mail.service.js — pluggable transactional email.
// Same shape as the verification and push providers: the app calls
// sendMail(...) and never talks to a specific vendor, so swapping in a real
// provider later is a config change rather than a code change.
//
// Until a provider is configured, the console provider logs the message — so
// password-reset links are visible in development and nothing silently fails.

const OUTBOX_LIMIT = 20;

// Recent messages, kept so the reset flow can be completed locally while no
// provider is configured (exposed by GET /api/dev/mail). Never retained in
// production, where holding reset links in memory would be a liability.
const outbox = [];
const isProduction = () => process.env.NODE_ENV === "production";

function formatMessage({ to, subject, text }) {
  return [
    "",
    "─────────────────────────────────────────────",
    `  To:      ${to}`,
    `  Subject: ${subject}`,
    "─────────────────────────────────────────────",
    ...String(text).split("\n").map((line) => `  ${line}`),
    "─────────────────────────────────────────────",
    "",
  ].join("\n");
}

class ConsoleMailProvider {
  async send(message) {
    console.log(formatMessage(message));
    if (!isProduction()) {
      outbox.unshift({ ...message, sentAt: new Date().toISOString() });
      if (outbox.length > OUTBOX_LIMIT) outbox.length = OUTBOX_LIMIT;
    }
    return { delivered: true, provider: "console" };
  }
}

class ApiMailProvider {
  // Generic HTTP provider (Resend, SendGrid, Postmark, …): POSTs JSON with a
  // bearer key. Point MAIL_API_URL at the vendor's send endpoint.
  async send({ to, subject, text, html }) {
    const { MAIL_API_URL, MAIL_API_KEY, MAIL_FROM } = process.env;
    if (!MAIL_API_URL || !MAIL_API_KEY || !MAIL_FROM) {
      throw new Error(
        "MAIL_PROVIDER=api requires MAIL_API_URL, MAIL_API_KEY and MAIL_FROM"
      );
    }

    const response = await fetch(MAIL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MAIL_API_KEY}`,
      },
      body: JSON.stringify({ from: MAIL_FROM, to, subject, text, html }),
    });

    if (!response.ok) {
      throw new Error(`Mail provider responded ${response.status}`);
    }
    return { delivered: true, provider: "api" };
  }
}

function getMailProvider() {
  const configured = (process.env.MAIL_PROVIDER || "").trim().toLowerCase();

  if (configured === "api") {
    const { MAIL_API_URL, MAIL_API_KEY, MAIL_FROM } = process.env;
    if (MAIL_API_URL && MAIL_API_KEY && MAIL_FROM) return new ApiMailProvider();
    console.warn(
      "MAIL_PROVIDER=api but MAIL_API_URL / MAIL_API_KEY / MAIL_FROM are incomplete — falling back to console delivery."
    );
  }

  return new ConsoleMailProvider();
}

/**
 * Best-effort send: callers must not fail a request because email is down, and
 * must not leak whether an address exists. Delivery problems are logged.
 */
async function sendMail(message) {
  try {
    const provider = getMailProvider();
    // If an API provider throws, fall back to logging so the link is still
    // recoverable in development.
    if (provider instanceof ApiMailProvider) {
      try {
        return await provider.send(message);
      } catch (err) {
        console.warn(`Mail delivery failed (${err.message}) — logging instead.`);
        return await new ConsoleMailProvider().send(message);
      }
    }
    return await provider.send(message);
  } catch (err) {
    console.error("Mail send failed:", err.message);
    return { delivered: false, provider: "none" };
  }
}

module.exports = {
  sendMail,
  getMailProvider,
  ConsoleMailProvider,
  ApiMailProvider,
  getOutbox: () => outbox,
  clearOutbox: () => {
    outbox.length = 0;
  },
};
