// api.js — central REST client used by every *-service.js module.
// Frontend pages never call fetch() directly against backend routes;
// they go through the service layer, which goes through this client.

import { currentLanguage } from "./language.js";

const API_PORT = 4000;

/**
 * Where the API lives, worked out from how this page was served — so the same
 * static site works on a laptop, on a phone and behind an https tunnel with no
 * build step:
 *
 *   window.GREENOMY_API_BASE_URL   an explicit override always wins
 *   localhost / 127.0.0.1          http://localhost:4000/api — works with either
 *                                  `npm start` or a Live Server on :5500
 *   anything else                  /api on this same origin
 *
 * The last case is the phone one, and same-origin is deliberate: `npm start`
 * (dev.js) serves the API under /api on the same port, so a phone gets no CORS
 * to negotiate, no mixed content over https, and no browser block on reaching a
 * second port. Reaching the API directly at <host>:4000 from a page on the LAN
 * is blocked by Chrome's local-network rules, so that route is avoided.
 */
function resolveApiBase() {
  if (window.GREENOMY_API_BASE_URL) return window.GREENOMY_API_BASE_URL;

  const { protocol, hostname } = window.location;
  if (protocol === "file:") return `http://localhost:${API_PORT}/api`;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") {
    return `http://localhost:${API_PORT}/api`;
  }
  return "/api";
}

const API_BASE_URL = resolveApiBase();

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function getAuthToken() {
  return localStorage.getItem("greenomy:token") || sessionStorage.getItem("greenomy:token");
}

/**
 * A failed fetch is either "the API is down" or "the browser blocked the
 * response (CORS)" — the TypeError looks identical. A no-cors probe bypasses
 * the CORS check, so if it resolves the server is up and CORS is the culprit.
 */
async function networkErrorMessage() {
  const base = `Couldn't reach the API at ${API_BASE_URL}.`;

  try {
    await fetch(`${API_BASE_URL}/health`, { mode: "no-cors" });
    return `${base} The server IS reachable, so the browser blocked the response — add ${window.location.origin} to CORS_ORIGIN in backend/.env and restart the API.`;
  } catch {
    return `${base} The API does not appear to be running — start it with \`npm start\` in backend/.`;
  }
}

async function request(method, path, { body, params, auth = true } = {}) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
  }

  const headers = { "Content-Type": "application/json", "Accept-Language": currentLanguage() };
  const token = auth ? getAuthToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new ApiError(await networkErrorMessage(), 0, null);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message = (payload && (payload.message || payload.error)) || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }

  return payload;
}

/** multipart/form-data upload. Kept separate from request() because the browser
 * must set the multipart Content-Type (with its boundary) itself — setting it
 * by hand breaks the upload. */
async function requestForm(path, formData) {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  const headers = { "Accept-Language": currentLanguage() };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(url.toString(), { method: "POST", headers, body: formData });
  } catch {
    throw new ApiError(await networkErrorMessage(), 0, null);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message = (payload && (payload.message || payload.error)) || `Request failed (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }

  return payload;
}

export const api = {
  get: (path, opts) => request("GET", path, opts),
  post: (path, body, opts) => request("POST", path, { ...opts, body }),
  patch: (path, body, opts) => request("PATCH", path, { ...opts, body }),
  delete: (path, opts) => request("DELETE", path, opts),
  postForm: (path, formData) => requestForm(path, formData),
};

export { ApiError };