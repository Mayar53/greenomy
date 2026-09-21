# Frontend Template

Next.js 16 + shadcn/ui (RTL) starter — **feature-based** and **DRY**. It is a full app shell
(sidebar + topbar navigation), not just a dashboard: new features plug in as pages.

- React 19 · React Compiler · Tailwind v4 · Zustand · GSAP · bilingual ar/en (i18n) · reactbits
- ApexCharts + three.js (R3F) installed and ready (reusable `components/shared/apex-chart.tsx`)
- Arabic-first RTL (toggleable) · deploy to Vercel or Netlify

See [`AGENTS.md`](./AGENTS.md) for conventions and how to add a feature; the repo-root
`ARCHITECTURE.md` has the full picture.

## Quickstart

```bash
npm install
cp .env.example .env.local        # set NEXT_PUBLIC_API_URL (defaults to http://localhost:8000/api)
npm run dev                       # http://localhost:3000
```

Run the backend alongside it (see `../backend`) so login and the app pages have an API.

## Routes

- `/` — public landing
- `/login` · `/signup` — JWT auth (signup registers then auto-logs-in) → session in Zustand → app
- `(app)` group — authenticated shell (sidebar + topbar):
  - `/account` — post-login: a message describing the signed-in account (name, email, role, status)

Toggle language (ar ⇄ en) and theme from the top bar; switching language flips text and direction.

## Scripts

```bash
npm run dev      # dev server (Turbopack)
npm run build    # production build (type-checks too)
npm run start    # serve the production build
npm run lint     # eslint
```

## Structure

```
app/              routing only — (app) shell group, (auth) login/signup, landing
features/         feature modules (auth, account) — each with an index.ts barrel
components/ui     shadcn primitives         components/shared  cross-feature components
components/layout app shell (sidebar/topbar)
lib/              api-client, env, i18n, types, constants, utils
stores/           global Zustand stores (auth, ui)   providers/  client providers
hooks/            useTranslation (i18n)
```

## Adding UI

```bash
npx shadcn@latest add button card dialog ...          # shadcn primitives
npx shadcn@latest add @reactbits/SplitText-TS-TW      # reactbits animated components
```

## Deploy

- **Vercel:** zero-config — import the repo and set `NEXT_PUBLIC_API_URL`.
- **Netlify:** `netlify.toml` is included (uses `@netlify/plugin-nextjs`); set `NEXT_PUBLIC_API_URL`.
