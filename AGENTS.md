<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Frontend conventions — Next.js 16 + shadcn (RTL), feature-based, DRY

## Stack
- **Next.js 16** (App Router, Turbopack, **React Compiler** on) + **React 19**, **TypeScript**, **Tailwind v4**.
- **shadcn/ui** (`radix-nova`, **RTL enabled**) · **Zustand** state · **ApexCharts** · **GSAP** · **three.js (R3F + drei)** · **next-themes** · **reactbits** (registry).
- **npm** for packages. Deploys to **Vercel** (zero-config) or **Netlify** (`netlify.toml`).

## Architecture (feature-based)
Path alias `@/* → ./*` (no `src/` dir).

- `app/` — **routing only**. Pages are thin and import from features.
- `features/<name>/` — self-contained module: `components/`, `api/`, `hooks/`, `store/` (if local), `types.ts`, and an **`index.ts` barrel** that is the feature's only public surface. Reference: `features/auth/`, `features/account/`.
- `app/(app)/` — authenticated pages rendered inside the shell (`components/layout/app-shell.tsx`); `app/(auth)/` — login/signup. Add a feature page here + a nav item in the shell.
- `components/ui/` — shadcn primitives (generated; avoid hand-editing). `components/shared/` — cross-feature reusable components (e.g. `apex-chart.tsx` chart wrapper, `animated-heading.tsx` GSAP, `direction-toggle.tsx`). ApexCharts + three.js (R3F) are installed and ready to use, even though no page renders a chart/3D scene by default.
- `lib/` — `api-client.ts` (the single fetch wrapper; injects JWT + refresh), `env.ts` (validated env), `types.ts`, `constants.ts`, `utils.ts` (`cn`).
- `stores/` — global Zustand stores (`auth.store.ts`, `ui.store.ts`). `providers/` — client providers (`app-providers.tsx`).

## DRY rules (don't repeat yourself)
- **All** HTTP goes through `lib/api-client.ts`. Per-feature `api/*.api.ts` only declares endpoints.
- **All** charts go through `components/shared/apex-chart.tsx`.
- Cross-feature state lives **once** in `stores/`. Shared API types live **once** in `lib/types.ts`.
- Import a feature only via its `index.ts` barrel, never deep paths.

## Conventions
- **RTL-first + i18n:** locale lives in `stores/ui.store.ts` (`ar` ⇄ `en`) and drives both the language and direction (`ar`→rtl, `en`→ltr); `providers/app-providers.tsx` syncs `<html dir/lang>`. UI strings come from the typed catalog in `lib/i18n.ts` via the `useTranslation()` hook (`t("key")`) — never hardcode user-facing text. Use Tailwind **logical** properties (`ms-*`/`me-*`/`ps-*`/`pe-*`, `start`/`end`) so layouts mirror automatically.
- **React Compiler is on** (`reactCompiler: true`) — don't add manual `useMemo`/`useCallback` for perf unless profiling says so.
- Anything touching `window` (ApexCharts, three.js) must be a **client component**; load ApexCharts via `dynamic(..., { ssr: false })`.
- Route protection is **client-side** (`features/auth/RequireAuth`) because the JWT lives in the persisted store, not cookies.
- **Icons:** `lucide-react` (the shadcn default, used by `components.json`) and `@phosphor-icons/react` are both available — import Phosphor icons in client components, e.g. `import { IdentificationCard } from "@phosphor-icons/react"`.
- Add shadcn components with `npx shadcn@latest add <name>`. Add **reactbits** animated components via the registry, e.g. `npx shadcn@latest add @reactbits/SplitText-TS-TW` (configured in `components.json`).

## Commands
```bash
npm run dev      # http://localhost:3000
npm run build    # prod build (also type-checks)
npm run lint
```
Set `NEXT_PUBLIC_API_URL` (see `.env.example`) to point at the backend (`…/api`).
