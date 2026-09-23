// routes/dev.routes.js — development-only helpers. Mounted by server.js only
// when NODE_ENV is not production, because it exposes the content of emails
// the app would otherwise have sent (i.e. password-reset links).
const router = require("express").Router();
const { getOutbox } = require("../services/mail.service");

// Synchronous, so no async wrapper is needed here.
router.get("/mail", (req, res) => {
  res.json({
    note: "Development mail outbox — messages the app would have emailed.",
    messages: getOutbox().map(({ to, subject, text, sentAt }) => ({ to, subject, text, sentAt })),
  });
});

module.exports = router;
