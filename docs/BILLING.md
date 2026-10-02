# Billing — plan for the paid tier

Not live. This documents the intended shape so features built now don't have to be rewired
later. Nothing in the app is gated yet; the hooks are in place.

## What exists today

| Piece | Where | State |
|---|---|---|
| Tier + feature matrix | `frontend/src/lib/entitlements.js` (`FEATURES`, `can(feature)`) | `can()` returns true for everything while `status.enabled` is false |
| Tier lookup | `GET /api/billing/status` | returns `{ enabled: false, tier: 'free' }` |
| Checkout / portal / webhook | `POST /api/billing/{checkout,portal,webhook}` | `501` stubs |
| Per-user AI spend + cap | `api/server.js` (`aiUsage`, `AI_MONTHLY_USD_CAP`) | live |
| Usage read-out | Settings → AI features | live |

Boot calls `refreshBilling()` when signed in, so the tier is known before any gated UI renders.

## Where to gate (when the switch flips)

Every premium surface should call `can('feature')` and, when false, open a small upsell sheet
(`startCheckout('pro')`) instead of the feature. The list:

- `can('ai')` — meal photos, corrections, trainer, coach, swaps, set parsing (server-paid path
  only; BYO key always passes).
- `can('trainer')` — the trainer sheet entry points (Home welcome card, Plan header).
- `can('mealPhotos')` — the camera buttons in Home / Nutrition.
- `can('progressPhotos')` — progress photo timeline (when built).

The server is the source of truth: each AI route already checks the monthly cap; add a tier
check next to it (`tierOf(user) === 'pro'`) so a modified client can't skip the gate.

## Providers — web vs. app stores

The same account must be Pro everywhere, so entitlement lives in **our** DB (`db.users[i].tier`,
`tierUntil`), and each provider just writes to it.

**Web (Netlify + this API): Stripe.**
1. `POST /api/billing/checkout` → create a Checkout Session (`mode: subscription`, price id
   from `STRIPE_PRICE_PRO_MONTHLY` / `_YEARLY`, `client_reference_id = user.id`), return `url`.
2. `POST /api/billing/webhook` → verify signature (`STRIPE_WEBHOOK_SECRET`), handle
   `checkout.session.completed`, `customer.subscription.updated/deleted` → set `tier`,
   `tierUntil`, `stripeCustomerId`; `saveDb()`.
3. `POST /api/billing/portal` → Stripe customer portal for cancel / card change.
4. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price ids. Test mode first.

**iOS / Android (Capacitor build): RevenueCat** (wraps StoreKit + Google Play Billing, handles
receipts and renewals, has a webhook).
1. `@revenuecat/purchases-capacitor`, `Purchases.configure({ apiKey, appUserID: user.id })`.
2. Paywall shows `Purchases.getOfferings()`, buys with `purchasePackage`.
3. RevenueCat webhook → the same `/api/billing/webhook` (branch on provider) → set tier.
4. Apple/Google take 15–30 %; price the store SKUs to net the same as Stripe, or accept the
   difference. Do not link to web checkout from inside the iOS app (App Store rule).

**Mobile build without backend** (current `build:mobile` is offline-first, guest mode): AI
already requires the user's own key there, so there is nothing to sell until the mobile build
talks to the API. First step for mobile billing is therefore sign-in from the app.

## Free vs Pro (proposal — see docs/AI_COSTS.md for the numbers)

| | Free | Pro ($4.99/mo · $39.99/yr) |
|---|---|---|
| Training log, plans, stats, water, meals by hand | ✓ | ✓ |
| AI with your own Anthropic key | ✓ | ✓ |
| Server-paid AI (meal photos, trainer, coach, swaps) | — | ✓, $3/mo cap |
| Progress photos | — | ✓ (storage) |
| Priority for new features | — | ✓ |

## Order of work when the time comes

1. `tier` on the user record + `tierOf()` helper; `GET /api/billing/status` reads it.
2. Server-side gate on AI routes and progress-photo routes.
3. Stripe checkout + webhook (test mode) → flip `enabled: true` on staging.
4. Upsell sheet in the client behind `can()`.
5. RevenueCat for the store builds, after sign-in exists on mobile.
6. Admin: MRR, churn, per-user AI spend vs plan price (`/api/admin/ai-usage` already there).

## Decisions so far (Sep 2026)

- **Prices (MXN, IVA included, same everywhere):** $129 / month · $779 / 6 months · $1,549 / year.
  The prepaid tiers are list prices; conversion comes from offers, not from a permanent
  strikethrough (PROFECO: a reference price must actually have been charged).
- **Offers:** intro offer on monthly (first month $79), launch price on annual ($1,290 =
  "2 months free", shown as "$107/mo vs $129"), referral and win-back coupons. All as Stripe
  coupons / store introductory & promotional offers — never hard-coded in the client.
- **Free trial: 7 days on every channel.** Store: introductory free trial via IAP. Web: Stripe
  trial, card required (AI tokens cost real money during the trial). One trial per account,
  AI cap during trial $1 USD.
- **Stores:** the app is free to download; the subscription is an in-app purchase (Apple's
  rules outside the US/EU don't allow steering to web payment; the multiplatform exception
  requires IAP to be offered too). Enrol in Apple's Small Business Program and Google's
  equivalent (15 %) before launch. One account = one subscription across web and stores.
- **Web:** Stripe, same prices, ~3.6 % + 3 MXN per charge — the channel with the best margin.
- **Net per typical user per month** (18.5 MXN/USD, Sonnet AI ≈ $1.45): web ≈ $5.60 → margin
  $4.15; store at 15 % ≈ $5.10 → $3.65; store at 30 % ≈ $4.20 → $2.75. Prepaid plans net the
  same ± a few cents (fewer transaction fees). Heavy users stay positive on every channel; keep
  `AI_MONTHLY_USD_CAP=2` as insurance anyway.
- **Server model:** `tier`, `tierUntil`, `trialEnds`, `provider` (stripe | apple | google) on the
  user record; `can()` is true while `now < trialEnds || now < tierUntil`.

## Referrals (live 2026-10-01)

Every account has a share code (`GET /api/referral`, Settings → Invite & earn; link
`https://app.vantixgym.app/?ref=CODE`). Sign-up takes an optional `ref`.

| Env | Default | Meaning |
|---|---|---|
| `REF_REFEREE_TRIAL_DAYS` | 7 | extra trial days for the friend (7 + 7 = 14) |
| `REF_REFERRER_DAYS` | 30 | days added to the referrer's access when the friend first pays (`rewardReferrer`, from the Stripe webhook) |
| `STRIPE_REFERRAL_COUPON` | — | optional Stripe coupon id applied to the friend's first checkout (replaces the promo-code box for that checkout) |

The referrer is rewarded once per friend, by email too. `INVITE_ONLY` is now off in production;
the invite code remains for private instances.

## Trial and pricing model (2026-10-02)

Prices: monthly $129, 6 months $599 ($99/mo, save 23%), yearly $999 ($83/mo, save 35%). The
plans screen (`views/Account.jsx` Plans) lists yearly first and preselected, shows the per-month
equivalent large with the monthly price struck through, the saving in pesos and percent, one
button whose copy depends on status, and the exact first-charge date.

Hybrid trial: no card to start (7 days). Activating a plan while the trial still has 48 h+ left
sets Stripe `trial_end` to trial end + `TRIAL_ACTIVATE_BONUS_DAYS` (7) with
`payment_method_collection=always`, so the card is captured now and the first charge lands later.
`GET /api/billing/plans` and `/status` return `firstChargeAt`, `bonusDays` and `rescueUntil`.

Rescue: set `STRIPE_RESCUE_COUPON` (a Stripe coupon) and for 48 h after a trial lapses the
6-month plan carries it; the plans screen shows the banner.

Drip (`trialTouch` in server.js, hourly): day 1 if nothing logged (email + push), day 3 "what the
app did for you" with the account's numbers, day 5 warning (email + push), day 6 week-in-numbers
with the yearly CTA, day 7 morning push, lapsed email (with the rescue line when active).
Stages are stored on the user (`trialMsgs`) so a restart never repeats one; emails only to
confirmed inboxes. Templates: `api/email.js` trialDay1 / trialDay3 / trialDay6 / trialLapsed.

Paywall moments: `#/plans` route (reachable from Settings → Subscription, the Home banner at
≤ 2 days left, and automatically after a 402 from any `/api/ai/*` call).
