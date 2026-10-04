# Backlog — by priority

Single ordered list of everything pending, top = do first. Each item names its spec. Tick
items as they ship; move things around here rather than in the phase docs.

| # | Item | Why this position | Spec | Size |
|---|---|---|---|---|
| 1 | ✅ 2026-09-29 — Turn on `INVITE_ONLY=1` and `AI_GLOBAL_MONTHLY_USD_CAP` on the live instance; rotate the Anthropic key | Zero-code, closes the only real cost exposure today | SECURITY_REVIEW.md #3, #10 | minutes |
| 2 | ✅ 2026-09-29 — Redeploy with the hardened nginx/Dockerfile (headers, rate limits, 6 MB bodies, 180 s AI timeout) | Fixes silent sync failures and adds the security headers; `docker compose up -d --build` | SECURITY_REVIEW.md | 1 h |
| 2.5 | ✅ 2026-10-01 — Live on Lightsail (Ohio) at app.vantixgym.app, daily snapshots, nightly encrypted `data/` archive (S3 copy pending a bucket, docs/BACKUPS.md) | The Mac can't be the production server once there are paying users or Stripe webhooks; also the missing backup | AWS.md | 1 afternoon |
| 3 | ✅ 2026-09-29 — Split AI models: `ANTHROPIC_MODEL_VISION` (Sonnet 5) / `ANTHROPIC_MODEL_TEXT` (Haiku 4.5) | Best quality where it matters, ~40 % cheaper overall; small server change | AI_COSTS.md lever 1 | 2 h |
| 4 | ✅ 2026-09-30 — Email + password accounts, verification, reset, lockout | Prerequisite for billing, receipts, recovery and the store apps | ACCOUNTS.md §1–4, 6 | 1 week |
| 5 | ✅ 2026-10-01 — Account deletion + 30-day purge; terms + privacy (refunds inside terms) at #/terms and #/privacy | Stores require deletion and legal pages; do it while accounts are fresh | ACCOUNTS.md §3 (DELETE), ROADMAP phase 1.5 | 2 days |
| 6 | ✅ 2026-10-01 — Resend live on vantixgym.app (auto-configured DNS), verification mail tested end to end | Needed by #4; also trial-ending and receipts later | ACCOUNTS.md §4 | 1 day |
| 7 | ✅ 2026-09-30 — Tier/trial fields, `GET /api/billing/status`, 7-day trial on sign-up, server-side gate on AI routes | Makes `can()` real; no user-visible change until checkout exists | BILLING.md "Order of work" 1–2 | 2 days |
| 8 | 🟡 2026-09-30 — Stripe checkout, portal and signed webhook shipped (trial is card-less at sign-up instead); needs the Stripe account, prices and keys | First revenue channel, best margin, no store review | BILLING.md | 1 week |
| 9 | 🟡 2026-09-30 — Paywall + plans from the server shipped; coupons via Stripe promotion codes (allowed at checkout) | Turns #8 on for users | BILLING.md "Offers" | 2 days |
| 10 | Mobile build signs in (API base, bearer token in secure storage, `ALLOWED_ORIGINS`) | Prerequisite for anything sold in the stores | ACCOUNTS.md §5 | 3 days |
| 11 | Apple Small Business + Google 15 % enrolment; store products with 7-day intro trial | Paperwork with lead time — start early, finish before #12 | BILLING.md "Stores" | 1 day + waiting |
| 12 | RevenueCat SDK + webhook → same tier record; store paywall | Second revenue channel | BILLING.md "Stores" | 1 week + review |
| 13 | Native step source in the mobile app (HealthKit / Health Connect) feeding `lib/steps.js` | Steps are logged by hand today; the phone already counts them | STEPS.md | 2 days |
| 14 | Progress photos: R2 bucket, signed routes, capture + compare UI | Pro feature that sells the subscription; storage cost negligible | PROGRESS_PHOTOS.md | 1 week |
| 15 | 🟡 2026-09-30 — AI spend card in the admin dashboard (per-user spend, cap hits) shipped; spend vs MRR still pending billing | Needed once real money flows; data already collected | AI_COSTS.md "What to watch" | 2 days |
| 16 | Prompt caching on the trainer prompt + exercise list; 800 px meal photos | Cost tuning once volume exists | AI_COSTS.md levers 2–3 | 1 day |
| 17 | 🟡 2026-10-01 — Encrypted nightly archive on the server; off-host S3 copy needs the bucket + IAM key (docs/BACKUPS.md) | Accounts and payments make data loss unacceptable | SECURITY_REVIEW.md "Still to do" | half a day |
| 18 | Passkeys inside the mobile app (associated domains / asset links) | Nice-to-have once email sign-in works in the app | ACCOUNTS.md §5.4 | 2 days |
| 19 | AI comparison of two progress photos (opt-in, Pro) | Later; needs #14 | PROGRESS_PHOTOS.md "AI on top" | 2 days |
| 20 | Referral coupons, Apple Health / Google Fit weight import, nutrition-aware coach | Growth and polish, after launch | ROADMAP.md "Later" | — |

Rule of thumb: #1–3 this week, #4–9 gets you a web product that charges, #10–12 gets you the
stores, #13+ is growth. Nothing below #9 blocks charging on the web.

## Status as of 2026-10-02 (end of session)

Shipped since the table above: email auth, Stripe (test mode, full flow), referrals, Google
sign-in (web + iOS + Android), progress photos with monthly coach note and reminder, routine and
diet import from photo/PDF (HEIC, PDFs to 12 MB), security pass (docs/SECURITY_REVIEW.md), new
pricing 129/599/999 with hybrid trial and drip messages (docs/BILLING.md), English marketing site.

### Pending — owner (needs the owner's accounts or decisions)

1. ✅ 2026-10-03 **Stripe live**: account active (charges + payouts), restricted key `rk_live_`
   (no money-moving permissions), three live prices, portal, webhook with 6 events, real
   checkout verified end to end (trial activation → trial_end + 7 days, 3 signed webhooks).
   Rescue coupon not created yet (`STRIPE_RESCUE_COUPON` unset).
2. ✅ 2026-10-03 Apple: program active, "Continue with Apple" live (Services ID app.vantixgym.web, Email Sources verified), build 2.0.0 (20) on TestFlight (internal group "Equipo VantixGym", app id 6818728682). Account is Individual → developer name shows the owner; convert to Organization (D-U-N-S) once the company exists.
3. ✅ 2026-10-02 Google Play Console account created (personal, vantixgym@gmail.com); identity
   verification pending. Personal accounts need a closed test with 12 testers for 14 days before
   production. Register production signing SHA-1 in Google Cloud (Android OAuth client).
4. Anthropic spend limit in the console; raise `AI_GLOBAL_MONTHLY_USD_CAP` (now $20) at ~15
   paying users (rule: $1.5 × paying users).
5. Legal entity name for terms, privacy and Stripe receipts.
6. Store the backup passphrase (`~/.backup-pass` on the server) in a password manager; S3 bucket
   + IAM key for off-host backups (docs/BACKUPS.md).
7. Cloudflare: Bot Fight Mode; delete the stray CNAME `app.vantixgym.app` in the pentaforge zone;
   optional Google brand verification (Search Console TXT, point consent-screen links to
   https://vantixgym.app/privacidad.html and /terminos.html).
8. Lightsail firewall: port 22 only.
9. Delete local `precios.txt`.
10. Real testimonials (first name, city/goal, 2–3 sentences, permission) → unhide the section.

### Pending — build (once the items above unlock them)

- Continue with Apple (needs #2). Same shape as Google: ID token verified server-side.
- In-app purchases via RevenueCat for iOS/Android with the same three plans (needs #2, #3).
- Store listings: icons, screenshots, copy, signed builds.
- Receipts/emails with the legal name (#5).
- Later: prompt caching, in-memory limiters to the DB if a second API container ever appears,
  passkeys inside the mobile app.
