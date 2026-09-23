// services/push.service.js — pluggable push-notification delivery.
// Mirrors services/verification-provider.js: the app calls
// getPushProvider().send(...) and never talks to a specific vendor, so the
// provider can be swapped without touching controller or service code.

class ConsolePushProvider {
  // Development default: no credentials, no network. The message is logged so
  // the notification flow is observable without Firebase configured.
  async send({ token, title, body }) {
    console.log(`[push] -> ${String(token).slice(0, 12)}… | ${title}: ${body}`);
    return { delivered: true, provider: "console" };
  }
}

class FcmPushProvider {
  // Firebase Cloud Messaging (HTTP v1). Requires a service account.
  async send({ token, title, body, data }) {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      throw new Error(
        "Firebase credentials are not configured (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY)"
      );
    }
    // TODO: sign a JWT with the service account key, exchange it for an OAuth2
    // access token, then POST to
    //   https://fcm.googleapis.com/v1/projects/<project>/messages:send
    // — deliberately not faked here, so an unconfigured deploy fails loudly
    // instead of silently dropping notifications.
    void token;
    void title;
    void body;
    void data;
    throw new Error("FcmPushProvider is not implemented yet");
  }
}

function getPushProvider() {
  const configured = (process.env.PUSH_PROVIDER || "").trim().toLowerCase();

  if (configured === "fcm") {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
    if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
      return new FcmPushProvider();
    }
    console.warn(
      "PUSH_PROVIDER=fcm but Firebase credentials are incomplete — falling back to console delivery."
    );
  }

  // Default: console. Notifications always land in the database regardless.
  return new ConsolePushProvider();
}

module.exports = { getPushProvider, ConsolePushProvider, FcmPushProvider };
