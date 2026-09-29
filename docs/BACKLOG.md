# Backlog — by priority

Single ordered list of everything pending, top = do first. Each item names its spec. Tick
items as they ship; move things around here rather than in the phase docs.

| # | Item | Why this position | Spec | Size |
|---|---|---|---|---|
| 1 | Turn on `INVITE_ONLY=1` and `AI_GLOBAL_MONTHLY_USD_CAP` on the live instance; rotate the Anthropic key | Zero-code, closes the only real cost exposure today | SECURITY_REVIEW.md #3, #10 | minutes |
| 2 | Redeploy with the hardened nginx/Dockerfile (headers, rate limits, 6 MB bodies, 180 s AI timeout) | Fixes silent sync failures and adds the security headers; `docker compose up -d --build` | SECURITY_REVIEW.md | 1 h |
| 3 | Split AI models: `ANTHROPIC_MODEL_VISION` (Sonnet 5) / `ANTHROPIC_MODEL_TEXT` (Haiku 4.5) | Best quality where it matters, ~40 % cheaper overall; small server change | AI_COSTS.md lever 1 | 2 h |
| 4 | Email + password accounts, verification, reset, lockout | Prerequisite for billing, receipts, recovery and the store apps | ACCOUNTS.md §1–4, 6 | 1 week |
| 5 | Account deletion + 30-day purge; terms, privacy, refund pages | Stores require deletion and legal pages; do it while accounts are fresh | ACCOUNTS.md §3 (DELETE), ROADMAP phase 1.5 | 2 days |
| 6 | Transactional email (Resend, SPF/DKIM) | Needed by #4; also trial-ending and receipts later | ACCOUNTS.md §4 | 1 day |
| 7 | Tier/trial fields + `GET /api/billing/status` + server-side gates on AI and photo routes | Makes `can()` real; no user-visible change until checkout exists | BILLING.md "Order of work" 1–2 | 2 days |
| 8 | Stripe: products in MXN, 7-day trial with card, checkout, portal, webhook (test mode) | First revenue channel, best margin, no store review | BILLING.md | 1 week |
| 9 | Paywall sheet + pricing pulled from the server; intro/launch coupons | Turns #8 on for users | BILLING.md "Offers" | 2 days |
| 10 | Mobile build signs in (API base, bearer token in secure storage, `ALLOWED_ORIGINS`) | Prerequisite for anything sold in the stores | ACCOUNTS.md §5 | 3 days |
| 11 | Apple Small Business + Google 15 % enrolment; store products with 7-day intro trial | Paperwork with lead time — start early, finish before #12 | BILLING.md "Stores" | 1 day + waiting |
| 12 | RevenueCat SDK + webhook → same tier record; store paywall | Second revenue channel | BILLING.md "Stores" | 1 week + review |
| 13 | Native step source in the mobile app (HealthKit / Health Connect) feeding `lib/steps.js` | Steps are logged by hand today; the phone already counts them | STEPS.md | 2 days |
| 14 | Progress photos: R2 bucket, signed routes, capture + compare UI | Pro feature that sells the subscription; storage cost negligible | PROGRESS_PHOTOS.md | 1 week |
| 15 | Admin page for AI spend vs MRR, cap hits, top users | Needed once real money flows; data already collected | AI_COSTS.md "What to watch" | 2 days |
| 16 | Prompt caching on the trainer prompt + exercise list; 800 px meal photos | Cost tuning once volume exists | AI_COSTS.md levers 2–3 | 1 day |
| 17 | Encrypted off-host backup of `data/` (restic → R2, daily) | Accounts and payments make data loss unacceptable | SECURITY_REVIEW.md "Still to do" | half a day |
| 18 | Passkeys inside the mobile app (associated domains / asset links) | Nice-to-have once email sign-in works in the app | ACCOUNTS.md §5.4 | 2 days |
| 19 | AI comparison of two progress photos (opt-in, Pro) | Later; needs #14 | PROGRESS_PHOTOS.md "AI on top" | 2 days |
| 20 | Referral coupons, Apple Health / Google Fit weight import, nutrition-aware coach | Growth and polish, after launch | ROADMAP.md "Later" | — |

Rule of thumb: #1–3 this week, #4–9 gets you a web product that charges, #10–12 gets you the
stores, #13+ is growth. Nothing below #9 blocks charging on the web.
