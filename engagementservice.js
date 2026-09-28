// engagementservice.js — /api/engagement. Plant journeys, care actions,
// achievements, seasonal challenges and mystery rewards.
import { api } from "./servisapi.js";

export async function getEngagement() {
  return api.get("/engagement");
}

export async function recordCare({ plantId, actionType, note }) {
  return api.post("/engagement/care", { plantId, actionType, note });
}

export async function claimMystery(grantId) {
  return api.post(`/engagement/mystery/${grantId}/claim`, {});
}

export async function claimChallenge(challengeId) {
  return api.post(`/engagement/challenges/${challengeId}/claim`, {});
}
