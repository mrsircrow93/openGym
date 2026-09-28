# Roadmap — from "everything is free" to a paid app in the stores

Status legend: ✅ built · 🧩 designed + stubbed · 📝 needs a design note · ⬜ not started.

## What is already done

- ✅ Backend: passkey accounts, sync, push, admin, all AI routes, per-user AI spend ledger,
  monthly AI cap (`AI_MONTHLY_USD_CAP`), `/api/ai/usage`, `/api/admin/ai-usage`.
- ✅ App: training log + plans, AI trainer, nutrition with meal photos + corrections,
  machine-photo swaps, swipe-to-edit routines. Spanish + 11 other UI languages.
- ✅ Deploys: static build on Netlify (BYO AI key), full stack on the self-hosted API.
- 🧩 Entitlements (`lib/entitlements.js`, `can()`), billing stubs, progress-photo stubs.
- 📄 Design notes: `AI_COSTS.md`, `BILLING.md`, `PROGRESS_PHOTOS.md`.

## Phase 1 — Accounts that can be billed (1–2 weeks)

Goal: every paying user has an email, can recover the account, and the mobile app talks to
the backend.

1. ⬜ Email + password sign-up/sign-in next to passkeys (`db.users[i].email`, hashed
   password, verification mail). Passkey stays the recommended path; email is what Stripe,
   receipts and account recovery need.
2. ⬜ Transactional email (Resend or Postmark): verification, receipt, trial-ending, reset.
3. ⬜ Mobile build signs in and syncs (today `build:mobile` is offline-only guest mode). Same
   `/api/*` calls, cookie → bearer token for the WebView.
4. ⬜ Account deletion endpoint (stores require it) + data export already exists.
5. ⬜ Legal pages: terms, privacy, refund policy (links from Settings and the store listings).

## Phase 2 — Billing on the web (1–2 weeks)

Per `docs/BILLING.md`.

1. ⬜ User record: `tier`, `tierUntil`, `trialEnds`, `provider`, `stripeCustomerId`.
2. ⬜ `GET /api/billing/status` reads them; `refreshBilling()` already consumes it.
3. ⬜ Stripe products/prices (MXN): 129/mo, 779/6mo, 1549/yr; coupons for intro/launch/referral.
4. ⬜ `POST /api/billing/checkout` (7-day trial, card required) and `/portal`.
5. ⬜ `POST /api/billing/webhook` → set tier/trial; `saveDb()`.
6. ⬜ Server-side gates on AI + progress-photo routes (`tierOf(user)`), AI cap per tier
   (trial $1, Pro $2).
7. ⬜ Paywall sheet in the app behind `can()`; pricing pulled from the server, never hard-coded.
8. ⬜ Flip `enabled: true` on staging, run the full trial → charge → cancel → win-back loop
   in Stripe test mode before production.

## Phase 3 — Billing in the stores (1 week + review time)

1. ⬜ Enrol: Apple Small Business Program, Google's 15 % tier.
2. ⬜ Products with a 7-day introductory free trial in App Store Connect and Play Console.
3. ⬜ RevenueCat SDK (`@revenuecat/purchases-capacitor`), `appUserID = user.id`.
4. ⬜ RevenueCat webhook → same `/api/billing/webhook` (branch on provider).
5. ⬜ Paywall shows store offerings on mobile, Stripe on web; never links to web payment
   from inside the iOS app.
6. ⬜ Store listings, screenshots, review notes (test account with Pro).

## Phase 4 — Progress photos (1 week)

Per `docs/PROGRESS_PHOTOS.md`. Pro feature.

1. ⬜ Cloudflare R2 bucket, env vars, `PROGRESS_PHOTOS=1`.
2. ⬜ Signed upload/get/delete routes replace the `501` stubs.
3. ⬜ Capture sheet, timeline card in Stats, compare view with slider.
4. ⬜ Delete prefix on account deletion.

## Phase 5 — AI cost tuning (days, ongoing)

1. ⬜ Split `ANTHROPIC_MODEL` into `_VISION` (Sonnet 5) and `_TEXT` (Haiku 4.5).
2. ⬜ Prompt caching on the trainer's system prompt + exercise list.
3. ⬜ Admin page for `/api/admin/ai-usage`: spend vs MRR, top users, cap hits.
4. ⬜ Review real ledger data after the first month; adjust caps/prices in `AI_COSTS.md`.

## Later / nice to have

- AI comparison of two progress photos (opt-in, Pro).
- Referral program (coupon per user, tracked in the ledger).
- Apple Health / Google Fit body-weight import.
- Coach read-out that also looks at nutrition adherence.

## Order of work, in one line

Accounts with email → Stripe on the web with the 7-day trial → paywall + gates → mobile
sign-in → RevenueCat → progress photos → cost tuning. Each phase ships on its own; the app
stays fully usable (and free) in between.
