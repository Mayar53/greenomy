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
  service module (`servisapi.js`, `serviseplant.js`, `verifyservice.js`,
  `authservise.js`, …) at the project root. This is what lets the backend
  evolve (auth scheme, base URL, retry logic) without touching page code.
- The API is the only source of truth — there is no demo-data fallback. A
  failed request surfaces as an error state, never as fabricated content.

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
  `MockVerificationProvider` for local development, an offline
  `HeuristicVerificationProvider` (the default) and an
  `AIVerificationProvider` for a real vision model — so the app is never
  hard-wired to one AI vendor. `verifyPhoto()` adds optional
  challenge/identity signals when a model is configured.
- `services/recommendation.service.js` ranks the catalog deterministically;
  `services/journey.service.js` builds a plant's milestone schedule;
  `services/image.service.js` measures and stores photos; `services/
  duplicate.service.js` compares hashes; `services/reward-engine.service.js`
  is the only place points are decided. Controllers orchestrate these and
  stay thin.

## Plant identity
- One `plant_catalog` row per plant; every other spelling (English plural,
  scientific name, MSA/Iraqi/Kurdish colloquial) is a `plant_aliases` row.
  `services/plant-normalize.service.js` folds names the same way for the
  catalog search, the assistant's retrieval and the seeder's backfill, so a
  name resolves identically everywhere.
- Structured facts live in `plant_knowledge`, each with a `knowledge_sources`
  reference, and are the **source of truth for exact values**. The model is
  told to answer exact numbers only from there.

## Verification & rewards
- A photo is measured server-side (`image.service.js`): sha256 (exact
  identity) plus perceptual hashes (near-duplicate) and pixel stats. The
  original is stored content-addressed on disk; the row keeps a small preview.
- `duplicate.service.js` compares against **every** user's images, so a
  re-uploaded or recompressed photo is flagged. A near match is marked for
  review, never auto-declared fraud.
- A reward-eligible milestone photo must show a fresh, expiring, single-use
  `verification_challenges` code. Without a configured vision model the code
  cannot be *confirmed*, so the photo queues for review instead of
  auto-approving.
- `reward-engine.service.js` pays points from the verification result inside
  the same transaction, guarded by `reward_awards`' unique key — so a replayed
  approval or a resubmitted photo pays nothing.

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

## Growth journeys
- A plant can become a `journeys` row (one per plant) whose
  `journey_milestones` come from `plant_growth_stages` — the plant's own
  template, or per-plant overrides. Windows are interpolated between the
  plant's germination period and days-to-harvest, and starting from a seedling
  or cutting skips germination, so schedules are configurable rather than a
  fixed calendar.
- Evidence is a verified photo: approving a milestone photo completes that
  milestone, advances the journey and pays its reward.

## Tests
- `backend/tests/` — the API suite (`cd backend && npm test`) runs against an
  in-process PGlite database, so it needs no services.
- `tests/` — the frontend suite (`npm test` at the project root) reads the static
  files and checks links, i18n keys across all three languages, locale parity,
  icon names, absence of emoji, catalog integrity, and that the generated
  reviewer worklist still matches `plants.json`.
- Both run in CI on every push and pull request (`.github/workflows/ci.yml`).

## What remains
- Real push delivery through Firebase (the console provider is the default).
  Everything else in Phases 1–7 plus the catalog/journey/verification/reward work
  above is built.

`services/push.service.js` follows the same swappable-provider shape as
`services/verification-provider.js`: `getPushProvider()` returns a console
provider by default and an FCM provider only when the credentials are present,
so an unconfigured deploy logs notifications instead of silently dropping
them. `services/notification.service.js` writes the database row first — that
row is the source of truth — then attempts delivery, swallowing failures so a
push problem can never fail the request that triggered it.
