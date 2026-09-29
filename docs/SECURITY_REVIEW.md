# Security review — September 2026

Scope: `api/server.js`, `web/nginx.conf`, Docker/Compose, `netlify.toml`, the React client,
the service worker, the mobile (Capacitor) config, and the git history for leaked secrets.
Method: manual code review of every route and every place untrusted data enters, plus
`npm audit`. Result: no critical findings; the hardening below is applied in the repo.

## What was already right

- Passkeys via `@simplewebauthn/server`: origin and RP id checked, signature counter updated,
  discoverable credentials, challenge single-use with 5-minute TTL.
- Sessions: HMAC-SHA256 signed cookie, random 32-byte secret (`data/secret`, mode 600),
  `HttpOnly; Secure; SameSite=Lax`, 90-day expiry baked into the token, per-user version (`sv`)
  for "sign out everywhere", disabled accounts refused on every request.
- Admin routes behind `requireAdmin`; admins matched by uid from env.
- Every AI input is length-capped and typed; exercise ids from the model are re-validated
  against the candidates the client sent; images capped at 4 M base64 chars.
- Client: no `innerHTML`/`eval`; every `target=_blank` has `rel=noopener`; the printable plan
  escapes all text; the service worker never caches `/api`; the user's Anthropic key lives in
  `localStorage` only, is sent only to `api.anthropic.com`, and is not part of backups or
  shared plans.
- `.env` and `data/` are git-ignored and were never committed. Mobile: `allowMixedContent:false`.

## Findings and fixes

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | Medium | No security headers anywhere (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy). | Full header set in `web/nginx.conf` and `netlify.toml`. CSP: `script-src 'self'`, `connect-src 'self' https://api.anthropic.com`, `frame-ancestors 'none'`, inline styles allowed (React style attrs + print view). |
| 2 | Medium | No rate limiting on registration/login (the server comment delegates it to the proxy; the proxy had none). Enables invite-code probing and mass sign-ups. | nginx `limit_req` zones: 3 r/s on `/api/(register\|login\|auth)/`, 20 r/s on `/api/`, keyed by `CF-Connecting-IP` behind Cloudflare. |
| 3 | Medium | Open registration + server-paid AI: per-user caps don't bound the total. | `AI_GLOBAL_MONTHLY_USD_CAP` (instance-wide kill switch). Recommendation: `INVITE_ONLY=1` until billing exists. |
| 4 | Medium | nginx default `client_max_body_size 1m` silently rejected large state syncs and meal photos; `proxy_read_timeout 60s` could cut trainer plans. | `client_max_body_size 6m`, `proxy_read_timeout 180s` on `/api/`. |
| 5 | Low | No Origin check on state-changing requests (SameSite=Lax was the only CSRF defence). | Requests with a present, non-allowed `Origin` are refused (403); `ALLOWED_ORIGINS` env for the mobile app. |
| 6 | Low | `Object.assign(clone(DEF), json)` honours `__proto__` keys from backups, sync replies and plan files (object-local prototype override). | `JSON.parse` reviver dropping `__proto__`/`constructor`/`prototype` on the server body parser and on every client entry point (`useStore`, `api()`, backup import, plan import). |
| 7 | Low | API container ran as root, image built with `npm install`. | `USER node`, `npm ci --omit=dev`, `/data` chowned in the image. Linux hosts: `chown -R 1000:1000 data`. |
| 8 | Info | WebAuthn errors echoed library messages; `/api/health` exposed the user count. | Generic messages; count removed. |
| 9 | Info | Passkeys accept `userVerification: preferred` (no biometric/PIN required). Deliberate usability trade-off. | Kept; revisit if accounts hold payment data. |
| 10 | Info | The Anthropic key in `.env` was rejected by the API as invalid. | Rotate it in the Anthropic console regardless. |

## Dependency audit

Run `npm audit --omit=dev` in `frontend/` and `npm audit` in `api/` on every release.

## Still to do before charging money

- Email accounts (`docs/ACCOUNTS.md`) with the lockout and token rules there.
- Webhook signature verification for Stripe and RevenueCat (`docs/BILLING.md`).
- Signed, short-lived URLs only for progress photos (`docs/PROGRESS_PHOTOS.md`).
- A daily encrypted backup of `data/` off the host (restic/rclone to R2 or similar).
- Log retention: nothing in the API logs bodies or tokens; keep it that way when adding routes.
