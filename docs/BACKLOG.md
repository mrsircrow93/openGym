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
4. ✅ 2026-10-04 Anthropic spend limit set to $50/month with email alerts at $25 and $40 (Oct spend so far: $0.85). Raise it and `AI_GLOBAL_MONTHLY_USD_CAP` (now $20) at ~15 paying users (rule: $1.5 × paying users).
5. Legal entity name for terms, privacy and Stripe receipts.
6. ✅ 2026-10-04 Backup passphrase in the owner's password manager; S3 off-host copies live (bucket `vantixgym-backups-2026`); cron bug fixed (3 nights skipped).
7. Cloudflare: ✅ Bot Fight Mode on (webhooks verified with it on); delete the stray CNAME `app.vantixgym.app` in the pentaforge zone;
   optional Google brand verification (Search Console TXT, point consent-screen links to
   https://vantixgym.app/privacidad.html and /terminos.html).
8. Lightsail firewall: port 22 only.
9. Delete local `precios.txt`.
10. Real testimonials (first name, city/goal, 2–3 sentences, permission) → unhide the section.

### Pending — build (once the items above unlock them)

- Continue with Apple (needs #2). Same shape as Google: ID token verified server-side.
- ✅ 2026-10-03 In-app purchases via RevenueCat — sandbox purchase verified end to end on the owner's iPhone (INITIAL_PURCHASE → webhook → PRO). (iOS live in code; `REVENUECAT_WEBHOOK_AUTH` + webhook in the dashboard, optional `REVENUECAT_SECRET_KEY`). Android: add the Play app in RevenueCat and `VITE_RC_GOOGLE_KEY` once Play is approved. Owner: Apple Small Business Program (15 % instead of 30 %) before the first payout; optional introductory free trial on the ASC subscriptions.
- ✅ 2026-10-04 App Store: listing (es-MX + en-US copy, 24 framed screenshots, 4+, free, 175 territories, privacy labels, demo account) and **version 1.0 (build 25) submitted for review with the three subscriptions**. Generators: `frontend/scripts/store-shots.mjs` + `store-frames.py`; copy in docs/STORE_LISTING.md. Google Play listing still pending (reuse the same assets).
- Receipts/emails with the legal name (#5).
- Later: prompt caching, in-memory limiters to the DB if a second API container ever appears,
  passkeys inside the mobile app.

## Admin console

- ✅ 2026-10-05 v1 shipped (web only, additive; see docs/ADMIN_PANEL.md Status). Next: TOTP, Comms module, AI caps in UI, log shipping.

## v2 wishlist (owner, 2026-10-05) — after the 1.0 store launch

Suggested order by value/effort: 3 → 4 → 2 → 1.

1. **Sleep from a smartwatch** via Apple Health / Health Connect. `capacitor-health` has no sleep
   type: add a small native plugin (HKCategoryTypeIdentifier.sleepAnalysis / SleepSessionRecord)
   or switch plugin. Nightly duration (+stages when the watch provides them), 7-day card, coach
   context, badge. Web: manual entry.
2. **Distinct personalities for Sofía and Leo**: persona block in `coachSystemPrompt`, monthly
   photo note and drip copy; same evidence-based guard rails. Owner approves two briefs first.
3. **More active nutrition notifications** (local): meal-slot nudges when nothing is logged,
   water, evening protein gap; per-type toggles + quiet hours in Settings; opt-in.
4. **Supplements** (Nutrition tab): user-defined items (creatine, protein…), schedule by time and
   weekday, taken/skip log, streak + badge, local reminders (ids 300+), optional kcal/protein
   auto-add for shakes. Informational only, keeps the medical disclaimer.
5. **Photo / short video on custom exercises** (owner, 2026-10-05): when a person creates their
   own exercise, let them attach a reference photo or a clip of a few seconds. Needs: media
   upload route reusing `api/upload.js` checks (images now; video = MP4/MOV ≤ 15 s ≤ 10 MB with
   magic-byte + duration check, transcode/poster optional), per-user storage like progress photos
   (`/data/photos/<uid>`), size cap per user, show in the exercise sheet and during the workout,
   include in export/delete-account. Private to the user (no sharing) so no moderation needed.
