// auth-service.js — talks to /api/auth/*, owns the stored session token.
import { api } from "./servisapi.js";

const TOKEN_KEY = "greenomy:token";
const USER_KEY = "greenomy:user";

// Sessions are kept in localStorage ("remember me") or sessionStorage (this tab only).
function readKey(key) {
  for (const store of [localStorage, sessionStorage]) {
    const value = store.getItem(key);
    if (value !== null) return value;
  }
  return null;
}

function activeStore() {
  return sessionStorage.getItem(TOKEN_KEY) !== null ? sessionStorage : localStorage;
}

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

function storeSession(user, token, remember = true) {
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  other.removeItem(TOKEN_KEY);
  other.removeItem(USER_KEY);
  target.setItem(TOKEN_KEY, token);
  target.setItem(USER_KEY, JSON.stringify(normalizeUser(user)));
}

export function clearSession() {
  [localStorage, sessionStorage].forEach((store) => {
    store.removeItem(TOKEN_KEY);
    store.removeItem(USER_KEY);
  });
}

export function getCurrentUser() {
  try {
    const raw = readKey(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return Boolean(readKey(TOKEN_KEY));
}

export async function signup({ fullName, email, password, city }) {
  const result = await api.post("/auth/signup", { fullName, email, password, city }, { auth: false });
  storeSession(result.user, result.token, true);
  return result.user;
}

export async function login({ email, password, remember = true }) {
  const result = await api.post("/auth/login", { email, password }, { auth: false });
  storeSession(result.user, result.token, remember);
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

/** Completes a reset with the token from the emailed link. */
export async function resetPassword({ token, newPassword }) {
  return api.post("/auth/reset-password", { token, newPassword }, { auth: false });
}

/** Changes the password of the signed-in user. */
export async function changePassword({ currentPassword, newPassword }) {
  return api.post("/auth/change-password", { currentPassword, newPassword });
}

export async function fetchCurrentUser() {
  const user = normalizeUser(await api.get("/auth/me"));
  activeStore().setItem(USER_KEY, JSON.stringify(user));
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
