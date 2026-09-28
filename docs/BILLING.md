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
