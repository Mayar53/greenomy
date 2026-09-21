# Greenomy

A sustainability and urban-greening platform: grow real plants, learn
everyday sustainability, document growth, earn points, and redeem them with
partner businesses.

Nature × Technology × Community.

## Status: Phase 1 complete

This delivery covers **Phase 1** of the build plan — the public marketing
site — plus the backend and data architecture that every later phase will
plug into.

**Built and working:**
- Public pages: `index.html`, `about.html`, `green-hub.html`, `rewards.html`, `contact.html`
- Full design system (`css/style.css`, `css/responsive.css`) — sage/beige/burgundy/gold palette, 16px-radius cards, mobile-first responsive rules down to 375px
- Bilingual English/Arabic i18n with live RTL/LTR switching (`js/language.js`, `locales/en.json`, `locales/ar.json`)
- Mobile nav, animated live-impact counters, Green Hub category filters, rewards showcase, and a validated waitlist form — all wired through a real service layer (`js/services/*.js`) with demo-data fallbacks
- A running Express + PostgreSQL-shaped REST API (`backend/`) implementing every route in `docs/API.md` against an in-memory store, so the frontend has something real to talk to before Postgres is provisioned
- Docs: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`

**Not yet built** (per the phased plan — each is a substantial piece of work in its own right):
- Phase 2: `login.html`, `signup.html`, `onboarding.html`, `eco-profile.html`, `new-seed.html`
- Phase 3: `app/dashboard.html`, `app/wallet.html`, `app/store.html`, `app/profile.html`
- Phase 4: `app/camera.html` + live camera/GPS capture + AI verification wiring
- Phase 5: PostgreSQL actually provisioned and wired in place of the mock store
- Phase 6: `admin/*.html` — user management, verification queue, partners, rewards, content, analytics
- Phase 7: push notifications, deeper security hardening, full accessibility/SEO pass, automated tests

## Running it

**Frontend** — any static file server from the project root, e.g.:
```
npx serve .
```

**Backend**:
```
cd backend
npm install
cp ../.env.example .env   # fill in JWT_SECRET at minimum for local dev
npm start
```
The API listens on `http://localhost:4000/api` by default and runs fully
against demo data — no database is required to try it end-to-end yet.

## Project structure
See `docs/ARCHITECTURE.md` for the full breakdown. In short: plain HTML per
page, modular vanilla JS behind a service layer, Express routes → controllers
→ (soon) PostgreSQL-backed models, with a swappable AI-verification provider
and a demo-data fallback everywhere the real backend isn't reachable yet.

## Next step
Tell me which phase to build next (recommend Phase 2: auth + onboarding,
since the dashboard and camera flows depend on having a logged-in user), and
I'll build it against this same architecture rather than starting over.
