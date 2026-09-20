# CAPTYN Hosting

Standalone admin tool for managing websites CAPTYN builds and hosts for other
businesses: recurring monthly invoices, email reminders, and M-Pesa payment
via a public pay link — separate from the `byg-global` e-commerce app.

## Architecture

This is a separate Next.js app, but it is **not** fully isolated:

- **Database**: shares byg-global's Postgres database. `hosting_services` and
  `hosting_invoices` (and their foreign keys into byg-global's `User` /
  `business_profiles` tables) are migrated from `byg-global/prisma/migrations`
  — this project's `prisma/schema.prisma` only describes those two tables so
  its own Prisma Client can read/write them. **Never run `prisma migrate
  dev|deploy` from this project** — only `prisma generate`.
- **M-Pesa**: this app has no Daraja credentials. The public pay page
  (`/pay/[token]`) calls byg-global's `/api/payments/mpesa/hosting/initialize`
  directly from the browser (cross-origin fetch, CORS-allowed for this app's
  origin via byg-global's `HOSTING_APP_ALLOWED_ORIGINS`). Settlement (the
  M-Pesa webhook) also lives in byg-global, since that's where Safaricom's
  callback URL is registered.
- **Email**: sent independently via the same shared n8n "send-email" webhook
  byg-global uses (own env vars, same shared secret) — no runtime call into
  byg-global for this.
- **Auth**: single-operator password gate (`HOSTING_ADMIN_PASSWORD`), no user
  table, no shared session with byg-global. See `src/middleware.ts`.
- **Ops alerting**: overdue invoices are only logged (`console.warn`) right
  now — they are *not* pushed into byg-global's Ops Inbox, since that would
  require a second, reverse cross-project dependency this app doesn't have
  yet. Revisit if that visibility gap becomes a problem in practice.

## Running locally

```bash
cp .env.example .env.local   # fill in DATABASE_URL (same as byg-global), etc.
npm install
npx prisma generate
npm run dev                  # http://localhost:3100
```

## Billing cycle

Nothing runs automatically. `POST /api/cron/billing-cycle` (header
`x-internal-key: $HOSTING_AUTOMATION_KEY`) generates upcoming invoices,
sends due/overdue reminder emails, and marks invoices overdue. Schedule it
to run daily from n8n or any external cron — same pattern byg-global uses
for its own automation routes.

## Deployment

Not yet wired into CAPTYN's VPS/nginx topology — this only covers the
application code. Runs on port 3100 by default (`npm run dev` / `npm start`).
