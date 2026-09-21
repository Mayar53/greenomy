// impact-service.js — GET /api/impact with a clearly-labeled demo fallback
import { api } from "./servisapi.js";

// DEMO DATA — used only when the backend is unavailable during development.
const DEMO_IMPACT = {
  plantsGrown: 12483,
  seedsStarted: 18921,
  co2ImpactKg: 4320,
  members: 2840,
};

export async function getImpactStats() {
  try {
    const data = await api.get("/impact", { auth: false });
    return { data, source: "api" };
  } catch (err) {
    console.warn("Greenomy: /api/impact unavailable, using demo data.", err.message);
    return { data: DEMO_IMPACT, source: "demo" };
  }
}