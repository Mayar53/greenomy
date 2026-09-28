// services/reminder.service.js — daily plant-care reminders.
//
// A reminder is due when a plant's next_watering has passed, which is set when
// a member records a watering (see engagement.service). For each member with due
// plants we write one in-app notification and email them, at most once a day:
// the notification row created today is the dedupe key, so running the job twice
// — or restarting the API — cannot send the same reminder twice.
const notificationModel = require("../models/notification.model");
const plantModel = require("../models/plant.model");
const { sendMail } = require("./mail.service");

const REMINDER_TYPE = "care_reminder";
const TITLE = "Time to water your plants";

/** Due plants grouped by owner, ready to turn into one reminder each. */
async function dueByUser() {
  const plants = await plantModel.listDueForWatering();
  const byUser = new Map();

  for (const plant of plants) {
    if (!byUser.has(plant.user_id)) {
      byUser.set(plant.user_id, { email: plant.email, fullName: plant.full_name, plants: [] });
    }
    byUser.get(plant.user_id).plants.push(plant);
  }

  return byUser;
}

function reminderMessage(plants) {
  const names = plants.map((plant) => plant.custom_name || plant.plant_type).filter(Boolean);
  const list = names.join(", ");
  return plants.length === 1
    ? `${names[0] || "One plant"} is ready for watering.`
    : `${plants.length} plants are ready for watering: ${list}.`;
}

/**
 * Sends every reminder that is due. `force` skips the once-a-day guard, for
 * testing. Returns one result per member with due plants.
 */
async function runReminders({ force = false } = {}) {
  const byUser = await dueByUser();
  const results = [];

  for (const [userId, group] of byUser) {
    if (!force && (await notificationModel.countTodayByType(userId, REMINDER_TYPE)) > 0) {
      results.push({ userId, skipped: "already-reminded-today" });
      continue;
    }

    const message = reminderMessage(group.plants);
    const notification = await notificationModel.create({
      userId,
      type: REMINDER_TYPE,
      title: TITLE,
      message,
    });

    let emailed = false;
    if (group.email) {
      const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
      const delivery = await sendMail({
        to: group.email,
        subject: `${TITLE} — Greenomy`,
        text: `Hi ${group.fullName || "there"},\n\n${message}\n\nOpen your garden: ${base}/garden.html`,
      });
      emailed = Boolean(delivery && delivery.delivered);
    }

    results.push({
      userId,
      plants: group.plants.length,
      notificationId: notification.notification_id,
      emailed,
    });
  }

  return results;
}

module.exports = { runReminders, dueByUser, REMINDER_TYPE, TITLE };
