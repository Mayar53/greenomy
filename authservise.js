// auth-service.js — talks to /api/auth/*, owns the stored session token.
import { api } from "./servisapi.js";

const TOKEN_KEY = "greenomy:token";
const USER_KEY = "greenomy:user";

function normalizeUser(raw) {
  if (!raw) return raw;
  const { user_id, full_name, total_points, created_at, updated_at, ...rest } = raw;
  return {
    ...rest,
    userId: user_id ?? rest.userId,
    fullName: full_name ?? rest.fullName,
    totalPoints: total_points ?? rest.totalPoints,
    createdAt: created_at ?? rest.createdAt,
    updatedAt: updated_at ?? rest.updatedAt,
  };
}

function storeSession(user, token) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(normalizeUser(user)));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

export async function signup({ fullName, email, password, city }) {
  const result = await api.post("/auth/signup", { fullName, email, password, city }, { auth: false });
  storeSession(result.user, result.token);
  return result.user;
}

export async function login({ email, password }) {
  const result = await api.post("/auth/login", { email, password }, { auth: false });
  storeSession(result.user, result.token);
  return result.user;
}

export async function logout() {
  try {
    await api.post("/auth/logout", {});
  } finally {
    clearSession();
  }
}

export async function requestPasswordReset(email) {
  return api.post("/auth/forgot-password", { email }, { auth: false });
}

export async function fetchCurrentUser() {
  const user = normalizeUser(await api.get("/auth/me"));
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

/** Redirects to login.html if there's no session. Call at the top of any
 * protected page (dashboard, camera, wallet, store, profile, onboarding). */
export function requireAuthOrRedirect(redirectTo = "login.html") {
  if (!isAuthenticated()) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}