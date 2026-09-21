# Greenomy — Architecture

```
HTML / CSS / Vanilla JS (this repo's frontend)
        │
        ▼
Frontend service layer  (js/services/*.js)
        │  fetch() calls, no business logic
        ▼
Node.js + Express REST API  (backend/)
        │  routes → controllers → (services/models)
        ▼
PostgreSQL
```

A future Flutter / React Native app talks to the **same** `/api/*` routes —
none of the backend logic is web-specific.

## Frontend
- Plain HTML per page (no templating engine, no framework, no build step).
- CSS split into `style.css` (design system + components) and
  `responsive.css` (breakpoint overrides only).
- JS is modular (`type="module"`): one file per concern (`navigation.js`,
  `language.js`, `plants.js`, `camera.js`, …), never one giant script.
- Pages never call `fetch()` against `/api/*` directly — they call a
  function in `js/services/*.js`, which calls the shared client in
  `js/services/api.js`. This is what lets the backend evolve (auth scheme,
  base URL, retry logic) without touching page code.
- Until a real API is reachable, service modules fall back to the JSON
  files in `data/` so the UI is fully testable in isolation. Each fallback
  is explicit in code (`source: "demo"` vs `"api"`) — nothing is silently
  faked in production.

## Backend
- `routes/` map HTTP verbs+paths to controllers only — no logic lives here.
- `controllers/` hold request/response handling and call into
  `services/`/`models/` (currently an in-memory mock store,
  `database/mock-data.js`, standing in for PostgreSQL until it's wired up).
- `middleware/auth.middleware.js` verifies JWTs and enforces roles
  (`user` / `admin` / `super_admin`) — the frontend's own role checks are
  UX only and are never trusted.
- `services/verification-provider.js` is a swappable interface: a
  `MockVerificationProvider` for local development and an
  `AIVerificationProvider` stub for the real computer-vision integration,
  so the app is never hard-wired to one AI vendor.

## Points & rewards integrity
- Points are only ever changed by the backend, and every change is written
  to `point_transactions` — the frontend never computes or asserts a point
  value.
- Reward redemption checks points, reward status, and expiry server-side,
  then issues a single-use, time-limited, opaque `redemption_token`. That
  token — not any personal or account data — is what gets encoded in the
  QR code shown to the partner.

## i18n / RTL
- All visible copy lives in `locales/en.json` / `locales/ar.json`.
- `js/language.js` loads the active dictionary, applies it to any element
  tagged `data-i18n="path.to.key"`, sets `<html lang>` and `<html dir>`,
  and persists the choice in `localStorage`.
- CSS handles direction-sensitive layout under `html[dir="rtl"]` selectors
  in `style.css` rather than duplicating styles per language.

## Next phases (see README)
Phases 2–7 from the product spec — auth pages, onboarding, the user
dashboard/camera/wallet/store, the admin dashboard, and
notifications/security/accessibility hardening — build on this same
structure and should each get their own pass rather than being scaffolded
all at once.
