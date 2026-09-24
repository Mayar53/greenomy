// verify-service.js — /api/verifications
import { api } from "./servisapi.js";

export async function listVerifications() {
  return api.get("/verifications/history");
}

/** Uploads the actual image file (multipart), rather than a base64 string. The
 * server measures the bytes itself, so no client-side pixel stats are sent. */
export async function submitVerificationFile({ plantId, blob, filename, gpsLat, gpsLong, challengeId, milestoneId }) {
  const form = new FormData();
  form.append("plantId", plantId);
  // Keep the member's own filename: the server uses it (one of several signals)
  // to tell a camera photo from a screenshot or a download.
  form.append("image", blob, filename || "plant.jpg");
  if (gpsLat != null) form.append("gpsLat", String(gpsLat));
  if (gpsLong != null) form.append("gpsLong", String(gpsLong));
  if (challengeId) form.append("challengeId", challengeId);
  if (milestoneId) form.append("milestoneId", milestoneId);
  return api.postForm("/verifications", form);
}

/** A fresh per-attempt code to show in the photo. */
export async function issueChallenge(plantId) {
  return api.post("/verifications/challenge", plantId ? { plantId } : {});
}
