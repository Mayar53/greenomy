// jobs/reminders.js — run the daily care reminders once and exit.
// For a system cron, or manually:  npm run reminders  (add --force to ignore the
// once-a-day guard, e.g. when testing delivery).
require("dotenv").config();
const { pool, assertConfigured } = require("../config/db");
const { runReminders } = require("../services/reminder.service");

async function main() {
  assertConfigured();
  const results = await runReminders({ force: process.argv.includes("--force") });

  if (!results.length) {
    console.log("No plants are due for watering.");
    return;
  }

  for (const result of results) {
    if (result.skipped) {
      console.log(`skip  ${result.userId} (${result.skipped})`);
      continue;
    }
    console.log(
      `sent   ${result.userId} — ${result.plants} plant(s), emailed: ${result.emailed ? "yes" : "no"}`
    );
  }
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(`\nReminders failed: ${err.message}`);
    pool.end().finally(() => process.exit(1));
  });
