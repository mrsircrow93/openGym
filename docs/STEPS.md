# Step counter

What exists: a daily step log with a goal, quick "+500 / +1000 / set total" entry, a 7-day bar
strip, a streak, and a rough distance/calorie read-out. Data: `S.steps = [{ d, n, src }]`,
`S.stepGoal` (default 8 000). Maths in `lib/steps.js` (tested), UI in `sheets-steps.jsx` and the
Home card.

Why manual first: browsers have no pedometer API. `DeviceMotion` only runs while the page is
open in the foreground, so a web "counter" would miss most of the day and read wrong on a
desk. Hand entry from the phone's own health app takes five seconds and is exact.

## Native source (mobile builds — backlog #13)

The store builds can read the phone's own count. Plan:

- iOS: HealthKit `HKQuantityTypeIdentifierStepCount`, daily sum, via a Capacitor HealthKit
  plugin. Needs the HealthKit capability + `NSHealthShareUsageDescription`.
- Android: Health Connect `StepsRecord`, daily aggregate, via a Capacitor Health Connect
  plugin. Needs the `android.permission.health.READ_STEPS` permission and the Health Connect
  app installed (bundled on Android 14+).
- Adapter: `lib/steps-native.js` exposing `available()`, `requestPermission()`, `today()`,
  `range(fromIso, toIso)`. On app foreground and every 15 min while open, call `range` for the
  last 7 days and `setSteps(S, d, n, 'health')` for each day. `src:'health'` rows are read-only
  in the UI (the +500 buttons hide) — the phone's number wins.
- Settings → "Steps source": Manual / Phone (health app), with the permission prompt.
- Pick the plugin at implementation time from what is maintained then; verify the exact API in
  its README before writing the adapter. Do not guess method names.

## Not planned

- A web `DeviceMotion` counter: inaccurate and only while the tab is open.
- Writing steps back to HealthKit / Health Connect: openGym is a consumer, not a source.
