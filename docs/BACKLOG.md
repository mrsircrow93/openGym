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

### Where things stand — 2026-10-12 (night)

Apple is live and selling. Android is fully configured and build 33 is uploaded. Nothing is
blocked on engineering; what remains is Google paperwork, testers, and one verification.

**Blocking the Play launch**
| # | Item | State |
|---|---|---|
| I | 12 testers opted in for 14 continuous days | 7 of 12 |
| E | RevenueCat "can validate purchases" turns green | waiting on Google propagation, up to 36 h |
| K | Licence-testing list, then one real Play purchase verified end to end | after E |
| D | Bank account on the Play payments profile | open — Google cannot pay out without it |
| B | Google 15 % service-fee programme | open, 2 min, banner on the Play payments page |

**Done 2026-10-12:** Play payments profile with the café as the public address; Google Cloud service
account and permissions; three Play subscriptions with activated base plans in all regions;
RevenueCat Play app, products, `vantixgym_pro` and the `default` offering carrying both stores;
versionCode 33 built, verified and uploaded; Apple Small Business Programme submitted; every
tester's trial extended rather than comped, which keeps the conversion metric honest.

**Product risk, not paperwork:** 8 of 11 testers have logged **zero** workouts. They installed and
left. That satisfies Google's counter but means nobody has really used the product, and an idle
tester is the first to uninstall — which resets the 14-day clock. It is also the strongest argument
for the first-run tutorial below.

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
5. Legal entity name **and a public business address** for terms, privacy, Stripe receipts and the
   Play store listing. Play publishes a physical address for anyone selling subscriptions, and the
   owner does not want his home on it (2026-10-12). The payments-profile address is separate and
   stays private, so it keeps the real fiscal address. Options: a mailbox / virtual office in San
   Luis (fastest, legal, unblocks today), or an S.A.S. — which would also let the Apple account
   convert to Organization so the listing reads VantixGym instead of "Daniel Oliva", though that
   needs a D-U-N-S number and weeks of waiting. Never a fabricated address: Google verifies and
   terminates for it.
6. ✅ 2026-10-04 Backup passphrase in the owner's password manager; S3 off-host copies live (bucket `vantixgym-backups-2026`); cron bug fixed (3 nights skipped).
7. Cloudflare: ✅ Bot Fight Mode on (webhooks verified with it on); delete the stray CNAME `app.vantixgym.app` in the pentaforge zone;
   optional Google brand verification (Search Console TXT, point consent-screen links to
   https://vantixgym.app/privacidad.html and /terminos.html).
8. Lightsail firewall: port 22 only.
9. Delete local `precios.txt`.
10. Real testimonials (first name, city/goal, 2–3 sentences, permission) → unhide the section.

### Pending — build (once the items above unlock them)

- ✅ Continue with Apple, ID token verified server-side (Services ID app.vantixgym.web).
- ✅ 2026-10-03 In-app purchases via RevenueCat — sandbox purchase verified end to end on the owner's iPhone (INITIAL_PURCHASE → webhook → PRO). (iOS live in code; `REVENUECAT_WEBHOOK_AUTH` + webhook in the dashboard, optional `REVENUECAT_SECRET_KEY`). Android: add the Play app in RevenueCat and `VITE_RC_GOOGLE_KEY` once Play is approved. Owner: Apple Small Business Program (15 % instead of 30 %) before the first payout; optional introductory free trial on the ASC subscriptions.
- ✅ 2026-10-12 **VantixGym 1.0 is live on the App Store** (build 33), with the three subscriptions
  APPROVED, after three review rounds. `https://apps.apple.com/mx/app/vantixgym/id6818728682`.
  Seller shows as "Daniel Oliva"; no address is published. Release type is AFTER_APPROVAL, so the
  next version goes live by itself once approved.
- 2026-10-06 **App Store review #1 rejected**, both issues fixed in build 26 and resubmitted:
  - *3.1.2(c)* the plans screen showed the per-month equivalent larger than the billed amount →
    the billed total is now the big number, the per-month figure sits under it small and dim, and
    the CTA reads "Suscribirme · $999 cada año".
  - *1.4.1* nutrition targets are health information and needed reachable citations → the sources
    sheet now lists Mifflin-St Jeor, Frankenfield, FAO/WHO/UNU, WHO, CDC, NHLBI, Hall, the ISSN
    protein position stand and the IOM AMDR as tappable links, and it is reachable from the
    Nutrition screen and the Daily-targets sheet, not only from inside the goal wizard.
- ✅ 2026-10-04 App Store: listing (es-MX + en-US copy, 24 framed screenshots, 4+, free, 175 territories, privacy labels, demo account) and **version 1.0 (build 25) submitted for review with the three subscriptions**. Generators: `frontend/scripts/store-shots.mjs` + `store-frames.py`; copy in docs/STORE_LISTING.md. Google Play listing still pending (reuse the same assets).
- Receipts/emails with the legal name (#5).
- Later: prompt caching, in-memory limiters to the DB if a second API container ever appears,
  passkeys inside the mobile app.

## Admin console

- ✅ 2026-10-05 v1 shipped (web only, additive; see docs/ADMIN_PANEL.md Status). Next: TOTP, Comms module, AI caps in UI, log shipping.

## v2 wishlist (owner, 2026-10-05) — after the 1.0 store launch

Suggested order by value/effort: 3 → 4 → 2 → 1.

1. ⏸ **Deferred to v2 by the owner (2026-10-07)** — **Sleep from a smartwatch** via Apple Health /
   Health Connect (whatever the user's watch already writes there; no per-brand integrations). `capacitor-health` has no sleep
   type: add a small native plugin (HKCategoryTypeIdentifier.sleepAnalysis / SleepSessionRecord)
   or switch plugin. Nightly duration (+stages when the watch provides them), 7-day card, coach
   context, badge. Web: manual entry.
2. **Distinct personalities for Sofía and Leo**: persona block in `coachSystemPrompt`, monthly
   photo note and drip copy; same evidence-based guard rails. Owner approves two briefs first.
3. ✅ 2026-10-06 **Nutrition notifications** (local, mobile builds): breakfast / lunch / dinner
   nudges for slots not logged, an afternoon water one (off by default) and an evening protein
   check, each with its own switch plus quiet hours in Settings → Notifications. Planned three
   days ahead and re-planned on every state change, because a local notification cannot test a
   condition when it fires; today's slots are skipped when already satisfied or already past.
   `nutritionNudges` in `lib/mobile.js`, ids 300–324, tests in `lib/nudges.test.js`.
4. ✅ 2026-10-06 **Supplements** (Nutrition tab): user-defined items with dose, unit, up to three
   times a day and chosen weekdays; today's doses tick off in the card, with a streak of fully
   kept days; local reminders at the user's own times (ids 400–489, quiet hours apply) behind
   their own switch in Settings. Presets (creatine, protein, vitamin D…) are starting points, not
   advice: the sheet states the app recommends neither substances nor doses.
   `lib/supplements.js` + `sheets-supplements.jsx`, tests in `lib/supplements.test.js`.
   Still open from the original idea: auto-adding a protein shake to the day's macros.
5. ✅ 2026-10-07 **Photo / short clip on custom exercises**: attach a reference photo or a clip of
   up to 8 s / 6 MB when creating or editing your own exercise; it shows in the exercise sheet and
   plays muted, looping and inline, so it reads like a GIF. Security: `inspectVideo` in
   `api/upload.js` walks the ISO base-media boxes, allows only known top-level box types and
   ftyp brands, and reads the duration from moov/mvhd — nothing is transcoded or executed; the
   type served comes from the stored id's last letter, never from the client. Files live in
   `/data/exmedia/<uid>`, 60 per account, 40 uploads a day, served only to their owner with
   `nosniff` + byte ranges (iOS needs ranges to play), and deleted with the exercise and with the
   account. Tests: `lib/exercise-media.test.js` (inspector, tampered and oversized files) and
   `lib/exmedia-server.test.js` (routes, cross-account access, path traversal, ranges).

## Next three features (owner, 2026-10-12), in the order they should be built

Suggested order is **rest timer → units per exercise → tutorial**: the timer is a day and fixes
something that breaks mid-set, the units question is the one that silently corrupts numbers if
rushed, and the tutorial is the biggest but least urgent of the three.

### 1. ✅ 2026-10-12 — Rest timer that survives the screen going off

The countdown is already built on an absolute `endsAt` (`useUI.startRest`), so elapsed time is
never lost — the bar reads correctly the moment you look again. What is missing is the *alert*: the
`setInterval` stops when the WebView is suspended, and the existing fallback is a **server Web
Push**, which does not reach a Capacitor build on either platform. So on a phone with the screen
off, nothing buzzes and the set is missed. That is the whole complaint.

Fix: in store builds, schedule a **local notification** for `endsAt` via the
`@capacitor/local-notifications` plugin already in the bundle, cancel it in `stopRest`, reschedule
in `addRest`. Keep the Web Push path for the browser. Reserve an id range of its own (the workout,
nutrition and supplement ranges are 100s, 300s and 400s). The notification must be
time-sensitive/high-priority so it fires through Do Not Disturb at the gym.

**The watch comes free with this.** A local notification is mirrored to a paired Apple Watch and to
Wear OS by the system, so the wrist buzzes with no extra work. A real watch *app* — starting and
skipping the timer from the wrist — is a separate native project (WatchKit target, Wear OS module)
that Capacitor does not cover, and is weeks, not days. Say so plainly rather than half-building it.

Size: 1 day including tests.

### 2. ✅ 2026-10-12 — A unit per exercise, not only per profile

A gym in Mexico mixes kilo machines with pound dumbbells, so one global unit is wrong for everybody
who trains in one.

**The trap:** weights are stored *as typed, in the profile unit* (`lib/units.js`), and switching the
unit rewrites every logged number through `convertProfile`. There is no canonical storage. So the
one thing this feature must not do is store mixed units — every PR, volume total, chart, progression
suggestion and AI prompt reads those numbers raw and would start comparing pounds against kilos.

Design: **storage stays in the profile unit; the override lives only at the edge.** An exercise gets
an optional display unit (`S.exUnits[exerciseId]`, absent = follow the profile). Input converts to
the profile unit on save; display converts back. Everything downstream is untouched. `roundPlate`
and `plateStep` take the exercise's unit so a pound dumbbell suggests 5 lb steps and a kilo machine
2.5 kg. The set row, the exercise sheet and the history line show the exercise's unit next to the
number, always — an unlabelled number is what makes this confusing today.

Also: `convertProfile` must leave `exUnits` alone, and the unit switch confirmation should say that
per-exercise choices are kept.

Size: 2 days, most of it the display paths and the tests.

**Shipped.** Storage is canonical kilograms behind a `wSchema` migration that runs on every path
state can enter by — local storage, a server pull, the native file mirror, the demo seed and an
imported backup. Switching a unit no longer rewrites a single logged number, which is what used to
turn 20 lb into 20.1. Three units can now disagree on purpose: `S.unit` for loads, `S.bwUnit` for
body weight, and `S.exUnits[id]` for one exercise, chosen in its config sheet. Verified against a
real pre-change pounds profile: 200 lb stores as 90.718 kg and reads back as exactly 200 lb, and
flipping the load unit to kilos left every stored number byte-identical.

### 3. First-run tutorial


A mini walkthrough the first time the app opens, skippable from the first step and never shown
again once finished or dismissed. Testers land on a full app with no idea where anything is.

Shape: 4 to 6 steps, each one sentence over the real screen, not a slideshow of mockups. Home and
the day's workout, starting and logging a set, the Nutrition tab and the photo of a meal, the
coach, and where the calendar and progress live. **Connecting a watch** gets its own step: testers
asked for it unprompted, and the Apple Health / Health Connect toggle is currently buried where
nobody finds it. Every step has **Saltar** as well as **Siguiente**,
and a **Ver el tutorial** entry in Settings so it can be replayed. State goes in `S.tourDone` so it
syncs and does not re-run on a second device. Do not gate anything behind it, and do not start it on
top of the sign-up flow — wait until the first Home render.

Size: 2 days. Worth doing before the Play production release, because it is the cheapest fix for
the "no entendí qué hacer" feedback.

## Mobile security review (OWASP MASVS) — pending, owner asked 2026-10-09

`docs/SECURITY_REVIEW.md` covers the server and the web app. The mobile builds have never been
reviewed as mobile: the threat model is different because the attacker has the device. Target
**MASVS v2, profile L1 + MASVS-PRIVACY**; L2 and MASVS-RESILIENCE are out of scope for now (we are
not a bank and anti-tampering buys little against a server-side entitlement check).

**Root / jailbreak blocking: decided against as a block, 2026-10-09.** Detection is bypassed in
minutes with Frida or Magisk, so it only stops people who were not the threat, while locking out
paying users on GrapheneOS or a custom ROM. What the thing an attacker would actually want to
forge — PRO status — is already settled server-side from the RevenueCat webhooks, and AI cost is
bounded by the per-user caps. The useful version is attestation as a *signal*: Play Integrity on
Android and App Attest on iOS, verified on the server, used to refuse the expensive AI routes or
flag an account, never to refuse to open the app. Queued behind the L1 work, which is worth more.

Run it as one pass over both platforms, writing findings into a new `docs/MASVS.md` with the MASTG
test id next to each. What matters here, by control group:

- **MASVS-STORAGE** — **known finding, confirmed 2026-10-09**: `lib/mobile.js` keeps the bearer
  token in `@capacitor/preferences`, which is `UserDefaults` on iOS and `SharedPreferences` on
  Android — a plain plist and a plain XML file, not Keychain or Keystore. On a jailbroken or rooted
  device, and in an unencrypted device backup, it is readable. Move it to real secure storage
  (`capacitor-secure-storage-plugin` or a small native wrapper over Keychain / EncryptedSharedPreferences),
  keeping `Preferences` as the fallback on the web build. Also:
  `android:allowBackup` and the iOS backup flags on anything holding the token or cached photos,
  no tokens or emails in logcat / os_log, no sensitive data left in the WebView cache or in
  `/data/exmedia` copies on the device, and the task-switcher snapshot on both platforms.
- **MASVS-CRYPTO** — little of our own crypto, but check the passkey and step-up paths use the
  platform APIs and nothing home-rolled, and that no key or secret is embedded in the bundle. The
  RevenueCat public key (`appl_…`) and the Google client ids are public by design; verify nothing
  else is (`scripts/check-mobile-bundle.mjs` already asserts the opposite direction).
- **MASVS-AUTH** — token lifetime and what happens on logout (server-side invalidation, not just a
  local wipe), lockout still enforced server-side when the client is modified, admin step-up cannot
  be reached from a mobile session, and the trial/entitlement gate is never trusted from the client.
- **MASVS-NETWORK** — cleartext disabled on Android (`usesCleartextTraffic=false`, network security
  config) and no `NSAllowsArbitraryLoads` on iOS; all traffic to `app.vantixgym.app` over TLS.
  Verify with the Burp MCP against a real device.
  **Certificate pinning: decided against, 2026-10-09.** The chain is Cloudflare-managed Let's
  Encrypt (leaf `CN=vantixgym.app`, 90 days, intermediate `YE2`, root ISRG). Cloudflare rotates the
  leaf automatically and may change issuer without notice, so a pin on the leaf expires in 90 days
  and a pin on the intermediate dies the day Cloudflare switches CA — in both cases for every
  already-installed copy, fixable only through a new build and an App Store review. The benefit is
  small anyway: intercepting a user's own traffic exposes that user's own token, and Android 7+
  already ignores user-installed CAs by default. Revisit only with a Cloudflare dedicated
  certificate we control, pinning the SPKI with a backup pin and a server-side kill switch.
- **MASVS-PLATFORM** — the WebView configuration Capacitor ships (file access, universal access from
  file URLs, JavaScript bridges), the `allowNavigation` allowlist, exported activities and
  receivers, and above all the **OAuth callback**: a custom scheme can be claimed by another app, so
  check the Google and Apple return paths use App Links / Universal Links with the asset-links and
  associated-domains files served, not a bare custom scheme.
- **MASVS-CODE** — enable R8/minify (already due by Feb 2027, see the Play notes), ship no source
  maps in the release bundle, `android:debuggable` false, dependency scan on both `npm audit` and
  Gradle, and a plan for forcing an upgrade when a bad version is in the wild.
- **MASVS-PRIVACY** — the Play data-safety form and the App Store privacy labels must match what the
  app actually sends; re-check after the supplements and exercise-media features. Confirm the
  advertising id stays absent from the built bundle (the Facebook SDK injects it; we strip it with
  `tools:node="remove"`).

Tooling: MobSF for the static pass on the `.aab`/`.ipa`, the Burp MCP for traffic, Frida/objection
for the storage and WebView checks on a rooted emulator. Size: 2–3 days, plus whatever the findings
cost. Do it before production on Play, not before the current reviews — it may need code changes and
a new build.
