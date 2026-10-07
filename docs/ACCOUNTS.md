# Accounts — email + password next to passkeys, sign-in from the mobile app

Spec for Phase 1 of `ROADMAP.md`. Written so it can be implemented top to bottom without
further design decisions. Passkeys stay the recommended path; email is what billing, receipts
and account recovery need, and what the store apps can sign in with.

## 1. Data model (`data/db.json`)

`db.users[i]` gains:

| Field | Type | Notes |
|---|---|---|
| `email` | string, lowercase, trimmed | unique across users; optional for passkey-only legacy users |
| `emailVerified` | bool | gates billing checkout and password reset |
| `pw` | string | `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`; absent for passkey-only users |
| `pwChangedAt` | ISO | bumps `sv` so old sessions die on password change |
| `tier`, `tierUntil`, `trialEnds`, `provider` | see BILLING.md | added here so the record is final |
| `deletedAt` | ISO or absent | soft-delete marker; hard purge after 30 days by a daily job |

New collection `db.tokens[]`: `{ id, userId, kind: 'verify'|'reset'|'mobile', hash, exp, used }`.
Only the **hash** (sha256) of a token is stored; the raw token travels in the email link or to
the phone and is never persisted.

Sessions stay as they are (signed cookie, `sv` versioning). The mobile app uses the same
signed token in an `Authorization: Bearer` header instead of a cookie (section 5).

## 2. Password hashing

`crypto.scrypt` from Node — no new dependency. Parameters `N=2^15, r=8, p=1, keylen=32`,
16-byte random salt, compare with `crypto.timingSafeEqual`. Encode as
`scrypt$32768$8$1$<salt>$<hash>` so parameters can be raised later and old hashes still
verify (re-hash on next successful login when parameters differ).

Password policy: 8–128 characters, anything allowed, no composition rules; reject the top
10k breached passwords list bundled as a 100 KB text file (`api/common-passwords.txt`).
Never log passwords, never echo them, never send them by email.

## 3. Endpoints

All under `/api/auth/`. Every POST goes through the Origin check and the nginx `auth`
rate-limit zone (`location ~ ^/api/(register|login|auth)/`, already in `web/nginx.conf`).
Errors are generic on purpose — the same "invalid email or password" whether the email
exists or not.

| Route | Body | Result | Notes |
|---|---|---|---|
| `POST /api/auth/register` | `{ email, password, name, code? }` | 200 `{ user }` + session cookie | respects `INVITE_ONLY`; sends verify mail; `emailVerified:false` |
| `POST /api/auth/login` | `{ email, password }` | 200 `{ user }` + session cookie | 401 on mismatch; 403 if `disabled`; per-account lockout below |
| `POST /api/auth/verify` | `{ token }` | 200 | marks `emailVerified`; token single-use, 24 h |
| `POST /api/auth/resend-verify` | — (session) | 200 | max 3 per hour per user |
| `POST /api/auth/forgot` | `{ email }` | 200 always | sends reset mail if the email exists; 1 h token; max 3 per hour per email |
| `POST /api/auth/reset` | `{ token, password }` | 200 | sets `pw`, bumps `sv` (signs out everywhere), consumes token |
| `POST /api/auth/password` | `{ current, next }` (session) | 200 | bumps `sv`, re-issues the caller's cookie |
| `POST /api/auth/email` | `{ password, email }` (session) | 200 | changes email, resets `emailVerified`, sends verify mail |
| `POST /api/auth/link-email` | `{ email, password }` (session) | 200 | passkey-only user adds email+password to the same account |
| `POST /api/auth/mobile/token` | `{ email, password }` | 200 `{ token, user }` | bearer token for the store app, 180 days, revocable via `sv` |
| `DELETE /api/account` | `{ password }` (session) | 200 | soft-delete: `deletedAt`, `sv++`, push subs removed, presence dropped; purge job deletes state file, creds, tokens, aiUsage, photos after 30 days |

`GET /api/me` adds `email`, `emailVerified`, `hasPassword`, `hasPasskey` so Settings can show
what is set up and offer the missing one.

### Brute force

- nginx: 3 req/s per IP on the auth locations.
- Per account: after 5 failed logins in 15 min, `login` answers 429 with `retryAfter` for 15
  min. Counter in memory (`Map<email, [timestamps]>`), same pattern as `aiRateLimited`.
- `forgot` and `resend-verify` are rate-limited per email and per IP, and always return 200.

## 4. Email

Provider: **Resend** (free to 3 000/month, one env var `RESEND_API_KEY`, plain `fetch` to
`https://api.resend.com/emails` — no SDK). Sender `EMAIL_FROM` (e.g.
`openGym <no-reply@gym.pentaforge.com.mx>`); set SPF/DKIM on the domain first or the mails land
in spam.

Templates (plain text + minimal HTML, Spanish and English chosen by the user's `S.lang`,
default `es`):

1. **Verify** — `${ORIGIN}/#/verify?token=…` — "Confirma tu correo", 24 h.
2. **Reset** — `${ORIGIN}/#/reset?token=…` — "Restablece tu contraseña", 1 h, "si no fuiste tú, ignora este correo".
3. **Password changed / email changed** — notice only, with a "sign out everywhere" link.
4. **Account deleted** — notice; 30-day undo by signing in again.
5. (Billing, later) receipt, trial ending in 2 days, payment failed.

Without `RESEND_API_KEY` the server logs the link to stdout (dev) and the UI says
"check the server log" — keeps local development working.

## 5. Mobile app (Capacitor build) sign-in

Today the mobile build is offline guest mode. Changes:

1. `VITE_API_BASE` env for the mobile build (`https://app.vantixgym.app`); `api()` prefixes it.
2. WebView cookies are unreliable across restarts → the app stores the bearer token from
   `POST /api/auth/mobile/token` in secure storage (Keychain / EncryptedSharedPreferences via
   `@capacitor/preferences` + the secure-storage plugin), and `api()` sends
   `Authorization: Bearer <token>` when present. Server: `readSession` reads the cookie **or**
   the bearer header; same signed payload, same `sv` revocation.
3. `ALLOWED_ORIGINS=capacitor://localhost,https://localhost,http://localhost` on the server.
4. Passkeys inside the app need associated-domains / Digital Asset Links. Ship email+password
   first; passkey-in-app is a follow-up.
5. Sign-out clears the token from secure storage and calls `/api/logout`.

## 6. Client UI

- **Login screen**: two tabs, "Passkey" (current) and "Correo". Correo has sign-in, "crear
  cuenta", "olvidé mi contraseña". Guest mode stays as the small link at the bottom.
- **Routes**: `/#/verify?token=`, `/#/reset?token=` — handled in `App.jsx` before auth
  (the user may not be signed in). Verify shows a one-line result and continues to Home.
- **Settings → Account**: email row with "verificar" badge if pending, "cambiar contraseña",
  "cambiar correo", "añadir passkey" / "añadir contraseña" depending on what's missing,
  "eliminar cuenta" (danger, asks for password).
- **Banner**: while `emailVerified` is false, a dismissible line on Home: "Confirma tu correo
  para activar la prueba / el pago" — billing checkout refuses unverified emails.
- Strings go to `locales/es.js` as usual.

## 7. Env

```
RESEND_API_KEY=            # optional in dev (links go to the server log)
EMAIL_FROM="openGym <no-reply@gym.pentaforge.com.mx>"
ALLOWED_ORIGINS=capacitor://localhost,https://localhost
```

## 8. Tests

- scrypt hash/verify round-trip; wrong password fails; parameter upgrade re-hashes.
- register → verify → login → password change invalidates the old cookie (`sv`).
- forgot/reset: token single-use, expired token refused, reset bumps `sv`.
- lockout after 5 failures; clears after 15 min.
- `link-email` on a passkey-only account keeps the same `id` and state file.
- `DELETE /api/account` hides the user from admin lists, refuses login, purge job removes files.
- mobile bearer token accepted by `readSession`; revoked by `logout/all`.

## 9. Order of implementation

1. Server: hashing helper, user fields, `/register` `/login`, bearer support in `readSession`.
2. Server: tokens collection, email sender, `/verify` `/forgot` `/reset` `/password` `/email`.
3. Client: Login tabs, verify/reset routes, Settings rows, banner.
4. Server + client: `link-email`, `DELETE /api/account` + purge job.
5. Mobile: `VITE_API_BASE`, secure token storage, sign-in screen; `ALLOWED_ORIGINS`.
6. Docs: SELF_HOSTING.md gains the email env vars; NETLIFY.md mentions the new routes.

## 10. "Continue with Google" (shipped 2026-10-02)

The client obtains a Google **ID token** (web: Google Identity Services button; store apps: the
native picker via `@capgo/capacitor-social-login`) and posts it to `POST /api/auth/google`.
`api/google.js` verifies it with Google's JWKS (RS256 signature, issuer, audience ∈ our client
ids, expiry, `email_verified`). No client secret, no server-side OAuth exchange, no password.

- Existing account with that email → linked (`googleSub`), email marked verified, normal session.
- No account → created like a password sign-up: trial, referral code, invite code, language.
- `pubUser.hasGoogle` tells the UI the account is linked. Deleting the account needs the
  password only when one exists; Google-only accounts just confirm.

Env on the API host: `GOOGLE_CLIENT_IDS=<web>,<ios>,<android>` (comma-separated; the first one
is what the web button uses and `GET /api/config` exposes as `googleClientId`). Unset = no button.
iOS build: `VITE_GOOGLE_IOS_CLIENT_ID=<ios>` in `frontend/.env.local`, plus the reversed id as a
URL scheme in `ios/App/App/Info.plist` (`CFBundleURLSchemes`). Android: register the SHA-1 of
the signing keystore on the Android client; the app itself only needs the web id.

Google Cloud setup (once, ~15 min): APIs & Services → OAuth consent screen (External, app name
VantixGym, support email, logo, privacy/terms links, scopes `email profile openid`, publish) →
Credentials → Create OAuth client ID three times: **Web** (authorised JavaScript origins
`https://app.vantixgym.app`; no redirect URI needed for the button), **iOS** (bundle id
`app.vantixgym.mobile`), **Android** (package `app.vantixgym.mobile` + SHA-1).

## 11. "Continue with Apple" (shipped 2026-10-02)

Same shape as Google (§10): the client obtains Apple's identity token (web: Apple JS SDK in
popup mode; iOS app: native sheet via `@capgo/capacitor-social-login`) and posts it to
`POST /api/auth/apple` with the name Apple returns on the first sign-in. `api/apple.js` verifies
RS256 against https://appleid.apple.com/auth/keys, issuer, audience ∈ `APPLE_CLIENT_IDS`, expiry.
Links by `appleSub`, then by email (relay addresses included); otherwise creates the account like
a password sign-up. `pubUser.hasApple`.

Env: `APPLE_CLIENT_IDS=<services id>,app.vantixgym.mobile` — the first is the web Services ID
that `GET /api/config` exposes as `appleClientId`. Unset = no button. The button shows on the web
and in the iOS app (Apple requires it on iOS when Google is offered); Android is not wired.

Apple Developer setup (once): Certificates, IDs & Profiles →
1. **Identifiers → App IDs → app.vantixgym.mobile**: capability "Sign in with Apple" (Xcode adds
   it through the entitlement with automatic signing; tick it by hand if the build complains).
2. **Identifiers → Services IDs → +**: identifier e.g. `app.vantixgym.web`, enable Sign in with
   Apple → Configure: primary App ID = app.vantixgym.mobile, domains `app.vantixgym.app`, return
   URLs `https://app.vantixgym.app/` (popup mode still needs one registered).
3. **Services → Sign in with Apple for Email Communication → Email Sources**: add the domain
   `vantixgym.app` and `soporte@vantixgym.app` / `no-reply@vantixgym.app`, so mails to relay
   addresses are delivered (SPF/DKIM already in place).

- Android OAuth client (Play app signing, created 2026-10-07): `918446786425-35ck551a9t9ph1pvhguaf7qd8o8tiip6.apps.googleusercontent.com`, package `app.vantixgym.mobile`, SHA-1 `8C:FE:B2:B7:DA:58:16:B6:DA:DC:CB:D5:B4:52:62:8A:F8:1B:6D:28`. The debug-signed client stays alongside it; an Android client holds one fingerprint each. The app authenticates with the *web* client id.
