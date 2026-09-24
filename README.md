# Greenomy

A sustainability and urban-greening platform: grow real plants, learn
everyday sustainability, document growth, earn points, and redeem them with
partner businesses.

Nature × Technology × Community.

## Status: Phases 1–7 built, plus the platform upgrade

The public marketing site, auth/onboarding, the user app, the admin review
queue and the partner portal all work on real PostgreSQL — and the plant
catalog, growth journeys, photo verification and reward engine have been taken
to production grade (canonical plant identity and aliases, sourced agronomic
facts, multi-signal verification with duplicate protection, and idempotent
rewards). See `docs/ARCHITECTURE.md`.

**Built and working:**
- Public pages: `index.html`, `about.html`, `greenhub.html`, `rewards.html`, `contact.html`
- Full design system (`style.css`, `responsive.css`, `auth.css`) — sage/beige/burgundy/gold palette, mobile-first down to 375px
- Trilingual UI — English, Arabic and Kurdish (Sorani) — with live RTL/LTR switching (`language.js`, `local.json`, `localesar.json`, `localeku.json`); 523 keys with full parity
- Auth: signup (with confirm-password) and login against the API, JWT sessions with "remember me"
- Account: `profile.html` — account summary, name/city editing and password change
- Password reset: `forgot-password.html` → single-use, hashed, 30-minute token → `reset-password.html`. The mail provider is swappable; with none configured the message is logged and readable at `GET /api/dev/mail` (development only)
- Onboarding wizard → `eco-profile.html` → `new-seed.html`
- User app: `wallet.html` (balance + points ledger), `garden.html` (plants, verification status, submission history)
- Camera verification: real `getUserMedia()` capture, GPS, file validation → `POST /verifications`
- Rewards store: 4 categories at the spec's 40/30/20/10 split, in-app redemption with a **QR code** and single-use, time-limited tokens
- Admin dashboard — `admin.html` (verification queue) plus `admin-users.html`, `admin-partners.html`, `admin-rewards.html`, `admin-content.html` and `admin-analytics.html`: user suspension, partner/reward/article CRUD and live platform analytics
- `partner.html`: validate and consume a member's redemption code
- Green Hub: 6 translated articles with category filters
- Notifications — created on verification, admin decision and redemption events; shown on the wallet page and fanned out through a swappable push provider (console in development, FCM when configured) with device-token registration
- Hardening — server-side password strength and email validation, security headers, non-wildcard CORS in production, a real JWT secret requirement in production, and WCAG AA contrast fixes (14 pages audited with axe-core, 0 violations)
- SEO — `robots.txt`, `sitemap.xml`, canonical URLs, OG image and Twitter card on the public pages
- **Plant recommendations** — the seed wizard suggests what to grow, ranked from
  the catalog by the member's city and climate, the current season, how long
  they'll wait for a harvest, and the preferences they chose at onboarding. Live
  weather comes from Open-Meteo (keyless) with a built-in climate table as
  fallback, so it works offline. The ranking is deterministic — no AI decides
  what to plant, because a model that invents a harvest time is worse than no
  suggestion at all
- **Canonical plant catalog** — 63 plants, one row each, with taxonomy (Kew
  POWO), varieties, sourced agronomic facts (FAO ECOCROP / crop calendars) and
  **aliases in English, MSA, Iraqi Arabic and Kurdish**: `tomato`, `tomatoes`,
  `طماطم`, `طماطة`, `بندورة` and `Solanum lycopersicum` all resolve to one
  plant. The seed wizard searches the catalog instead of offering four fixed
  tiles, and existing free-text plants are linked by an idempotent backfill
- **Growth journeys** — a plant becomes a journey with stage-based milestones
  whose windows are computed from that plant's germination period and
  days-to-harvest (a radish and a lemon tree get genuinely different schedules).
  Progress is shown on the garden page
- **Photo verification** — measured server-side (`sharp`): a SHA-256 identity
  hash, perceptual hashes that survive resizing/recompression, and a fresh
  single-use challenge code. Duplicates are detected **across all users**;
  a flagged or unconfirmed photo queues for review instead of being called
  fraud. Originals are stored content-addressed on disk behind an authenticated
  route; the row keeps only a small preview
- **Reward engine** — points are a deterministic server-side rule applied
  idempotently (`reward_awards` unique key), so a replayed approval or a
  resubmitted photo pays nothing. One photo pays for the one milestone it
  evidences; the journey completion bonus is separate
- **AI (optional)** — three features, all off until `AI_API_KEY` is set: real photo verification (a vision model adds challenge/identity signals to the deterministic ones), plant identification from a photo in the seed wizard, and a gardening assistant on the garden page that knows what you're growing. The assistant runs an explicit pipeline (language → entities → intent → retrieval → conditions → context), continues a conversation, understands Iraqi Arabic and Kurdish, and answers exact values only from the sourced knowledge rows. Provider-agnostic (any OpenAI-compatible endpoint), and every path degrades gracefully without a key
- Express REST API on **PostgreSQL** — migrations (`npm run migrate`), seed (`npm run seed`), `models/*.model.js`, and atomic points/redemption transactions
- 157 API tests (`cd backend && npm test`)
- Docs: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`

**Not yet built:**
- An AI key — the three AI features return a clear "not configured" message until `AI_API_KEY` is set (see `docs/DEPLOYMENT.md`)
- A real mail provider — reset emails are logged, not sent, until `MAIL_PROVIDER=api` is configured
- Email verification — the reset flow is done, but an address isn't verified at signup
- Push delivery — the provider seam and device registration are in place, but `FcmPushProvider` throws rather than sending (no Firebase project yet), and nothing on the web client registers a device token
- Frontend tests — the API suite covers the backend; the UI was verified by hand in a browser
- Internet-wide reverse-image search — duplicate detection compares against this
  platform's stored images plus provenance (challenge code, hashes), so it cannot
  know an image came from Google Images. Suspicious images go to review
- Weekly growth reports

## Running it

**Database** — `DB_DRIVER` in `backend/.env` picks the driver:

- **`pglite`** (what the committed `.env` uses) — PostgreSQL compiled to WASM,
  running in-process with nothing to install. Development and tests only, since
  it's a single connection.
- **`pg` + Docker** — `docker compose up -d db` from the project root, then
  `DATABASE_URL=postgres://greenomy:greenomy@localhost:5432/greenomy`.
- **`pg` + managed** — a Neon/Supabase/RDS URL with `DATABASE_SSL=true`.

**Backend**:
```
cd backend
npm install
cp ../.env.example .env    # fill in DATABASE_URL and JWT_SECRET
npm run migrate            # create the schema
npm run seed               # admin account + rewards + Green Hub articles
npm start
```
The API listens on `http://localhost:4000/api` and requires a reachable
PostgreSQL — it exits with a clear message if it can't connect.

**Tests** — `cd backend && npm test`. The API suite boots a throwaway PGlite
database in a temp dir, migrates and seeds it, and exercises auth, the points
ledger, redemption concurrency, notifications, the admin dashboard, the security
hardening, the plant catalog and alias search, journeys, photo verification with
duplicate detection, and the reward engine (157 tests).

**Frontend** — any static file server from the project root, e.g.:
```
npx serve .
```

## Project structure
Flat at the project root: one HTML file per page, one JS module per concern
(`app.js`, `camera.js`, `reward.js`, `portal.js`, …), shared styles in
`style.css` + `responsive.css` + `auth.css`, and the locale files
`local.json` / `localesar.json` / `localeku.json`.

Backend follows `routes` → `controllers` → `models` (PostgreSQL), with
migrations and seeds in `backend/database/`. See `docs/ARCHITECTURE.md` for
the full breakdown.

## Next step
Phase 6 — the wider admin dashboard (users, partners, rewards, content,
analytics) — or Phase 7 hardening. Tell me which and I'll build it against
this same architecture.
