# Architecture

This document is the contract both templates follow. Keep new code consistent with it.

---

## Backend — Hexagonal (Ports & Adapters)

### The dependency rule

Dependencies point **inward only**. Outer layers know inner layers; never the reverse.

```
            inbound adapter (django-ninja router + schemas)
                      │  calls
                      ▼
              application (use cases)  ───uses──▶  domain (entities + PORTS)
                      │  depends on ports                       ▲
                      ▼                                         │ implements
            outbound adapters (ORM repo, hasher, JWT) ──────────┘
                      ▲
              composition root (container.py) wires adapters → use cases
```

- **domain/** — pure Python. Entities, value objects, and **ports** (abstract interfaces). No Django, HTTP, or SQL.
- **application/** — use cases: one operation each, dependencies injected via `__init__`, orchestrate the domain through ports. No framework imports.
- **adapters/inbound/** — django-ninja `router.py` (thin) + `schemas.py` (Pydantic DTOs).
- **adapters/outbound/** — port implementations: `orm_models.py` (Django model), `repositories.py` (maps ORM ⇄ entity), `hasher.py`, `tokens.py`.
- **container.py** — the only place concrete adapters are wired to use cases.
- **src/shared/** — base entity, shared `DomainError`s, reusable infra (`JwtCodec`, `JWTAuth`). **config/** — Django project: `settings/{base,dev,prod}`, `api.py` (mounts routers + maps `DomainError`→HTTP), urls, wsgi/asgi.

### Request flow (login)

`POST /api/auth/login` → `router.login` → `container().authenticate_user.execute(LoginCommand)` →
use case calls `UserRepository.get_by_email` + `PasswordHasher.verify` + `TokenService.issue` →
returns `AuthResult` (domain) → ninja serializes it into `AuthOut`. Errors raise `DomainError`
subclasses that `config/api.py` turns into the right status code.

### Add a backend feature
Copy `src/accounts/`: `domain/` (entities, ports, exceptions) → `application/use_cases.py` →
`adapters/outbound/` (model + repository) → `adapters/inbound/` (schemas + router) → `container.py`
→ `apps.py` + re-export `models.py`. Register in `INSTALLED_APPS` + `config/api.py`, then
`makemigrations`/`migrate`. Full checklist in `backend/AGENTS.md`.

---

## Frontend — Feature-based + DRY

### Layers

- **app/** — routing only. Thin pages that import from features. Route groups: `(app)` = authenticated shell, `(auth)` = login.
- **features/`<name>`/** — self-contained: `components/`, `api/`, `hooks/`, `types.ts`, and an **`index.ts` barrel** = the only public surface. Import features via the barrel, never deep paths.
- **components/ui/** — shadcn primitives. **components/shared/** — cross-feature components (`apex-chart`, `direction-toggle`). **components/layout/** — the app shell (sidebar + topbar).
- **lib/** — `api-client.ts` (single fetch wrapper: injects JWT, refreshes on 401), `env.ts` (validated), `types.ts`, `constants.ts`, `utils.ts`.
- **stores/** — global Zustand (`auth`, `ui`). **providers/** — client providers (theme + direction).

### DRY single sources of truth
- All HTTP → `lib/api-client.ts` (features only declare endpoints in `api/*.api.ts`).
- All charts → `components/shared/apex-chart.tsx`.
- Cross-feature state → `stores/` (once). Shared API types → `lib/types.ts` (once).

### Conventions
- **RTL-first:** `<html dir="rtl" lang="ar">`; `ui.store` toggles direction, `app-providers` syncs `<html>`. Use Tailwind logical properties so layouts mirror.
- **React Compiler is on** — skip manual memoization unless profiling demands it.
- `window`-dependent libs (ApexCharts, three.js) are client components; ApexCharts is loaded with `dynamic(..., { ssr: false })`.
- Route protection is client-side (`features/auth/RequireAuth`) because the JWT lives in the persisted store.

### Add a frontend feature
Create `features/<name>/` with `components/`, optional `api/<name>.api.ts` (using `lib/api-client`),
`hooks/`, `types.ts`, and `index.ts`. Add a thin page under `app/(app)/<name>/page.tsx` and a nav
entry in `components/layout/app-shell.tsx`. Full checklist in `frontend/AGENTS.md`.

---

## Contract between the two
The frontend `lib/types.ts` mirrors the backend ninja schemas. `NEXT_PUBLIC_API_URL` points at the
backend `/api`; the backend's `CORS_ALLOWED_ORIGINS` must include the frontend origin.
