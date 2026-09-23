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
  Each route file wraps its controller with `wrapController()` so rejected
  promises reach the error middleware instead of crashing the process.
- `controllers/` hold request/response handling and call into `models/`, which
  are the only place SQL lives (`backend/models/*.model.js`). The schema is
  owned by `backend/database/migrations/*.sql`, applied with `npm run migrate`;
  `npm run seed` loads the admin account, rewards and Green Hub articles.
  There is no in-memory fallback any more — Postgres is required.
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
- `users.total_points` and its ledger row are updated inside **one SQL
  transaction** (`withTransaction`), so a failure halfway through can't leave
  a balance half-applied. Redemption additionally locks the reward and user
  rows (`SELECT ... FOR UPDATE`) so concurrent redeems can't both pass the
  balance check.
- Reward redemption checks points, reward status, and expiry server-side,
  then issues a single-use, time-limited, opaque `redemption_token`. That
  token — not any personal or account data — is what gets encoded in the
  QR code shown to the partner.

## i18n / RTL
- UI copy lives in the root locale files `local.json` (English),
  `localesar.json` (Arabic), and `localeku.json` (Kurdish — Sorani).
- `language.js` (root) loads the active dictionary, applies it to any element
  tagged `data-i18n="path.to.key"`, sets `<html lang>` and `<html dir>`,
  and persists the choice in `localStorage`.
- Per-record content translations (Green Hub articles, rewards) live inline
  in `greenhub.json` / `rewards.json` under each record's `i18n` object.
- CSS handles direction-sensitive layout under `html[dir="rtl"]` selectors
  in `style.css` rather than duplicating styles per language.

## Next phases (see README)
Phases 1–7 are largely built: the public site, auth/onboarding, the user app
(wallet + garden + camera verification), reward redemption with a QR, the
partner portal, the admin dashboard, and the Phase 7 hardening pass
(notifications, security headers, WCAG AA fixes, SEO). What remains is real
push delivery through Firebase and a frontend test suite.

`services/push.service.js` follows the same swappable-provider shape as
`services/verification-provider.js`: `getPushProvider()` returns a console
provider by default and an FCM provider only when the credentials are present,
so an unconfigured deploy logs notifications instead of silently dropping
them. `services/notification.service.js` writes the database row first — that
row is the source of truth — then attempts delivery, swallowing failures so a
push problem can never fail the request that triggered it.
