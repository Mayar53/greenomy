# Greenomy — Deployment Notes (draft)

## Frontend
The frontend is static HTML/CSS/JS — no build step. Serve the project root
with any static host (Netlify, Vercel static, S3 + CloudFront, nginx) and
set `window.GREENOMY_API_BASE_URL` (before `main.js` loads) to the deployed
API's URL if it isn't served from the same origin under `/api`.

## Backend
1. `cd backend && npm install` (installs `sharp`, which ships prebuilt binaries
   — no system packages required)
2. Copy `.env.example` → `backend/.env` and fill in real values, especially
   `DATABASE_URL` and `JWT_SECRET`.
3. Provide PostgreSQL. `DB_DRIVER` selects the driver: `pglite` runs Postgres
   in-process for local development (nothing to install, single connection),
   while `pg` needs a real server — either `docker compose up -d db` from the
   project root, or a managed instance (Neon / Supabase / RDS) with
   `DATABASE_SSL=true`.
4. `npm run migrate` — applies `database/migrations/*.sql`; safe to re-run.
5. `npm run seed` — creates the first admin account (`ADMIN_SEED_EMAIL` /
   `ADMIN_SEED_PASSWORD`) plus the rewards and Green Hub reference data; also
   safe to re-run. `npm run db:setup` runs both.
6. `npm start` (or run behind a process manager like PM2 / systemd). The API
   exits immediately with a readable message if it can't reach the database.
7. Put the API behind HTTPS and a reverse proxy (nginx / a managed load
   balancer) in production; never expose Node directly to the internet.

## Environment separation
- The verification provider defaults to the offline heuristic scorer in every
  environment. `AIVerificationProvider` is used only when
  `VERIFICATION_PROVIDER=ai` **and** `AI_VERIFICATION_API_KEY` is set;
  otherwise the API logs a warning and falls back to the heuristic.
- Use different `JWT_SECRET` and `DATABASE_URL` values per environment.

## Storage & media
Verification photos are measured and stored by `services/image.service.js`:

- the **original** bytes are written to `IMAGE_STORAGE_DIR` (default
  `backend/uploads/`, gitignored), content-addressed by SHA-256 — identical
  bytes never produce a second file, and the filename cannot be used for path
  traversal;
- the database row keeps only a **bounded preview** (≤640px JPEG data URL), so
  rows stay small while the member's history still renders;
- originals are served through the authenticated
  `GET /api/verifications/:id/image` — there is no public static directory, so
  GPS-tagged originals are never publicly reachable.

`IMAGE_MAX_BYTES` caps an upload (default 8 MB; the JSON body limit is 5 MB).
`IMAGE_STORAGE_DIR` should point at a volume/disk that persists across deploys.

Partner logos and article images are external URLs and need no storage here.

## Security
- The API sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and (in production) HSTS, and disables `X-Powered-By`.
- `NODE_ENV=production` refuses to start unless `JWT_SECRET` is set to a real
  value, and an unset `CORS_ORIGIN` then allows *no* browser origin rather than
  falling back to a wildcard.
- Outside production, an origin on a private network (`10.x`, `192.168.x`,
  `172.16–31.x`, `*.local`, loopback) is also accepted, so testing from a phone on
  the same Wi-Fi does not need the DHCP address pasted into `CORS_ORIGIN`. In
  production only the explicit list counts. Note that `npm start` serves the site
  and the API from one origin anyway, which avoids CORS entirely.
- Content-Security-Policy belongs on the static host, not the API. A policy
  that fits this frontend (Google Fonts, the cdnjs QR library, inline
  `style` attributes):

  ```
  Content-Security-Policy:
    default-src 'self';
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com;
    script-src 'self' https://cdnjs.cloudflare.com;
    img-src 'self' data:;
    connect-src 'self' https://<api-host>;
    frame-ancestors 'none';
    base-uri 'self'
  ```

  `img-src data:` is required because verification photos are data URLs.
  Drop `'unsafe-inline'` from `style-src` once the inline `style` attributes
  are moved into stylesheets.

## Email
Password-reset mail goes through a swappable provider (`services/mail.service.js`):

- `MAIL_PROVIDER=console` (default) logs the message, and outside production
  keeps it readable at `GET /api/dev/mail` — so the reset flow is completable
  locally with no mail account.
- `MAIL_PROVIDER=api` POSTs JSON to `MAIL_API_URL` with `MAIL_API_KEY` and
  `MAIL_FROM` (Resend / SendGrid / Postmark / …).

Set `APP_BASE_URL` to the public site URL so reset links point at the right host.

Caveat: the dev mailbox keys off `NODE_ENV`, so an environment that already sets
`NODE_ENV=production` (some CI images and shells do — note that dotenv will not
override an existing variable) will not expose it. Run with
`NODE_ENV=development` locally, or configure a real provider.

## AI (optional)
Everything AI is off until a key exists; nothing else in the app depends on it.

- `AI_API_KEY` — leave empty to run without a provider: heuristic verification,
  no photo identification, and an assistant that answers from Green Hub guides
  instead of a model.
- `AI_API_URL` — defaults to `https://api.openai.com/v1`. Any OpenAI-compatible
  chat-completions endpoint works: Google's Gemini compatibility URL,
  OpenRouter, Groq, or a local Ollama.
- `AI_MODEL` — defaults to `gpt-4o-mini`. Use a vision-capable model.
- `VERIFICATION_PROVIDER=ai` switches photo scoring from the offline heuristic
  to the model. Without a key it silently keeps using the heuristic.
- `AI_MAX_HISTORY` (default 8) is how many earlier turns the assistant replays;
  `AI_RATE_LIMIT_PER_MIN` (default 12) is the per-minute burst cap. Neither is a
  question limit.

**The challenge code.** A reward-eligible (milestone) photo must show a fresh
code from `POST /api/verifications/challenge`. Confirming that code needs a
vision model: with no key the code cannot be *verified*, so the photo is marked
`requires_review` and queued rather than auto-approving. That is deliberate —
the system never pretends to have proof it does not have. An operator can still
approve it from the admin queue.

**Facts vs the model.** Exact values (germination, durations, temperatures, pH,
seasons, harvest windows) come from `plant_knowledge` / `plant_catalog`, each
with a `knowledge_sources` reference. The assistant is instructed to use only
those numbers and to say when it does not have one. To add facts, extend
`plants.json` and re-seed (`npm run seed`) — no code change.

**Did the member take this photo?** A plant photo downloaded from the internet
passes "is there a plant?" perfectly, so that question is asked separately in
`services/provenance.service.js`:

- offline signals (always available): filename families compared against camera
  (`IMG_`, `DSC`, `PXL_`), screenshot and stock-library names; editor/generator
  software or "screenshot" text in the metadata; screen-shaped dimensions; flat
  UI bars top and bottom; low resolution; an extension that disagrees with the
  bytes;
- the vision model's `captured` / `screenshot` / `watermark` verdicts, when a
  model is configured.

Weak signals are never enough on their own — **a missing EXIF is treated as
neutral, not suspicious**, because most phones and social apps strip it, and a
single odd filename does not block anyone. Two independent hints, a flat-bar
screenshot signature, a stock/screenshot filename, or the model saying the image
was not captured will refuse the photo (or hold it for review, when it is merely
uncertain). Every signal is recorded on the verification record.

**Grounding — how to teach the assistant.** The assistant answers from Green Hub
articles, not from the model's memory. Publish an article (see `greenhub.json`
or the admin Content page) and it becomes available to the assistant on the next
request; `backend/controllers/ai.controller.js` retrieves the relevant ones
automatically, in any of the three languages. A `plant_catalog` row's `notes`
field is also used whenever a question names that plant, so keeping the catalog
notes accurate improves both the recommender and the assistant.

Two things to be deliberate about:
- **Photos leave your server** — a submission sent for AI verification goes to
  the provider. That is a privacy decision for a platform handling members'
  home and garden photos.
- **The key is server-side only.** `services/ai.service.js` is the single place
  that talks to a provider; nothing in the browser ever sees the key.

If a provider call fails (outage, timeout, bad key) verification still
succeeds: the controller falls back to the heuristic scorer and records
`ai_provider: "heuristic"` on the record.

## Weather (plant recommendations)
Powers the "recommended for you" block in the seed wizard. Two providers:

- `WEATHER_PROVIDER=open-meteo` (default) — keyless geocoding + a 7-day
  forecast, cached in-process for an hour.
- `WEATHER_PROVIDER=offline` — a built-in city→climate table and nothing else.
  No network at all.

An unresolvable city, a timeout or a provider error all fall back to the climate
table automatically, so the recommender always answers. Tests force `offline`
(see `backend/tests/helpers.js`) so the suite never touches the network.

### ⚠️ Licence — decide before launch
**Open-Meteo's free tier is for non-commercial use only.** Its data is CC BY 4.0
(attribution required), and their pricing page states that commercial clients
need a commercial licence.

Greenomy is a commercial platform, so before launch either:
1. buy the commercial plan and set `WEATHER_API_KEY` — the service then uses
   their `customer-api` host with `apikey`, as their docs require; or
2. self-host Open-Meteo (AGPL), setting `WEATHER_BASE_URL`.

Both are config-only changes. Development and the prototype are unaffected.
**This needs an owner on the business side, not just an engineering decision.**

Related knobs: `WEATHER_CACHE_TTL_MS` (default 3600000), `WEATHER_TIMEOUT_MS`
(default 8000).

## Not yet implemented
- CI/CD pipeline
- Log aggregation / monitoring
- CDN / image optimization pipeline
- Frontend tests (the suite in `backend/tests/` is API-only)
- **Internet-wide reverse-image search.** Provenance can never be *proven*:
  metadata is trivially stripped or edited, filenames can be renamed, and a
  plant photographed against a plain wall resembles a screenshot. Duplicate
  detection sees only images already stored on **this platform**; the offline
  signals see what the bytes and the file name reveal. An image pulled from a
  search engine, renamed, and re-saved may therefore pass — that is a real
  limitation, not an oversight. No image is ever declared fraudulent
  automatically, and a member can always submit a new photo.
- Adding a reverse-image-search provider would mean sending members' photos to a
  third party and is a privacy decision for the business, not just a technical
  one — see the note about photos leaving the server above.

This file should be expanded as those pieces are actually built, rather
than describing infrastructure that doesn't exist yet.
