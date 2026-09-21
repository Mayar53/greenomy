# Greenomy — Deployment Notes (draft)

## Frontend
The frontend is static HTML/CSS/JS — no build step. Serve the project root
with any static host (Netlify, Vercel static, S3 + CloudFront, nginx) and
set `window.GREENOMY_API_BASE_URL` (before `main.js` loads) to the deployed
API's URL if it isn't served from the same origin under `/api`.

## Backend
1. `cd backend && npm install`
2. Copy `.env.example` → `backend/.env` and fill in real values, especially
   `DATABASE_URL` and `JWT_SECRET`.
3. Provision PostgreSQL and run the schema in `docs/DATABASE.md` (a
   migration tool — e.g. `node-pg-migrate` or Prisma — should own this once
   the schema stabilizes; it is hand-documented for now).
4. `npm start` (or run behind a process manager like PM2 / systemd).
5. Put the API behind HTTPS and a reverse proxy (nginx / a managed load
   balancer) in production; never expose Node directly to the internet.

## Environment separation
- `NODE_ENV=production` switches the verification provider from
  `MockVerificationProvider` to `AIVerificationProvider` — make sure
  `AI_VERIFICATION_API_KEY` is set before flipping this, or verification
  submissions will fail.
- Use different `JWT_SECRET` and `DATABASE_URL` values per environment.

## Storage & media
Verification photos, partner logos, and article images should go to
object storage (the `.env.example` `STORAGE_*` variables assume an S3-
compatible bucket), not the application server's local disk.

## Not yet implemented
- CI/CD pipeline
- Automated database migrations
- Log aggregation / monitoring
- CDN / image optimization pipeline

This file should be expanded as those pieces are actually built, rather
than describing infrastructure that doesn't exist yet.
