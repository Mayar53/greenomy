// tests/mail-reminders.test.js — outbound email (notifications, reminders,
// resets) and the daily care-reminder job.
//
// No test here touches the network: with no SMTP credentials configured the
// mail service falls back to the console provider, whose outbox the dev route
// exposes — which is exactly what lets us assert that a message was produced.
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
  h.cleanup(dbDir);
});

describe("mail providers", () => {
  test("with no provider configured, mail lands in the console outbox", async () => {
    const mail = require("../services/mail.service");
    assert.ok(mail.getMailProvider() instanceof mail.ConsoleMailProvider);

    mail.clearOutbox();
    const result = await mail.sendMail({ to: "someone@example.test", subject: "Test subject", text: "body" });

    assert.equal(result.provider, "console");
    assert.ok(
      mail.getOutbox().some((message) => message.subject === "Test subject"),
      "the message is kept in the outbox for inspection"
    );
  });

  test("an smtp provider with no credentials refuses to send rather than faking delivery", async () => {
    const mail = require("../services/mail.service");
    // The test environment pins MAIL_PROVIDER=console and blanks MAIL_SMTP_*, so
    // this provider has nothing to authenticate with and must say so.
    const provider = new mail.SmtpMailProvider();
    await assert.rejects(
      () => provider.send({ to: "someone@example.test", subject: "s", text: "t" }),
      /MAIL_SMTP/
    );
  });
});

describe("care reminders", () => {
  test("recording a watering schedules the next one", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token, { canonicalPlantId: "pl-tomato" });

    const care = await h.post(api.base, "/engagement/care", {
      token,
      body: { plantId: plant.plant_id, actionType: "watering" },
    });
    assert.equal(care.status, 201);

    const after = await h.get(api.base, `/plants/${plant.plant_id}`, { token });
    assert.ok(after.body.next_watering, "next_watering is set");
    assert.ok(after.body.last_watered, "last_watered is set");
    assert.ok(
      new Date(after.body.next_watering).getTime() > Date.now(),
      "the next watering is in the future"
    );
  });

  test("a due plant produces exactly one reminder per day", async () => {
    const { token } = await h.signup(api.base);
    const plant = await h.createPlant(api.base, token, { canonicalPlantId: "pl-tomato" });

    // Make the plant overdue — the API has no way to backdate a schedule.
    const { query } = require("../config/db");
    await query("UPDATE plants SET next_watering = now() - interval '1 day' WHERE plant_id = $1", [
      plant.plant_id,
    ]);

    const first = await h.post(api.base, "/dev/reminders", { body: {} });
    assert.equal(first.status, 200);
    assert.ok(first.body.results.length >= 1, "at least one member is due");
    assert.ok(
      first.body.results.some((result) => result.notificationId && result.emailed === true),
      "the reminder was written and emailed"
    );

    const second = await h.post(api.base, "/dev/reminders", { body: {} });
    assert.ok(
      second.body.results.every((result) => result.skipped === "already-reminded-today"),
      "a second run the same day sends nothing"
    );

    const forced = await h.post(api.base, "/dev/reminders?force=1", { body: {} });
    assert.ok(forced.body.results.some((result) => result.emailed === true), "force re-sends");

    const notifications = await h.get(api.base, "/notifications", { token });
    assert.ok(
      notifications.body.some((entry) => entry.type === "care_reminder"),
      "an in-app reminder notification exists"
    );

    const outbox = await h.get(api.base, "/dev/mail");
    assert.ok(
      outbox.body.messages.some((message) => /water/i.test(message.subject)),
      "the reminder email reached the mail provider"
    );
  });
});
