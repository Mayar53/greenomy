// plant-service.js — /api/plants
import { api } from "./servisapi.js";

export async function listMyPlants() {
  return api.get("/plants");
}

export async function getPlant(id) {
  return api.get(`/plants/${id}`);
}

export async function createPlant({ plantType, plantingMethod, plantingDate, location }) {
  return api.post("/plants", { plantType, plantingMethod, plantingDate, location });
}

export async function updatePlant(id, changes) {
  return api.patch(`/plants/${id}`, changes);
}

export async function deletePlant(id) {
  return api.delete(`/plants/${id}`);
}