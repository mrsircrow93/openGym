# Security review — October 2026 (second pass)

Scope: every route in `api/server.js` (2 000 lines read end to end), `api/upload.js`,
`api/password.js`, `api/email.js`, `web/nginx.conf`, Docker/Compose, the client's entry points
for untrusted data, and live tests against production with throw-away accounts. Classes checked:
authorization / IDOR, business logic (trial, referrals, billing), injection (JSON, path, header,
prompt), file upload, SSRF, CSRF/CORS, sessions, rate limiting, resource exhaustion, exposure.

## Findings and fixes (all applied in this commit)

| # | Sev | Finding | Fix |
|---|---|---|---|
| 1 | High | **Unverified disposable accounts could spend the AI budget.** Sign-up gave a 7-day trial with up to $1 of model calls before the email was ever confirmed; a script with throw-away addresses could burn the instance-wide cap. | AI routes answer `403 verify_required` for a trial whose email is unconfirmed (dispatcher, one place). Sign-ups limited to 5 per hour per IP. Client shows a plain "confirm your email first" message. |
| 2 | High | **Push subscription endpoint = SSRF.** `/api/push/subscribe` stored any URL; the server later POSTs to it (web-push), so a user could aim it at internal addresses. | Endpoint must be `https:` and on a real push service (Apple, Google, Mozilla, Microsoft); keys length-capped. |
| 3 | Medium | **Passkey sign-up bypassed the email-only policy.** `/api/register/options|verify` still created email-less accounts on the hosted instance (no trial, but a free account with sync and storage). | Both routes return 403 when `BILLING_ENABLED`; passkeys remain available as a second factor on existing accounts. |
| 4 | Medium | **Per-IP limits trusted `X-Forwarded-For`.** nginx appends to the client's own header, so the first entry was attacker-chosen; `forgot`'s per-IP limit could be bypassed. | `clientIp` reads `X-Real-IP` (set by nginx from `CF-Connecting-IP`). |
| 5 | Medium | **20 MB body on every route.** Raising the ceiling for PDFs applied to all JSON routes, including profile sync — 20 MB per account on disk, unbounded by anything but account count. | `readBody(req, max)`: 1 MB default, 8 MB for profile sync, 20 MB only on the five photo/PDF routes. |
| 6 | Medium | **Progress photos: 3 MB × 400 per account** = 1.2 GB of disk per user. | 700 KB per photo (the app sends ~150 KB); 400 cap and 30/day kept. |
| 7 | Low | **Origin reachable on port 8080** if the cloud firewall ever opens it: plain HTTP, and `CF-Connecting-IP`-keyed rate limits would be spoofable. | Compose binds the web port to `127.0.0.1`; only the tunnel on the host can reach it. |
| 8 | Low | Display names accepted control characters and line breaks; they appear in emails to other users (referral reward) and in the admin table. | `cleanName()` on both sign-up paths. HTML in emails was already escaped. |
| 9 | Info | Unreadable PDFs surfaced as 502 (looked like an outage; Cloudflare replaced the body). | Mapped to 400 with a plain message. |

## Verified safe (no change needed)

- **IDOR**: every data route derives the owner from the session; no route takes a user id from
  the client except `/api/admin/*` (behind `requireAdmin`). Photo ids are random 96-bit, looked
  up only inside the caller's own folder (`photoFile(user.id, id)`); live test: another account
  and an anonymous request get 404 / 401.
- **Admin**: matched by env `ADMIN_UIDS` or `admin:true` on the server record; nothing client
  supplied reaches the user record — profile sync writes a separate state file, never `db.users`.
- **Sessions**: HMAC-signed, expiry inside the token, per-user version bumped on password change,
  reset, sign-out-everywhere and deletion; disabled / soft-deleted users refused everywhere;
  `HttpOnly; Secure; SameSite=Lax` plus an Origin allowlist on every non-GET.
- **Passwords**: scrypt N=32768, 128-char cap (no hashing DoS), dummy-hash timing on unknown
  emails, 5 failures / 15 min lockout per account, nginx 3 r/s on auth paths.
- **Tokens** (verify / reset): 32 random bytes, only the SHA-256 stored, single use, one live
  token per kind, 24 h / 1 h expiry; reset also rotates sessions and confirms the email.
- **Billing**: Stripe webhook signature (HMAC, 5-min tolerance, constant-time compare), event-id
  idempotency, user resolved from subscription metadata / customer id, access never shortened
  before the paid period ends, checkout requires a verified email; nothing client-side can set
  `trialEnds`, `tierUntil` or `admin`.
- **Referrals**: reward only when the referred account's subscription becomes active, once per
  referee; codes are 4 letters + 4 random chars from a 32-symbol alphabet behind the auth rate
  limit; self-referral gains nothing without a real payment.
- **Uploads**: type decided by magic bytes, never by extension or declared type; malformed
  base64 and `data:` prefixes rejected; PDFs: size, 30-page cap, active-content markers in
  dictionaries (streams skipped to avoid false positives); files never logged, image/PDF bytes
  go to the model once; progress photos written with mode 600 under a per-user folder with
  sanitised ids; read back only by the owner with `Cache-Control: private`.
- **Injection**: JSON parsed with a reviver that drops `__proto__`/`constructor`/`prototype`
  on server and client; all path components pass through `safeId` / the state-file sanitiser;
  no shell, no SQL, no template engine; email HTML escapes user text; React escapes output and
  the client has no `innerHTML`.
- **Prompt injection**: a PDF or photo can only influence tool-schema output; exercise ids are
  re-validated against the client's own candidate list; coach context is the user's own data.
- **AI cost**: per-user monthly caps (trial $1), instance-wide cap, per-feature rate limits,
  vision model only where needed, review limited to 6 per 30 days.

## Residual risks and recommendations

- **Account lockout is per email**: five wrong guesses lock the real owner for 15 minutes.
  Acceptable trade-off for now; a CAPTCHA after the first lockout would remove the nuisance.
- **In-memory limiters** (login lockout, AI windows, sign-up per IP) reset on restart. Fine for
  one host; move to the JSON db or Redis before running more than one API container.
- **Email enumeration**: `register` returns 409 for an existing email (standard; `forgot` is
  silent). Consider a neutral message plus a "sign in instead" email if abuse appears.
- **Photos at rest** are not encrypted beyond disk permissions and the encrypted backup. For a
  stronger guarantee, encrypt each file with a per-user key derived from `data/secret`.
- **Dependencies**: run `npm audit --omit=dev` in `frontend/` and `npm audit` in `api/` on every
  release; keep the API container non-root (`docker-compose.aws.yml`).
- **Cloudflare**: turn on Bot Fight Mode and a rate-limiting rule on `/api/auth/*` at the edge
  as a second layer; keep the Lightsail firewall at 22 only (80/443 are not needed with the tunnel).

## Live tests run against production (throw-away accounts, deleted afterwards)

Photo IDOR (other account → 404, anonymous → 401), PNG as photo → 400, HTML renamed `.jpg` →
400, PDF with JavaScript → 400, `data:` prefix → 400, 10 MB PDF body accepted end to end,
routine and diet imports with real files, Stripe test checkout + cancel (earlier session).
