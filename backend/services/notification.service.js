// services/notification.service.js — one entry point for creating a
// notification and fanning it out to the user's registered devices.
const notificationModel = require("../models/notification.model");
const deviceTokenModel = require("../models/device-token.model");
const userModel = require("../models/user.model");
const { getPushProvider } = require("./push.service");
const { sendMail } = require("./mail.service");

// Email is opt-out: on unless MAIL_EMAIL_NOTIFICATIONS is explicitly "false".
// With no mail provider configured, sendMail just logs, so this is safe in dev.
const emailEnabled = () =>
  String(process.env.MAIL_EMAIL_NOTIFICATIONS || "true").trim().toLowerCase() !== "false";

// Stored copy is English; the client localises by `type` and falls back to
// this text for unknown types.
const MESSAGES = {
  verification_approved: {
    title: "Photo verified",
    message: "Your plant photo was verified and 30 points were added.",
  },
  verification_pending: {
    title: "Photo sent for review",
    message: "Your plant photo is being reviewed and will be approved shortly.",
  },
  verification_rejected: {
    title: "Photo needs another try",
    message: "Your plant photo wasn't approved. Try a clearer, brighter shot.",
  },
  reward_redeemed: {
    title: "Reward redeemed",
    message: "Your reward is ready — show the code to the partner to claim it.",
  },
};

/**
 * Writes the in-app notification, then attempts push delivery.
 * Push is best-effort by design: a delivery failure must never fail the
 * request that triggered it, and the database row is the source of truth.
 */
async function notify({ userId, type, title, message }) {
  const fallback = MESSAGES[type] || { title: "Greenomy", message: "" };
  const notification = await notificationModel.create({
    userId,
    type,
    title: title || fallback.title,
    message: typeof message === "string" ? message : fallback.message,
  });

  try {
    const tokens = await deviceTokenModel.listByUser(userId);
    if (tokens.length) {
      const provider = getPushProvider();
      await Promise.all(
        tokens.map((device) =>
          provider.send({
            token: device.token,
            title: notification.title,
            body: notification.message,
            data: { type, notificationId: notification.notification_id },
          })
        )
      );
    }
  } catch (err) {
    console.warn(`Push delivery failed for user ${userId}:`, err.message);
  }

  // Email the member too (best-effort, like push). The database row remains the
  // source of truth; a mail failure must never fail the request that triggered
  // the notification.
  if (emailEnabled()) {
    try {
      const user = await userModel.findById(userId);
      if (user && user.email) {
        await sendMail({
          to: user.email,
          subject: notification.title,
          text: `${notification.message}\n\n${process.env.APP_BASE_URL || ""}/garden.html`,
        });
      }
    } catch (err) {
      console.warn(`Email delivery failed for user ${userId}:`, err.message);
    }
  }

  return notification;
}

module.exports = { notify, MESSAGES };
