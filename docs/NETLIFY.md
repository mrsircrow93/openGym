# Hosting openGym off your Mac

openGym has two parts:

- **Frontend** — the static React app (`frontend/`). Netlify hosts this perfectly.
- **Backend** — a stateful Node server (`api/`) that does passkey accounts, cross-device
  sync, push notifications and day reminders. It keeps user data in JSON files on a disk.
  **This cannot run on Netlify** — Netlify Functions are stateless and ephemeral, so there's
  nowhere for the accounts/data to live.

So there are three realistic shapes. Pick by what you need.

---

## Option A — Frontend on Netlify only (no backend)

The simplest way to get fully off your Mac. No accounts, no sync, no push — the app runs in
**guest mode**, storing everything in that browser's local storage. AI still works if each user
adds their **own** Anthropic key in Settings → AI features (it calls Anthropic directly from the
browser, no server needed).

1. In `netlify.toml`, delete the `/api/*` redirect block.
2. Connect the repo in Netlify. The included `netlify.toml` already sets:
   - base `frontend`, build `npm ci && npm run build`, publish `dist`
   - `/img` and `/gif` proxied to the exercise-media CDN (so you don't ship 140 MB)
3. Deploy.

Good for: a personal, single-device setup. Back up your data with Settings → Export.
Not good for: signing in on your phone *and* laptop and seeing the same history.

## Option B — Frontend on Netlify + backend on Render ✅ (full app: accounts, sync, push)

Best for "always running": the app itself is served from Netlify's CDN, so it always loads
instantly; only the API lives on Render. `render.yaml` in this repo is set up to deploy **just the
backend**.

**Cost note, up front:** to keep accounts, passkeys and history across restarts, Render needs a
**persistent disk**, and Render only allows disks on a **paid instance** (~$7/mo "Starter", the
plan set in `render.yaml`). The free plan has no disk (data wiped on each deploy) and sleeps when
idle. If you don't want to pay, use **Option A** instead — $0, but guest mode only.

Steps:

1. **Deploy the backend.** Render → **New → Blueprint** → pick this repo. It reads `render.yaml`
   and creates `opengym-api` with a 1 GB disk at `/data`. When prompted, set the two env vars
   (marked `sync:false`) — but you can only fill them *after* step 2 gives you the Netlify host,
   so do step 2 first, then come back:
   ```
   RP_ID  = your-site.netlify.app          (host only, no https://)
   ORIGIN = https://your-site.netlify.app
   ```
   `RP_NAME` and `DATA_DIR` are already set. `ANTHROPIC_API_KEY` is optional now (users bring
   their own key in Settings → AI features). Note the service URL, e.g.
   `https://opengym-api.onrender.com`.
2. **Deploy the frontend.** Netlify → add this repo. `netlify.toml` already sets the build. Edit
   its `/api/*` redirect `to` to your Render URL, e.g. `https://opengym-api.onrender.com/api/:splat`,
   and redeploy. Now you know the Netlify host — go set `RP_ID`/`ORIGIN` on Render (step 1).

Because the browser only ever talks to the Netlify origin (the `/api/*` proxy forwards to Render
server-side), the session cookie and passkeys stay same-origin and just work — **as long as the
backend's `RP_ID`/`ORIGIN` match your Netlify domain**.

> Passkeys are bound to the exact origin they were created on. If you later add a custom domain,
> update `RP_ID`/`ORIGIN` to it and re-register your passkey there. That's expected.

## Option C — Everything on one Docker host, skip Netlify

If you don't need Netlify at all, `docker-compose.yml` runs the whole app (frontend + backend +
media) as one stack on any Docker host (a small VPS, Fly, etc.), on one origin. Fewest moving
parts, but you manage the box.

---

## Which should you pick?

| You want…                                         | Option | Cost        |
|---------------------------------------------------|--------|-------------|
| Simplest, single device, no accounts              | **A**  | $0          |
| Netlify + real accounts & sync, "always running"  | **B**  | ~$7/mo      |
| One box, don't care about Netlify                  | **C**  | VPS cost    |

In all three, AI is free of the owner's key: anyone can paste their own Anthropic key in
**Settings → AI features** and it runs from their browser.
