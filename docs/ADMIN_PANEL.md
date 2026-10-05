# Admin panel v2 — scope (owner request 2026-10-05, build after the 1.0 store launch)

Today's `/admin` (frontend/src/views/Admin.jsx, 7 routes under `/api/admin/*`) shows counts, AI
spend per user, invite codes and a user list with disable. It is a founder's dashboard, not an
operations console. This is the plan to make it one, security first, web only.

## Status (2026-10-05)

**Shipped (v1):** roles (`user.role`, legacy `admin`/`ADMIN_UIDS` migrated to `owner` at boot) with the
permission table in `api/admin.js`; step-up via password or passkey, 12 h, bound to IP prefix + user
agent, `Lock console` to drop it; hash-chained audit log at `/data/audit.log` (viewer, verify, NDJSON
export; also records password/email changes and sign-out-everywhere); request-log ring (3,000 entries,
paths/status only) + JSON lines on stdout; owner e-mail alerts (new device step-up, role change,
coupon > 50 %, 3 denials); 90 req/min per staff account. Modules: Overview (MRR estimate, trials,
conversion, DAU/WAU/MAU, AI spend, backup marker, "needs a human"), Users (filters, detail, resend
verify, extend trial ≤ 30 d, comp days, re-pull Stripe / re-sync store, sign out everywhere,
disable/enable, soft delete/restore, JSON export, internal notes, per-user audit), Billing (Stripe
subscriptions/invoices/balance, refunds for owner/finance, store subs, webhook health), Coupons
(Stripe coupons + promo codes, deactivate), Team (grant/change/remove roles on existing verified
accounts), Audit, Logs, System (kill switches for sign-ups / AI / web payments, maintenance banner
shown on Home, integrations with key prefixes, disk/db/backup). Test: `frontend/src/lib/admin-server.test.js`.

**Not yet:** TOTP as a step-up option, per-session device list (sessions are stateless tokens),
Comms module (segment announcements, drip template editor), AI caps editable from the UI, referral
fraud view, CloudWatch shipping of the JSON logs, impersonation ("view as"), audit log rotation.

## Security foundation (do first — everything else sits on it)

1. **Roles, not a boolean.** `user.role ∈ owner | admin | support | finance | viewer` replaces
   `user.admin`. Server-side permission table per route (e.g. support can read users and reset a
   session, cannot see revenue or change plans; finance sees Stripe/RevenueCat, cannot touch users).
   Owner only: role changes, coupons over X %, data export.
2. **Step-up auth for admin.** Admin routes require a session that passed 2FA in the last 12 h:
   passkey re-prompt (already have WebAuthn) or TOTP. Admin session TTL 12 h, bound to IP prefix +
   user agent; any 403 on an admin route bumps the user's session version (kills every session).
3. **Append-only audit log.** `db.audit` (later its own file, rotated): who, what, target, before →
   after diff, IP, UA, request id, timestamp. Written by a single `audit()` helper called from
   every admin mutation and from sensitive user events (login failures, password/email change,
   plan change, delete). Hash-chained (each entry stores sha256 of previous) so tampering shows.
   Viewer in the panel with filters + CSV export; never deletable from the UI.
4. **Rate limits & alerts for admin.** Separate limiter (20 req/min), alert email to owner on:
   new admin session from a new device, role change, coupon > 50 %, >3 failed step-ups.
5. **Headers/CSP already strict**; add `Permissions-Policy`, and serve `/admin` only to signed-in
   admins at the router level (unauthenticated users get the 404 page, not a login hint).
6. **Secrets hygiene page (read-only):** shows which integrations are configured (Stripe, RC,
   Google, Apple, SMTP, S3) with key *prefixes* and last-rotated dates; never values.

## Modules

- **Overview:** MRR, active subs by provider/plan, trial → paid conversion (7/30 d), churn, DAU/WAU,
  AI spend vs cap, error rate, last backup time + S3 status, queue of things needing a human
  (failed payments, refund requests, unverified >3 d).
- **Users:** search, filters (plan, provider, status, country, signup date), detail drawer: profile,
  entitlement timeline, devices/sessions (revoke one), AI usage, notes (internal), actions:
  resend verify, extend trial N days (audited, capped), grant comp days, disable/enable, GDPR
  export, delete (soft, 30 d). Impersonation **read-only** ("view as") with banner and audit.
- **Billing:** Stripe + RevenueCat side by side: subscriptions, invoices, failed payments with
  retry/portal link, refunds (owner/finance; Stripe only, store refunds link to the store),
  webhook health (last event per source, replay a failed event).
- **Coupons & promos:** create Stripe coupons/promo codes from the panel (percent/amount, duration,
  max redemptions, expiry, first-purchase only), plus "comp days" grants; redemptions report.
  Store side: links to ASC/Play offer codes (can't be created via API).
- **Referrals:** top referrers, rewards granted, fraud flags (same IP/device clusters).
- **Content/AI:** per-feature usage and cost, caps (global/user) editable with audit, prompt
  versions, flagged conversations (user reports), model switch with canary %.
- **Comms:** send a one-off announcement (email/push) to a segment, with preview and a mandatory
  test-send to self; templates for trial drip visible/editable (versioned).
- **Team:** invite collaborator by email → role → they accept with passkey; list, last seen,
  revoke. Owner cannot be removed; at least one owner always.
- **System:** health (API, nginx, disk, backups, cert expiry), feature flags (kill switches: AI,
  sign-ups, payments), maintenance banner, logs viewer (structured app logs, last 24 h, searchable,
  PII-redacted), job runner (backup now, re-sync RC subscriber, re-send verify).

## Logging (prerequisite for the logs viewer)

Structured JSON logs from the API (`pino`-style, one line per request: id, uid hash, route,
status, ms, ip prefix) to stdout → Docker json-file with rotation → optional ship to CloudWatch
(we are on AWS) with 30-day retention. App log and audit log are different streams.

## Order of work

1. Roles + step-up + audit log + structured logging (the foundation, ~1 week).
2. Users module + Billing read-only + Overview (~1 week).
3. Coupons/comp days, Team invites, System flags (~1 week).
4. Comms, Content/AI, Referrals fraud view (~1 week).
