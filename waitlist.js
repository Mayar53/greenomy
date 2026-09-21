// waitlist-service.js — POST /api/waitlist
import { api } from "./servisapi.js";

export async function joinWaitlist({ fullName, email, city, gardeningInterests }) {
  return api.post(
    "/waitlist",
    { fullName, email, city, gardeningInterests },
    { auth: false }
  );
}