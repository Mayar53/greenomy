// verify-service.js — /api/verifications
import { api } from "./servisapi.js";

/** Sends a captured photo (as a data URL) plus the measurements taken on a
 * canvas. The backend scores it and returns the verification record. */
export async function submitVerification({ plantId, imageUrl, gpsLat, gpsLong, pixelStats }) {
  return api.post("/verifications", { plantId, imageUrl, gpsLat, gpsLong, pixelStats });
}

export async function listVerifications() {
  return api.get("/verifications/history");
}
