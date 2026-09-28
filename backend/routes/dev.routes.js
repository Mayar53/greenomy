// routes/dev.routes.js — development-only helpers. Mounted by server.js only
// when NODE_ENV is not production, because it exposes the content of emails
// the app would otherwise have sent (i.e. password-reset links) and can trigger
// background jobs on demand.
const router = require("express").Router();
const { getOutbox } = require("../services/mail.service");
const { runReminders } = require("../services/reminder.service");
const { wrapController } = require("../middleware/async-handler");

// Synchronous, so no async wrapper is needed here.
router.get("/mail", (req, res) => {
  res.json({
    note: "Development mail outbox — messages the app would have emailed.",
    messages: getOutbox().map(({ to, subject, text, sentAt }) => ({ to, subject, text, sentAt })),
  });
});

// Runs the daily care reminders now. `?force=1` skips the once-a-day guard so
// delivery can be tested without waiting for tomorrow.
router.post(
  "/reminders",
  wrapController({
    run: async (req, res) => {
      const results = await runReminders({ force: req.query.force === "1" });
      res.json({ ran: results.length, results });
    },
  }).run
);

module.exports = router;
