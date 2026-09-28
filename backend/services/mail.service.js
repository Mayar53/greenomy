// services/mail.service.js — pluggable transactional email.
// Same shape as the verification and push providers: the app calls
// sendMail(...) and never talks to a specific vendor, so swapping in a real
// provider later is a config change rather than a code change.
//
// Providers:
//   console  the default — logs the message, so reset links are visible in dev
//            and nothing silently fails
//   smtp     any SMTP server via an app password (Gmail, Fastmail, a host's
//            mailbox). This is the one to use for Gmail: create an App Password
//            for the account and set MAIL_SMTP_PASS to it
//   api      a generic HTTP vendor (Resend, SendGrid, Postmark, …) with a bearer key
//
// Whichever is configured, a delivery failure falls back to logging the message
// rather than failing the request that triggered it.

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

/** True when the SMTP provider has everything it needs to try a send. */
function smtpConfigured() {
  const { MAIL_SMTP_HOST, MAIL_SMTP_USER, MAIL_SMTP_PASS, MAIL_FROM } = process.env;
  return Boolean(MAIL_SMTP_HOST && MAIL_SMTP_USER && MAIL_SMTP_PASS && MAIL_FROM);
}

// One pooled transporter per process: creating one per message would open a new
// connection every time.
let smtpTransporter = null;

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    throw new Error("MAIL_PROVIDER=smtp needs nodemailer — run `npm install` in backend/.");
  }

  const port = Number(process.env.MAIL_SMTP_PORT || 465);
  // Implicit TLS on 465, STARTTLS on 587 — unless MAIL_SMTP_SECURE overrides it.
  const secure = process.env.MAIL_SMTP_SECURE
    ? process.env.MAIL_SMTP_SECURE === "true"
    : port === 465;

  smtpTransporter = nodemailer.createTransport({
    host: process.env.MAIL_SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.MAIL_SMTP_USER, pass: process.env.MAIL_SMTP_PASS },
  });
  return smtpTransporter;
}

class SmtpMailProvider {
  // Gmail: host smtp.gmail.com, port 465, user the full address, pass an App
  // Password (not the account password). Gmail stamps the From as the
  // authenticated user, so MAIL_FROM's address should match MAIL_SMTP_USER.
  async send({ to, subject, text, html }) {
    if (!smtpConfigured()) {
      throw new Error(
        "MAIL_PROVIDER=smtp requires MAIL_SMTP_HOST, MAIL_SMTP_USER, MAIL_SMTP_PASS and MAIL_FROM"
      );
    }

    const info = await getSmtpTransporter().sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      text,
      html,
    });
    return { delivered: true, provider: "smtp", messageId: info && info.messageId };
  }
}

function getMailProvider() {
  const configured = (process.env.MAIL_PROVIDER || "").trim().toLowerCase();

  if (configured === "smtp") {
    if (smtpConfigured()) return new SmtpMailProvider();
    console.warn(
      "MAIL_PROVIDER=smtp but MAIL_SMTP_HOST / MAIL_SMTP_USER / MAIL_SMTP_PASS / MAIL_FROM are incomplete — falling back to console delivery."
    );
  }

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
 * must not leak whether an address exists. Delivery problems are logged, and a
 * real provider that throws falls back to logging so the message is still
 * recoverable in development.
 */
async function sendMail(message) {
  const provider = getMailProvider();

  if (provider instanceof ConsoleMailProvider) {
    return provider.send(message);
  }

  try {
    return await provider.send(message);
  } catch (err) {
    console.warn(`Mail delivery failed (${err.message}) — logging instead.`);
    return new ConsoleMailProvider().send(message);
  }
}

module.exports = {
  sendMail,
  getMailProvider,
  ConsoleMailProvider,
  ApiMailProvider,
  SmtpMailProvider,
  getOutbox: () => outbox,
  clearOutbox: () => {
    outbox.length = 0;
  },
};
