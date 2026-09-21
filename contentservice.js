// content-service.js — GET /api/green-hub with local demo-data fallback
import { api } from "./servisapi.js";

async function loadDemoContent() {
  const res = await fetch("greenhub.json");
  if (!res.ok) throw new Error("demo green-hub.json missing");
  return res.json();
}

export async function getGreenHubArticles({ category } = {}) {
  try {
    const data = await api.get("/green-hub", { auth: false, params: { category } });
    return { data, source: "api" };
  } catch (err) {
    console.warn("Greenomy: /api/green-hub unavailable, using demo data.", err.message);
    const all = await loadDemoContent();
    const filtered = category && category !== "all" ? all.filter((a) => a.category === category) : all;
    return { data: filtered, source: "demo" };
  }
}

export async function getRewards() {
  try {
    const data = await api.get("/rewards", { auth: false });
    return { data, source: "api" };
  } catch (err) {
    console.warn("Greenomy: /api/rewards unavailable, using demo data.", err.message);
    const res = await fetch("rewards.json");
    return { data: await res.json(), source: "demo" };
  }
}