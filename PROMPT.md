# Planning Prompt Template

Copy everything in the block below, fill in the `<<…>>` placeholders, and give it to your coding
agent (e.g. Claude Code) **from the repository root**. It encodes the fixed stack and architecture
so any new system stays consistent with these templates. Ask for a **plan first**, then build.

---

```text
You are planning and building a new system on top of these two existing templates.
Do NOT change the stack or architecture — both are fixed. Read backend/AGENTS.md,
frontend/AGENTS.md, and ARCHITECTURE.md before writing any code, and read the bundled
docs for Next.js 16 (frontend/node_modules/next/dist/docs) and django-ninja, since both
are newer than your training data.

## Fixed stack
Backend:  Django 6 + django-ninja, uv, JWT (PyJWT). SQLite (dev) / Postgres (prod),
          Redis cache, MinIO/S3 media. Hexagonal (Ports & Adapters). Docker → Coolify.
Frontend: Next.js 16 + React 19 + TypeScript, shadcn/ui (RTL, Arabic-first), Tailwind v4,
          Zustand, ApexCharts, GSAP, three.js (R3F), reactbits, React Compiler. npm.
          Feature-based + DRY. Deploys to Vercel or Netlify.

## Non-negotiable rules
- Backend: domain is pure Python (entities + ports); use cases hold business logic; routers are
  thin; adapters implement ports; wire everything in each feature's container.py. Copy src/accounts.
- Frontend: each feature is a folder under features/ with an index.ts barrel; all HTTP goes through
  lib/api-client.ts; all charts through components/shared/apex-chart.tsx; global state in stores/;
  pages under app/(app)/ render inside the app shell. RTL-first; no manual memoization.
- Keep the frontend↔backend contract in sync (frontend lib/types.ts mirrors the ninja schemas).

## The system to build
Name / domain:      <<what the system is>>
Primary users:      <<who uses it>>
Core entities:      <<list the main entities and key fields>>
Key features:       <<feature 1 — what it does>>
                    <<feature 2 — …>>
Auth / roles:       <<reuse accounts JWT? add roles/permissions? which routes are protected?>>
External services:  <<payments, email, storage buckets, 3rd-party APIs — or "none">>
Non-functional:     <<scale, latency, compliance, offline, i18n beyond ar/en — or "standard">>

## Deliverables
1. A short plan: the backend features (with their entities/ports/use cases/endpoints) and the
   frontend features (with their pages/components/stores), mapped onto the template structure.
   Call out anything that does NOT fit the templates and how you'll handle it.
2. After I approve the plan: implement it feature by feature, following AGENTS.md for each side.
3. Run the verifications (backend: uv run pytest; frontend: npm run build && npm run lint) and
   report results. Add migrations and update .env.example for any new config.

Start by exploring the templates and producing the plan. Do not write code until I approve it.
```

---

### Tips
- Keep each feature small and vertical (one entity + its operations end to end) — it maps cleanly
  onto both the backend hexagon and a frontend feature folder.
- If a feature needs a new dependency, add it with `uv add` (backend) or `npm install` (frontend)
  and note it in the plan.
- For new shadcn components run `npx shadcn@latest add <name>`; for animated ones use the reactbits
  registry, e.g. `npx shadcn@latest add @reactbits/SplitText-TS-TW`.
