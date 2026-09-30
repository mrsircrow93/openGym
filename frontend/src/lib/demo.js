// Demo build (VITE_DEMO=1) — what runs on the GitHub Pages deployment.
//
// Pages can only serve static files, so there is no API: passkey sign-in, per-profile sync
// and the admin dashboard all need the Node backend and are simply not part of a demo build.
// The app therefore stays in guest mode (everything in localStorage) and boots with a seeded
// example history (demoSeed.js), so the charts, heatmap, streaks and "last time you lifted…"
// pre-fills have something to show instead of an empty shell.
//
// Only these three constants are shared with normal builds: Vite replaces VITE_DEMO at build
// time, so the demo-only UI folds away and the seed generator — imported dynamically — never
// lands in a self-hosted bundle.
export const DEMO = import.meta.env.VITE_DEMO === '1'
export const DEMO_SEEDED = 'gym_demo_seeded_v1'
export const REPO = 'https://github.com/mrsircrow93/openGym'

// Static build (VITE_STATIC=1) — a real, empty install with NO backend, meant for a free
// static host (e.g. Netlify without the API). Like the demo it stays in guest mode with data in
// this browser, but it does NOT seed example data — it's your own log from an empty start. The
// passkey/sync/push UI (which all need the server) folds away, and AI runs on the user's own key.
export const STATIC = import.meta.env.VITE_STATIC === '1'
