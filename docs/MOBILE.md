# Building the mobile app (iOS / Android)

VantixGym ships as native store apps from the same codebase (Capacitor shell, `VITE_MOBILE=1`).
Since 2026-10-01 the store build is a real client of the hosted service:

| | **Web / PWA** (app.vantixgym.app) | **Store app** (`npm run build:mobile`) |
|---|---|---|
| Accounts | email + password, passkey optional | same account, email + password (passkeys need associated domains — later) |
| Session | HttpOnly cookie | bearer token from `/api/auth/*` with `client: "mobile"`, kept in `@capacitor/preferences`, 180 days, revoked by `sv` like cookies |
| Data | synced to the server | synced to the server **and** mirrored to a file in the app sandbox (offline copy) |
| AI, billing, paywall | server | server (same `/api`, base URL baked in via `VITE_API_BASE`) |
| Reminders | Web Push | native local notifications |
| Steps / weight | typed by hand | **Apple Health / Health Connect** (`capacitor-health`, read-only: steps + weight), Settings → Health |
| Exercise media | served by nginx | jsDelivr CDN |

Identifiers: app id `app.vantixgym.mobile`, name `VantixGym`, icons/splash generated from the
brand mark (see `frontend/src/components/Logo.jsx`). The server allows the shells' origins
(`capacitor://localhost`, `https://localhost`) for state-changing calls.

## Health (Apple Health / Health Connect)

- Plugin `capacitor-health@7`. Permissions requested: `READ_STEPS`, `READ_WEIGHT` only.
- iOS: `App.entitlements` has the HealthKit capability; `Info.plist` has the two usage strings.
  In Xcode the **HealthKit** capability must also be turned on for the bundle id in the Apple
  developer portal (Signing & Capabilities → + HealthKit) the first time.
- Android: manifest declares the two health permissions, the `<queries>` entry and the
  rationale activity/alias the plugin needs. Health Connect must be installed on the phone
  (Android 14+ has it built in); the Settings card sends older phones to the Play Store listing.
- Sync: on launch and whenever the app returns to the foreground (`lib/health.js`). Days from
  the phone are written with `src: 'health'` and win over manual steps; weights typed by hand
  are never overwritten.

## Store checklist (what the owner does)

1. Apple Developer Program (US$99/yr) and Google Play Console (US$25 once). Enrol in Apple's
   Small Business Program and Google's 15 % tier before launch.
2. In-app subscriptions: Apple and Google require their own billing for digital subscriptions.
   Plan: RevenueCat (`@revenuecat/purchases-capacitor`) feeding the same `tierUntil` on the user
   record through `/api/billing/webhook` (provider `apple` / `google`). Not built yet — see
   docs/BILLING.md. Until then the store build shows the paywall but cannot sell.
3. Google Play: closed test with 12 testers for 14 days before production is unlocked.
4. Listings: screenshots (6.7", 6.5", 5.5" iPhone; phone + 7" tablet Android), description,
   privacy policy URL (`https://app.vantixgym.app/#/privacy`), data-safety form (email, health
   data read-only, no ads/tracking), a test account with an active plan for the reviewers.
5. Health data review notes: explain steps/weight are read to show them next to training and
   for coaching; no data is written back; HealthKit data is never used for advertising.

## Prerequisites

- Node 20+
- **Android:** Android Studio (bundles the SDK). Java 21 for Gradle.
- **iOS:** a Mac with Xcode 15+ and CocoaPods (`brew install cocoapods`). A free Apple ID
  is enough to run the app on your own iPhone (see below); paid membership is only needed
  for App Store distribution, which openGym doesn't do.

## Build & run

```sh
cd frontend
npm install
npm run build:mobile        # VITE_MOBILE + VITE_API_BASE build, `cap sync android`, `cap copy ios`

npx cap open android        # opens Android Studio → run on emulator or device
cd ios/App && pod install    # once per new plugin (CocoaPods: brew install cocoapods)
npx cap open ios            # opens Xcode (Mac only) → set your signing team, then run
```

`npm run build:mobile` bakes the CDN media base into the bundle and copies the web build
into both native projects — re-run it after every web-code change before building natively.

> **Heads-up:** after `build:mobile`, `frontend/dist` contains the *mobile* bundle.
> Run a plain `npm run build` again before deploying `dist` to a server.

## App icons & splash screens

`frontend/resources/icon.svg` is the 1024×1024 source (the app's dumbbell glyph on the
app background). Generate all platform assets from it on a machine with the tooling:

```sh
cd frontend
npx @capacitor/assets generate --iconBackgroundColor '#0c0e12' --splashBackgroundColor '#0c0e12'
```

(If the generator won't take the SVG directly, export it to `resources/icon.png` at
1024×1024 first — any image tool can do it.)

## Distribution — deliberately no app stores

openGym's mobile app is not on the Play Store or App Store, and that's a choice: no store
accounts, no store rules, no yearly fees between you and an open-source app.

### Android — sideload the APK

The official signed APK is at **[opengym.duarte-santos.ch](https://opengym.duarte-santos.ch)**.
Android asks you to allow installs from the browser the first time — that's standard for any
app outside the Play Store.

To build and sign your own:

```sh
cd frontend && npm run build:mobile
cd android && ./gradlew assembleRelease            # → app/build/outputs/apk/release/app-release-unsigned.apk

# one-time: create a keystore. KEEP IT — updates must be signed with the same key,
# or Android refuses to install the new version over the old one.
keytool -genkeypair -keystore my.keystore -alias opengym -keyalg RSA -validity 10950

# align + sign (zipalign/apksigner ship with the Android SDK build-tools)
zipalign -f -p 4 app-release-unsigned.apk aligned.apk
apksigner sign --ks my.keystore --ks-key-alias opengym --out openGym.apk aligned.apk
```

### iPhone — what's actually possible

Apple does not allow installing apps outside the App Store, so there is no `.ipa` download
that would simply install. Your free options:

- **Self-host + PWA** (recommended): open your instance in Safari → Share → *Add to Home
  Screen*. Full-screen app, no expiry, plus sync and passkeys.
- **Xcode free signing:** open `ios/` in Xcode with a free Apple ID as the team and run it
  onto your own iPhone. Apple expires the signature after 7 days; re-run from Xcode to renew.
- **AltStore:** automates that 7-day re-signing over Wi-Fi via a Mac companion app.

### Release notes for maintainers

- Bump `versionName`/`versionCode` in `android/app/build.gradle` per release; keep them in
  step with `frontend/package.json`. `versionCode` must strictly increase or updates won't
  install over an existing APK.
- **License:** openGym is AGPL-3.0, which by itself sits badly with app-store terms of
  service. `NOTICE.md` carries an app-store exception (an additional permission under
  AGPL §7) granted by the copyright holder — relevant only if store distribution ever happens.
- The app requests notification permission only when the workout-day reminder is switched
  on, and (on Android) declares `SCHEDULE_EXACT_ALARM` so the reminder fires to the minute
  where the user allows it.
