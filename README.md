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
- **M-Pesa**: this app has no Daraja credentials. The pay pages
  (`/p/[token]`, and `/captyn-hosting/pay` on customer domains) post to this
  app, which calls byg-global's `/api/payments/mpesa/hosting/initialize`
  server-side (`BYG_GLOBAL_INTERNAL_URL`, else
  `NEXT_PUBLIC_BYG_GLOBAL_BASE_URL`). That route charges the service balance
  (or a smaller amount the payer picks) and records a pending payment. Settlement (the
  M-Pesa webhook) also lives in byg-global, since that's where Safaricom's
  callback URL is registered.
- **Email**: sent independently via the same shared n8n "send-email" webhook
  byg-global uses (own env vars, same shared secret) — no runtime call into
  byg-global for this.
- **Auth**: email/password login checked against byg-global's real `User`
  table (same DB, same bcrypt `passwordHash`, requires `isAdmin` + `active`
  status) — operators use their existing ecommerce admin credentials, no
  separate password for this app. This app's own session cookie is
  independent of byg-global's (no shared NextAuth session, no SSO). See
  `src/lib/adminAuth.ts` and `src/proxy.ts`.
- **Ops alerting**: overdue accounts are emailed and shown first on the
  dashboard; nothing is pushed into byg-global's Ops Inbox.

## Running locally

```bash
cp .env.example .env.local   # fill in DATABASE_URL (same as byg-global), etc.
npm install
npx prisma generate
npm run dev                  # http://localhost:3100
```

## Billing

- **Ledger**: balance = bills (`hosting_invoices`) − completed payments
  (`hosting_payments`). Payments settle the oldest bills first, so partial
  payments and overpayments need no allocation records. Rules live in
  `src/lib/ledger.ts` (pure).
- **Build fee**: a site can carry a build fee billed in monthly installments
  (`setupFeeKes` / `setupInstallmentKes`); hosting (`monthlyPriceKes`)
  starts the month after the build fee is fully billed.
- **First bill date** (`billingStartsAt`): adding a site with a past date
  bills those months immediately (no emails), so earlier payments can be
  recorded before the first notice goes out.
- **Statuses** follow the ledger: `active` (paid up), `payment_due`,
  `overdue`, `suspended`, plus `cancelled` set by hand.

## Daily run

`POST /api/cron/billing-cycle` (header `x-internal-key:
$HOSTING_AUTOMATION_KEY`) must run once a day. It creates bills due within
`invoiceLeadDays`, emails new bills, sends an overdue notice that sets the
pause date (`graceDays` out, repeated every 3 days), and pauses sites whose
pause date has passed (weekly paused reminders). A site is never paused
before an overdue notice carrying the date has been sent. From the VPS6 host:

```
0 6 * * * docker exec captyn-hosting sh -c 'wget -qO- --header="x-internal-key: $HOSTING_AUTOMATION_KEY" --post-data= http://127.0.0.1:3100/api/cron/billing-cycle' >> /var/log/captyn-hosting-billing.log 2>&1
```

## Customer domains (pause + pay on their domain)

A customer's HTTPS server block in the edge nginx template includes
`/etc/nginx/snippets/captyn-hosting-site.conf` (byg-global repo). Every
request asks `/api/site-status` (cached 20 s, fails open: if this app is
down the site is served); a paused site shows a neutral "temporarily
unavailable" page with a link to `https://<domain>/captyn-hosting/pay`,
which pays the balance by M-Pesa. Paying lifts the pause within a minute.
The hosting.captyn.shop block strips `X-Hosting-Domain` so only a customer
block can name the domain.

## Deployment (VPS6)

Lives at `https://hosting.captyn.shop`, deployed on VPS6 (`joe@62.171.175.255`)
— the same box that already runs byg-global's edge stack, plus small
client sites like `devoile_essentials_site` and `ideal-farm`.

- **Location**: `/home/joe/captyn-hosting` (`git clone` of this repo).
- **Network**: unlike the fully-isolated client sites (which reach nginx via
  `host.docker.internal:<port>`), this container joins the edge stack's
  existing `captyn_vps6_edge_captyn_network` (see `docker-compose.yml`) —
  needed so it can resolve `dataproxy` (byg-global's Postgres access point)
  the same way byg-global's own `frontend` service does. This also means
  nginx can reach it directly by container name (`captyn-hosting:3100`),
  no host port publish needed.
- **`.env`**: copy `.env.example` to `.env` on the server and fill in real
  values — `DATABASE_URL` and the `N8N_*` values should match byg-global's
  own runtime env on VPS6 (`DATABASE_URL` there points at `dataproxy:5432`).
  Generate fresh values for `HOSTING_SESSION_SECRET` and
  `HOSTING_AUTOMATION_KEY` — don't reuse byg-global's.
  `HOSTING_APP_BASE_URL=https://hosting.captyn.shop`,
  `NEXT_PUBLIC_BYG_GLOBAL_BASE_URL=https://captyn.shop`. No admin password
  to set — login uses the same `User` table as byg-global's admin login.
- **byg-global side**: its `HOSTING_APP_ALLOWED_ORIGINS` env var must include
  `https://hosting.captyn.shop` for the pay page's cross-origin STK-init
  call to be allowed, then the frontend container needs a restart to pick
  it up.
- **nginx**: add an upstream + HTTPS server block for `hosting.captyn.shop`
  in `byg-global/nginx/templates/captyn.vps1.conf.template` (modeled on the
  idealfarm/devoile blocks, but `proxy_pass http://captyn-hosting:3100`
  instead of `host.docker.internal`, since this container shares the
  network). Requires a Let's Encrypt cert for the hostname first (DNS must
  resolve before certbot's HTTP-01 challenge will pass), then
  `docker exec captyn_vps6_edge-nginx-1 nginx -s reload`.
- **DNS**: Cloudflare-managed, proxied (orange-clouded), A record →
  VPS6's public IP — same pattern as `idealfarm.captyn.shop`.

Build/run: `docker compose up -d --build` from `/home/joe/captyn-hosting`.
