/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import { hashPassword, verifyPassword, needsRehash, passwordProblem, DUMMY_HASH } from './password.js';
import { sendEmail, mail, emailConfigured } from './email.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Browsers send Origin on every cross-site request and on same-site POSTs. Any state-changing
// call whose Origin is present and isn't ours is refused outright — the session cookie is
// SameSite=Lax already, this is the second lock. Non-browser clients (curl, payment webhooks)
// send no Origin and pass. Add the mobile app's origin (capacitor://localhost, https://localhost)
// via ALLOWED_ORIGINS (comma-separated) once the store build signs in.
// The Capacitor shells (store apps) load from capacitor://localhost (iOS) / https://localhost (Android).
const ALLOWED_ORIGINS = new Set([ORIGIN, 'capacitor://localhost', 'https://localhost', 'http://localhost', ...(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';
// AI features (natural-language set logging, coach insights) are entirely optional — unset
// this and both endpoints answer 501 instead of the frontend silently failing on a fetch.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
// Route by feature (docs/AI_COSTS.md lever 1): photos need Sonnet-level vision, the text
// features are fine on Haiku. Either override falls back to ANTHROPIC_MODEL when unset.
const ANTHROPIC_MODEL_VISION = process.env.ANTHROPIC_MODEL_VISION || ANTHROPIC_MODEL;
const ANTHROPIC_MODEL_TEXT = process.env.ANTHROPIC_MODEL_TEXT || ANTHROPIC_MODEL;
const VISION_FEATURES = new Set(['analyze-meal', 'identify-exercise', 'import-plan']);
const modelFor = feature => (VISION_FEATURES.has(feature) ? ANTHROPIC_MODEL_VISION : ANTHROPIC_MODEL_TEXT);
const MODELS_IN_USE = { vision: ANTHROPIC_MODEL_VISION, text: ANTHROPIC_MODEL_TEXT };
// Billing (docs/BILLING.md). Off by default so a self-hosted instance stays free; when on, a new
// account gets TRIAL_DAYS of everything, then needs an active subscription. Stripe is reached over
// plain fetch — no SDK. Prices are display amounts; the real charge is whatever the Stripe price is.
const BILLING_ENABLED = /^(1|true|yes|on)$/i.test(process.env.BILLING_ENABLED || '');
const TRIAL_DAYS = Math.max(0, +(process.env.TRIAL_DAYS || 7) || 0);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const CURRENCY = (process.env.CURRENCY || 'MXN').toUpperCase();
const PLANS = [
  { id: 'monthly', months: 1, amount: +process.env.PRICE_MONTHLY || 129, price: process.env.STRIPE_PRICE_MONTHLY || '' },
  { id: 'semester', months: 6, amount: +process.env.PRICE_SEMESTER || 779, price: process.env.STRIPE_PRICE_SEMESTER || '' },
  { id: 'yearly', months: 12, amount: +process.env.PRICE_YEARLY || 1549, price: process.env.STRIPE_PRICE_YEARLY || '' }
];
const AI_TRIAL_USD_CAP = +process.env.AI_TRIAL_USD_CAP || 1;   // what a free trial may spend on AI
// Referrals: every account has a share code. A new account that signs up with one gets extra
// trial days; when that account first pays, the referrer gets days added to their own access.
// Optional Stripe coupon for the referee's checkout (create it in the Stripe dashboard).
const REF_REFEREE_TRIAL_DAYS = Math.max(0, +(process.env.REF_REFEREE_TRIAL_DAYS ?? 7) || 0);
const REF_REFERRER_DAYS = Math.max(0, +(process.env.REF_REFERRER_DAYS ?? 30) || 0);
const STRIPE_REFERRAL_COUPON = process.env.STRIPE_REFERRAL_COUPON || '';
const DELETE_GRACE_DAYS = 30;

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
db.tokens = db.tokens || [];          // email verification / password reset (hashes only)
db.stripeEvents = db.stripeEvents || [];   // processed webhook ids (idempotency)
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder'
    });
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user, days = SESSION_DAYS) {
  const exp = Date.now() + days * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
// The store apps keep a bearer token in the app's own storage instead of a cookie (WebView
// cookies don't survive reliably). Same signed payload, same `sv` revocation, longer life.
const MOBILE_TOKEN_DAYS = 180;
const withToken = (body, user, payload) => (body && body.client === 'mobile' ? { ...payload, token: makeSession(user, MOBILE_TOKEN_DAYS) } : payload);
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const auth = req.headers.authorization || '';
  const tok = auth.startsWith('Bearer ') ? auth.slice(7).trim() : cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  if (user.deletedAt) return null;          // soft-deleted: only a fresh sign-in (which restores) gets back in
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- accounts: public shape, entitlement, tokens, lockout, mail ---------- */
const nowISO = () => new Date().toISOString();
const normEmail = e => String(e || '').trim().toLowerCase().slice(0, 254);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const userLang = user => { const S = readState(user.id); return (S && S.lang) === 'en' ? 'en' : 'es'; };
const hasPasskey = user => db.creds.some(c => c.userId === user.id);

// What the client may know about an account. Everything the UI needs to decide what to show
// (verify banner, add-passkey row, paywall) travels here, so /api/me is the single source.
function entitlement(user) {
  const now = Date.now();
  const trial = user.trialEnds ? Date.parse(user.trialEnds) : 0;
  const paid = user.tierUntil ? Date.parse(user.tierUntil) : 0;
  const active = !BILLING_ENABLED || isAdmin(user) || now < trial || now < paid;
  const status = !BILLING_ENABLED || isAdmin(user) ? 'free' : paid > now ? 'pro' : trial > now ? 'trial' : 'expired';
  return { enabled: BILLING_ENABLED, active, status, trialEnds: user.trialEnds || null, tierUntil: user.tierUntil || null,
    plan: user.plan || null, provider: user.provider || null, cancelAtPeriodEnd: !!user.cancelAtPeriodEnd, payments: !!STRIPE_SECRET_KEY };
}
const pubUser = user => ({ id: user.id, name: user.name, admin: isAdmin(user), email: user.email || null, emailVerified: !!user.emailVerified,
  hasPassword: !!user.pw, hasPasskey: hasPasskey(user), billing: entitlement(user), referredBy: !!user.referredBy });

// One-time tokens for email links. Only the sha256 of the token is stored; the raw value is in
// the link and nowhere else. Single use, short-lived, scoped by kind.
const tokenHash = raw => crypto.createHash('sha256').update(raw).digest('base64url');
function issueToken(userId, kind, ttlMs) {
  // one live token per (user, kind): asking twice invalidates the first link
  db.tokens = db.tokens.filter(t => !(t.userId === userId && t.kind === kind) && t.exp > Date.now());
  const raw = crypto.randomBytes(32).toString('base64url');
  db.tokens.push({ id: crypto.randomBytes(8).toString('base64url'), userId, kind, hash: tokenHash(raw), exp: Date.now() + ttlMs, used: false });
  saveDb();
  return raw;
}
function consumeToken(raw, kind) {
  const h = tokenHash(String(raw || ''));
  const t = db.tokens.find(x => x.kind === kind && x.hash === h);
  if (!t || t.used || t.exp < Date.now()) return null;
  t.used = true;
  db.tokens = db.tokens.filter(x => x.exp > Date.now());
  return db.users.find(u => u.id === t.userId) || null;
}

// Brute force: per account, 5 failures in 15 minutes locks sign-in for 15 minutes (nginx limits
// per IP on top). Memory only — a restart clears it, which is fine.
const loginFails = new Map();   // email -> [timestamps]
const LOCK_N = 5, LOCK_WINDOW = 15 * 60_000;
function lockedFor(email) {
  const arr = (loginFails.get(email) || []).filter(t => Date.now() - t < LOCK_WINDOW);
  loginFails.set(email, arr);
  return arr.length >= LOCK_N ? Math.ceil((arr[0] + LOCK_WINDOW - Date.now()) / 1000) : 0;
}
const noteFail = email => loginFails.set(email, [...(loginFails.get(email) || []), Date.now()]);
const clearFails = email => loginFails.delete(email);
setInterval(() => { for (const [k, v] of loginFails) if (!v.some(t => Date.now() - t < LOCK_WINDOW)) loginFails.delete(k); }, 60_000).unref();
// forgot / resend: 3 per hour per email, and per IP
const mailBursts = new Map();
function mailLimited(key, n = 3, windowMs = 60 * 60_000) {
  const arr = (mailBursts.get(key) || []).filter(t => Date.now() - t < windowMs);
  if (arr.length >= n) return true;
  arr.push(Date.now()); mailBursts.set(key, arr); return false;
}
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

async function sendVerifyMail(user) {
  const raw = issueToken(user.id, 'verify', 24 * 60 * 60_000);
  const m = mail(userLang(user), 'verify', user.name, `${ORIGIN}/#/verify?token=${raw}`);
  return sendEmail({ to: user.email, ...m });
}

// Daily housekeeping: purge accounts deleted 30+ days ago, and warn trials that end in 2 days.
function purgeUser(u) {
  try { fs.unlinkSync(stateFile(u.id)); } catch {}
  db.creds = db.creds.filter(c => c.userId !== u.id);
  db.subs = db.subs.filter(s => s.userId !== u.id);
  db.tokens = db.tokens.filter(t => t.userId !== u.id);
  if (db.aiUsage) delete db.aiUsage[u.id];
  db.users = db.users.filter(x => x.id !== u.id);
  console.log('purged account', u.id);
}
setInterval(() => {
  let dirty = false;
  for (const u of [...db.users]) {
    if (u.deletedAt && Date.now() - Date.parse(u.deletedAt) > DELETE_GRACE_DAYS * 86400_000) { purgeUser(u); dirty = true; }
  }
  if (BILLING_ENABLED) for (const u of db.users) {
    if (!u.email || !u.trialEnds || u.tierUntil || u.trialWarned || u.deletedAt) continue;
    const left = Date.parse(u.trialEnds) - Date.now();
    if (left > 0 && left < 2 * 86400_000) {
      u.trialWarned = true; dirty = true;
      sendEmail({ to: u.email, ...mail(userLang(u), 'trialEnding', u.name, Math.max(1, Math.ceil(left / 86400_000)), `${ORIGIN}/#/settings`) }).catch(() => {});
    }
  }
  if (dirty) saveDb();
}, 6 * 60 * 60_000).unref();

/* ---------- referrals ---------- */
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
function refCodeOf(user) {
  if (user.refCode) return user.refCode;
  const base = String(user.name || 'VX').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'VX';
  for (let i = 0; i < 50; i++) {
    const tail = Array.from(crypto.randomBytes(4)).map(b => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
    const code = base + tail;
    if (!db.users.some(u => u.refCode === code)) { user.refCode = code; saveDb(); return code; }
  }
  return null;
}
const findReferrer = code => { const c = String(code || '').trim().toUpperCase(); return c ? db.users.find(u => u.refCode === c && !u.disabled && !u.deletedAt) || null : null; };
const addDays = (iso, days) => new Date(Math.max(Date.now(), iso ? Date.parse(iso) : 0) + days * 86400_000).toISOString();
// Called when a referred account pays for the first time: the referrer's access grows.
function rewardReferrer(referee) {
  if (!referee.referredBy || referee.referralRewarded || !REF_REFERRER_DAYS) return;
  const ref = db.users.find(u => u.id === referee.referredBy);
  if (!ref) return;
  // paying referrer: extend the paid period; otherwise extend (or revive) the trial
  if (ref.tierUntil && Date.parse(ref.tierUntil) > Date.now()) ref.tierUntil = addDays(ref.tierUntil, REF_REFERRER_DAYS);
  else if (ref.tierUntil) ref.tierUntil = addDays(null, REF_REFERRER_DAYS);
  else ref.trialEnds = addDays(ref.trialEnds, REF_REFERRER_DAYS);
  ref.referralEarnedDays = (ref.referralEarnedDays || 0) + REF_REFERRER_DAYS;
  referee.referralRewarded = true;
  saveDb();
  if (ref.email) sendEmail({ to: ref.email, ...mail(userLang(ref), 'referralReward', ref.name, referee.name, REF_REFERRER_DAYS, `${ORIGIN}/#/settings`) }).catch(() => {});
  console.log('referral reward', ref.id, '+' + REF_REFERRER_DAYS + 'd for', referee.id);
}

/* ---------- Stripe (plain REST) ---------- */
function formEncode(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') formEncode(v, key, out); else out.append(key, String(v));
  }
  return out;
}
async function stripe(method, path, params) {
  const r = await fetch('https://api.stripe.com/v1' + path, {
    method, headers: { authorization: 'Bearer ' + STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' },
    body: method === 'GET' ? undefined : formEncode(params || {})
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data.error?.message || 'Stripe ' + r.status); e.status = r.status; throw e; }
  return data;
}
// Stripe-Signature: t=<ts>,v1=<hmac>. HMAC-SHA256 over "<ts>.<raw body>" with the endpoint
// secret; 5-minute tolerance against replay.
function verifyStripeSignature(raw, header) {
  const parts = Object.fromEntries(String(header || '').split(',').map(kv => kv.split('=').map(x => x.trim())));
  const ts = +parts.t, sig = parts.v1;
  if (!ts || !sig || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expect = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(ts + '.' + raw).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect)); } catch { return false; }
}
const planByPrice = priceId => PLANS.find(p => p.price && p.price === priceId) || null;
// Fold a Stripe subscription object into the user record. Access runs to the end of the paid
// period whatever happens next (cancel, card failure) — Stripe retries and tells us again.
function applySubscription(sub) {
  const user = db.users.find(u => u.id === sub.metadata?.userId) || db.users.find(u => u.stripeCustomerId === sub.customer);
  if (!user) { console.error('stripe: subscription for unknown user', sub.id, sub.customer); return; }
  const item = sub.items?.data?.[0];
  const periodEnd = (item?.current_period_end || sub.current_period_end || 0) * 1000;
  const good = ['active', 'trialing', 'past_due'].includes(sub.status);
  user.stripeCustomerId = sub.customer;
  user.stripeSubscriptionId = sub.id;
  user.provider = 'stripe';
  user.plan = planByPrice(item?.price?.id)?.id || user.plan || null;
  user.cancelAtPeriodEnd = !!sub.cancel_at_period_end;
  user.subscriptionStatus = sub.status;
  if (good && periodEnd) { user.tierUntil = new Date(periodEnd + 86400_000).toISOString(); rewardReferrer(user); }   // +1 day of grace for renewal timing
  else if (sub.status === 'canceled' || sub.status === 'unpaid' || sub.status === 'incomplete_expired') {
    // keep access until the period they paid for ends; never pull it back earlier
    if (periodEnd && periodEnd > Date.now()) user.tierUntil = new Date(periodEnd).toISOString();
    else if (!user.tierUntil || Date.parse(user.tierUntil) > Date.now()) user.tierUntil = nowISO();
  }
  saveDb();
  console.log('stripe: subscription', sub.status, 'user', user.id, 'until', user.tierUntil);
}

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
// JSON.parse reviver that drops the keys Object.assign / spread treat specially — a body with
// {"__proto__": {...}} must never end up re-parenting a state object here or on a client.
const noProto = (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype') ? undefined : v;
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8'), noProto) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- AI (optional, needs ANTHROPIC_API_KEY) ---------- */
// Every call costs real money, so a simple in-memory sliding window guards against a runaway
// frontend loop — not abuse (this is a personal instance), just a bug that fires 100 requests.
const aiHits = new Map(); // uid -> [timestamps]
// What the coach gets to look at. Kept small and cheap: the last 15 sessions with target vs
// done, a week of nutrition against the targets, today's steps and the recent weight curve —
// no settings, no push subscriptions, no ids that mean nothing off-device. Mirrored in
// frontend/src/lib/ai.js for people using their own API key.
function coachContext(S) {
  const today = new Date().toISOString().slice(0, 10);
  const recent = (S.workouts || []).slice(-15).map(w => ({
    date: w.d,
    entries: (w.entries || []).map(e => ({
      id: e.id, target: e.target,
      sets: (e.sets || []).map(s => ({ done: !!s.done, r: s.r, w: s.w, sec: s.sec, min: s.min }))
    }))
  }));
  const routines = (S.routines || []).map(r => ({ name: r.name, prog: r.prog || 'linear', exCount: (r.ex || []).length }));
  const byDay = {};
  for (const m of S.meals || []) (byDay[m.d] = byDay[m.d] || []).push(...(m.items || []));
  const days = Object.keys(byDay).sort().slice(-7);
  const sum = items => items.reduce((a, i) => { for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber']) a[k] += +i[k] || 0; return a; }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  const round = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
  const nutrition = {
    targets: { kcal: 2000, protein: 140, carbs: 220, fat: 65, ...(S.macroGoal || {}) },
    today: round(sum(byDay[today] || [])),
    mealsToday: (S.meals || []).filter(m => m.d === today).length,
    avgPerLoggedDay: days.length ? round(Object.fromEntries(Object.entries(sum(days.flatMap(d => byDay[d]))).map(([k, v]) => [k, v / days.length]))) : null,
    loggedDaysLast7: days.length
  };
  const bw = (S.bodyweight || []).slice(-8).map(b => ({ d: b.d, w: b.w }));
  const stepRow = (S.steps || []).find(r => r.d === today);
  return {
    today, unit: S.unit || 'kg',
    profile: (S.trainer && S.trainer.answers) || null,
    bodyweight: { unit: S.unit || 'kg', recent: bw, target: S.targetW || null },
    steps: { today: stepRow ? stepRow.n : 0, goal: Math.max(500, +S.stepGoal || 8000) },
    water: { goalMl: S.waterGoal || 2000 },
    dietPlan: S.dietPlan ? { summary: S.dietPlan.summary || '', meals: (S.dietPlan.meals || []).map(m => ({ name: m.name, time: m.time || '', options: (m.options || []).map(o => o.title) })), rules: S.dietPlan.rules || [] } : null,
    nutrition, routines, recentWorkouts: recent
  };
}
function coachSystemPrompt(S, asking, coach) {
  return (coach ? `Your name is ${coach.name}; you are a ${coach.gender === 'f' ? 'woman' : 'man'} and you speak in the first person as ${coach.name}. ` : '') +
    `You are the user's personal coach inside a fitness app: warm, encouraging, direct, and evidence-based ` +
    `about strength training and everyday nutrition. You have their data as JSON: routines, up to 15 recent ` +
    `sessions (each exercise's target vs what was actually done — "done" sets counted as hit), a week of logged ` +
    `meals against their targets, today's steps, recent body weight and, when present, the diet plan their ` +
    `nutritionist wrote (menu and rules) — respect that plan in any food advice. Weight unit is ${S.unit || 'kg'}. ` +
    `Exercise ids come from a public database and are not human-readable — refer to exercises by their role ` +
    `("your pressing work", "the leg curl"), never by id. Ground every answer in their numbers when the data ` +
    `is there; if it isn't (e.g. no meals logged), say so in one short sentence and give a sensible general ` +
    `answer instead of guessing. ` +
    (asking
      ? `Answer the question in 60-160 words of plain prose (no markdown headers, no bullet lists unless listing ` +
        `foods or exercises), ending with one concrete next step. `
      : `Write a 150-250 word read-out in plain prose: what's trending well, where reps/weight have stalled, and ` +
        `1-3 concrete, specific suggestions (a deload, a technique check, adding a set). No markdown headers. `) +
    `You are not a doctor: for medication, injury or medical-condition questions, suggest a professional in ` +
    `one sentence and keep the rest practical. Respond in ${S.lang === 'es' ? 'Spanish' : 'English'}.`;
}
function aiRateLimited(uid, limit, windowMs) {
  const now = Date.now();
  const hits = (aiHits.get(uid) || []).filter(t => now - t < windowMs);
  if (hits.length >= limit) return true;
  hits.push(now);
  aiHits.set(uid, hits);
  return false;
}
// USD per million tokens, matched by model-id prefix. Used for the per-user usage ledger below
// — this is what a paid tier has to cover, so it's tracked from day one (see docs/AI_COSTS.md).
const PRICING = [
  ['claude-haiku-4-5', { in: 1, out: 5 }],
  ['claude-sonnet-5', { in: 2, out: 10 }],
  ['claude-sonnet-4', { in: 3, out: 15 }],
  ['claude-opus-5', { in: 5, out: 25 }],
  ['claude-opus-4', { in: 5, out: 25 }]
];
const priceOf = model => (PRICING.find(([p]) => model.startsWith(p)) || [null, { in: 5, out: 25 }])[1];
const AI_MONTHLY_USD_CAP = +process.env.AI_MONTHLY_USD_CAP || 0;   // 0 = unlimited (personal instance)
// Whole-instance ceiling. With open registration anyone can create accounts, and each account
// gets its own rate limit — this is the number that bounds what a bad month can cost you.
const AI_GLOBAL_MONTHLY_USD_CAP = +process.env.AI_GLOBAL_MONTHLY_USD_CAP || 0;
const monthKey = () => new Date().toISOString().slice(0, 7);
db.aiUsage = db.aiUsage || {};                                       // uid -> { 'YYYY-MM': { calls, in, out, usd, features: { name: calls } } }
function aiUsageOf(uid, month = monthKey()) {
  const u = db.aiUsage[uid] = db.aiUsage[uid] || {};
  return u[month] = u[month] || { calls: 0, in: 0, out: 0, usd: 0, features: {} };
}
function recordAiUsage(uid, feature, usage, model) {
  if (!uid || !usage) return;
  const p = priceOf(model || ANTHROPIC_MODEL);
  const inTok = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const outTok = usage.output_tokens || 0;
  const row = aiUsageOf(uid);
  row.calls++; row.in += inTok; row.out += outTok;
  row.usd = Math.round((row.usd + (inTok * p.in + outTok * p.out) / 1e6) * 1e4) / 1e4;
  row.features[feature] = (row.features[feature] || 0) + 1;
  saveDb();
}
// Per-user monthly spend ceiling. Off by default; a paid plan sets it per tier (docs/BILLING.md).
const aiGlobalUsd = (month = monthKey()) => Object.values(db.aiUsage).reduce((a, u) => a + ((u[month] || {}).usd || 0), 0);
const userCap = uid => { const u = db.users.find(x => x.id === uid); return u && BILLING_ENABLED && entitlement(u).status === 'trial' ? AI_TRIAL_USD_CAP : AI_MONTHLY_USD_CAP; };
const aiOverBudget = uid => (userCap(uid) > 0 && aiUsageOf(uid).usd >= userCap(uid)) ||
  (AI_GLOBAL_MONTHLY_USD_CAP > 0 && aiGlobalUsd() >= AI_GLOBAL_MONTHLY_USD_CAP);

async function callAnthropic({ system, messages, tools, tool_choice, max_tokens }, meta) {
  const model = modelFor(meta && meta.feature);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: max_tokens || 1024, system, messages, tools, tool_choice })
  });
  if (!r.ok) throw new Error('anthropic ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  if (meta) recordAiUsage(meta.uid, meta.feature, j.usage, model);
  return j;
}


// Shared by the server route and mirrored in frontend/src/lib/ai.js for the BYO-key path.
function mealAnalysisRequest({ image, mediaType, text, lang, previous, correction }) {
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: image } });
  if (previous && previous.length) content.push({ type: 'text', text:
    'Your previous estimate for this meal (JSON): ' + JSON.stringify(previous) + '\n' +
    'The person corrected it: "' + correction + '"\n' +
    'Revise the estimate. Apply the correction faithfully (it may change what a food is, its brand, ' +
    'how it was cooked, or a quantity), re-derive the nutrition for the affected items, and keep every ' +
    'item the correction does not touch unchanged. Return the full corrected list.' });
  else content.push({ type: 'text', text: (text ? 'What I ate / extra details: ' + text + '\n' : '') +
    (image ? 'Estimate the calories and macros of everything edible in this photo.' : 'Estimate the calories and macros of this meal from the description alone.') });
  return {
    max_tokens: 1500,
    system: 'You are a registered dietitian estimating the nutrition of a single meal for a fitness app. ' +
      'List every distinct food or drink as its own item. For each, estimate the portion actually present ' +
      '(use visual cues: a dinner plate is ~26 cm, a fork ~18 cm, a hand ~18 cm; typical serving sizes when ' +
      'unclear), convert it to grams, and give calories, protein, carbohydrates, fat, sugars, fibre and sodium FOR THAT PORTION ' +
      '(not per 100 g), using standard food-composition data. Account for likely cooking oil, dressings ' +
      'and sauces you can see. If the person typed details (quantities, brand, how it was cooked), trust ' +
      'them over what the photo suggests. Give a single best estimate for each number — never ranges. ' +
      'Set confidence "none" only if nothing edible is visible or described. Write item names and the ' +
      'meal name in the language with ISO code "' + lang + '"; keep the portion text short (e.g. "1 cup", "2 slices", "~150 g").',
    messages: [{ role: 'user', content }],
    tools: [{
      name: 'log_meal',
      description: 'The itemised nutrition estimate for the meal',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'short name for the whole meal, e.g. "Chicken rice bowl"' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'food name' },
                portion: { type: 'string', description: 'portion as a person would say it' },
                grams: { type: 'number', description: 'estimated weight of the portion in grams (ml for drinks)' },
                kcal: { type: 'number', description: 'calories for the portion' },
                protein: { type: 'number', description: 'grams of protein for the portion' },
                carbs: { type: 'number', description: 'grams of carbohydrate for the portion' },
                fat: { type: 'number', description: 'grams of fat for the portion' },
                sugar: { type: 'number', description: 'grams of total sugars for the portion' },
                fiber: { type: 'number', description: 'grams of dietary fibre for the portion' },
                sodium: { type: 'number', description: 'milligrams of sodium for the portion (salt × 400)' }
              },
              required: ['name', 'portion', 'grams', 'kcal', 'protein', 'carbs', 'fat', 'sugar', 'fiber', 'sodium']
            }
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
          note: { type: 'string', description: 'one short clause on the main assumption (e.g. "assumed 1 tbsp oil") or why confidence is low/none' }
        },
        required: ['name', 'items', 'confidence']
      }
    }],
    tool_choice: { type: 'tool', name: 'log_meal' }
  };
}


// Recipe ideas for one meal slot of the person's diet plan, keeping the nutritionist's intent:
// same macro slot, same kind of foods, and the plan's rules. Mirrored in frontend/src/lib/ai.js.
function recipesRequest({ meal, targets, rules, lang, wish, avoid, mealsPerDay }) {
  const slot = (meal.options || []).find(o => o.kcal > 0);
  return {
    max_tokens: 2500,
    system: 'You are a registered dietitian helping a client who follows a written meal plan from their own ' +
      'nutritionist. They want new recipes for ONE meal of that plan that they could eat INSTEAD of what the plan ' +
      'lists, without drifting from it. Rules, in order: (1) obey the plan\'s rules and restrictions strictly; ' +
      '(2) match the nutrition of that meal slot — use the option\'s stated calories/macros when given, otherwise ' +
      'the meal\'s fair share of the daily targets for a ' + (mealsPerDay || 4) + '-meal day; (3) stay within the same ' +
      'food groups and portions as the plan\'s own options (an exchange, not a different diet); (4) everyday ' +
      'ingredients available in an ordinary supermarket, 30 minutes or less unless the plan is clearly elaborate. ' +
      'Give 3 clearly different recipes. Quantities in grams or household measures. Calories and macros are for ' +
      'the whole recipe as served to one person. Write everything in the language with ISO code "' + lang + '", in ' +
      'the same regional variety and with the same food names the plan itself uses (a Mexican plan gets Mexican ' +
      'Spanish: jitomate, camote, papa — not tomate, boniato, patata).',
    messages: [{ role: 'user', content: JSON.stringify({
      meal: { name: meal.name, time: meal.time || '', options: (meal.options || []).map(o => ({ title: o.title, items: o.items, kcal: o.kcal, protein: o.protein, carbs: o.carbs, fat: o.fat })) },
      dailyTargets: targets, planRules: rules, targetForThisMeal: slot ? { kcal: slot.kcal, protein: slot.protein, carbs: slot.carbs, fat: slot.fat } : 'share of daily targets',
      clientWish: wish || '', doNotRepeat: avoid
    }) }],
    tools: [{
      name: 'suggest_recipes',
      description: 'Three recipes for this meal slot',
      input_schema: {
        type: 'object',
        properties: {
          recipes: {
            type: 'array', minItems: 3, maxItems: 3,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                why: { type: 'string', description: 'one short line: how it matches the plan (macros, food groups, rules)' },
                minutes: { type: 'integer' },
                ingredients: { type: 'array', items: { type: 'string' }, description: 'with quantities, e.g. "120 g pechuga de pollo"' },
                steps: { type: 'array', items: { type: 'string' }, description: '3-6 short steps' },
                kcal: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }
              },
              required: ['title', 'why', 'minutes', 'ingredients', 'steps', 'kcal', 'protein', 'carbs', 'fat']
            }
          },
          note: { type: 'string', description: 'one short clause if something in the request could not be honoured' }
        },
        required: ['recipes']
      }
    }],
    tool_choice: { type: 'tool', name: 'suggest_recipes' }
  };
}

// Diet plan (photo or PDF) -> daily targets. Mirrored in frontend/src/lib/ai.js for the BYO-key path.
// A plan is usually a per-meal table with totals per day; when the days differ, the model reports
// the typical (average) day. The client shows the numbers for review before anything is saved.
function planTargetsRequest({ image, mediaType, pdf, lang }) {
  const content = [];
  if (pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } });
  else content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: image } });
  content.push({ type: 'text', text: 'Read this meal / diet plan. Extract (1) the DAILY nutrition targets it prescribes, (2) the full menu: every meal with its options and the foods with quantities as written, and (3) its rules and restrictions.' });
  return {
    max_tokens: 4000,
    system: 'You are a registered dietitian reading a meal plan written for one person (a photo of a printed ' +
      'or handwritten plan, or a PDF) for a fitness app that tracks daily calories and macros. Extract the ' +
      'daily targets: calories, protein, carbohydrates, fat, and when stated, sugars, fibre and sodium. ' +
      'Rules: if the plan states daily totals, use them. If it only lists meals with their nutrition, add ' +
      'them up for one day. If different days differ, report the typical (average) day. If a macro is given ' +
      'as a percentage of calories, convert it to grams (4 kcal/g protein and carbs, 9 kcal/g fat). Never ' +
      'invent a number: leave optional fields out when the plan does not state or imply them, and set ' +
      'found=false when the document is not a meal plan or has no usable nutrition numbers. Give single ' +
      'best values, never ranges. Transcribe the menu faithfully: keep the plan’s own meal names, order, options and quantities, in the plan’s language; do not invent meals or foods that are not there, and leave meals empty rather than guessing. Write the summary and note in the language with ISO code "' + lang + '".',
    messages: [{ role: 'user', content }],
    tools: [{
      name: 'set_targets',
      description: 'The daily targets extracted from the plan',
      input_schema: {
        type: 'object',
        properties: {
          found: { type: 'boolean', description: 'true when the document is a meal plan with usable daily numbers' },
          kcal: { type: 'number', description: 'daily calories' },
          protein: { type: 'number', description: 'daily grams of protein' },
          carbs: { type: 'number', description: 'daily grams of carbohydrate' },
          fat: { type: 'number', description: 'daily grams of fat' },
          sugar: { type: 'number', description: 'daily grams of sugars, only if the plan states a limit' },
          fiber: { type: 'number', description: 'daily grams of fibre, only if the plan states it' },
          sodium: { type: 'number', description: 'daily milligrams of sodium, only if the plan states a limit' },
          meals: {
            type: 'array',
            description: 'the menu: every meal of the day in the order the plan lists them, with the alternatives the plan offers for each',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'meal name as written, e.g. "Desayuno", "Colación 1", "Cena"' },
                time: { type: 'string', description: 'time or moment if the plan states it, e.g. "8:00" or "media mañana"; otherwise empty' },
                options: {
                  type: 'array',
                  description: 'each option / alternative the plan gives for this meal; one entry when there is a single menu',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string', description: 'short title for the option, e.g. "Avena con fruta"' },
                      items: { type: 'array', items: { type: 'string' }, description: 'foods with their quantities exactly as prescribed, e.g. "120 g pechuga de pollo", "1/2 taza arroz"' },
                      kcal: { type: 'number', description: 'calories for this option only if the plan states them' },
                      protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }
                    },
                    required: ['title', 'items']
                  }
                }
              },
              required: ['name', 'options']
            }
          },
          rules: {
            type: 'array', items: { type: 'string' },
            description: 'the plan\'s instructions and restrictions, one per entry: forbidden or limited foods, allergies, substitution/equivalence rules, water, supplements, cooking methods, cheat meals'
          },
          summary: { type: 'string', description: 'one short line describing the plan (e.g. "Cut, 5 meals, high protein"), or why nothing was found' },
          note: { type: 'string', description: 'one short clause on the main assumption (e.g. "averaged 3 training and 4 rest days")' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
        },
        required: ['found', 'summary', 'confidence']
      }
    }],
    tool_choice: { type: 'tool', name: 'set_targets' }
  };
}

// AI trainer: questionnaire + exercise shortlist -> weekly plan. Mirrored in frontend/src/lib/ai.js.
function trainerPlanRequest({ profile, candidates }) {
  const p = profile;
  const lines = candidates.map(c => c.id + '|' + c.n + '|' + c.tg + '|' + c.eq).join('\n');
  return {
    max_tokens: 4000,
    system: 'You are an evidence-based strength & conditioning coach designing a weekly training plan ' +
      'for one person. You will get their profile and a list of available exercises, one per line as ' +
      'id|name|target muscle|equipment. Use ONLY ids from that list — never invent one.\n' +
      'Apply current sports-science consensus:\n' +
      '- Schedule EXACTLY daysPerWeek training days in total across all routines (a routine used twice a week counts twice); never more.\n' +
      '- Split by availability: 2-3 days → full body; 4 days → upper/lower; 5-6 days → push/pull/legs or upper/lower/full. Each muscle trained ~2× per week.\n' +
      '- Weekly volume per major muscle: beginners ~8-12 hard sets, intermediates 12-18, advanced 15-22.\n' +
      '- Strength goal: main compound lifts 3-6 reps, 3-5 sets, 2-4 min rest; accessories 6-12. Muscle goal: 6-12 reps on compounds, 10-20 on isolation, 1.5-3 min rest, sets 1-3 reps from failure. Fat loss: keep resistance training (it preserves muscle in a deficit), moderate reps, plus 2-4 cardio sessions. Endurance: zone-2 cardio, intervals once a week, full-body strength 2× to keep tissue robust. General health: 2-3 full-body sessions + cardio, all major patterns (squat, hinge, push, pull, carry).\n' +
      '- EQUIPMENT IS A HARD CONSTRAINT. The list already contains only what the person has, but also mind fixtures: equipment "bodyweight" means NO equipment at all — no pull-up bar, no dip bars, no bench, no rings, no machines (floor, wall and a chair at most); equipment "home" means dumbbells, bands and a mat only — no bench, no bar, no machines; equipment "gym" has everything. Never pick an exercise that needs a fixture the person does not have, even if it is in the list.\n' +
'- Compound movements first, isolation after. Beginners: fewer exercises (4-6), simple, machine or dumbbell friendly. Advanced: more variety and volume.\n' +
      '- Session must fit the minutes given: budget ~3 min per set for strength, ~2 min for hypertrophy/isolation, plus the cardio minutes.\n' +
      '- Respect limitations/injuries strictly: avoid movements that load the affected area; prefer alternatives.\n' +
      '- Respect focus areas with 1-2 extra sets, not by neglecting the rest.\n' +
      '- Progression: "linear" for beginners on compounds, "double" (rep range then load) for intermediate/advanced hypertrophy, "greyskull" for strength-focused beginners/intermediates.\n' +
      '- Cardio exercises: give minutes, not sets/reps.\n' +
      'Also give daily nutrition targets: Mifflin-St Jeor BMR from sex/age/weight (assume 30 y and 170 cm if unknown), activity factor 1.5-1.7 by days trained; fat loss = -15 to -20%, muscle = +5 to +10%, otherwise maintenance; protein 1.6-2.2 g/kg (upper end when cutting), fat 25-30% of calories, carbs fill the rest.\n' +
      'Write the summary, routine names, notes and the nutrition rationale in the language with ISO code "' + p.lang + '". The summary is 80-140 words: the split and why, how to progress, what to expect in 8-12 weeks. Plain prose, no markdown.',
    messages: [{ role: 'user', content: 'PROFILE\n' + JSON.stringify(p) + '\n\nEXERCISES\n' + lines }],
    tools: [{
      name: 'training_plan',
      description: 'The weekly plan',
      input_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'at most 2 short sentences, plain language for someone who has never trained, no jargon (no "split", "volume", "compound"): what the week looks like and what they will get from it' },
          split: { type: 'string', description: 'short plan name a beginner understands, e.g. "Upper / Lower", "Full body 3 days"' },
          progression: { type: 'string', enum: ['linear', 'double', 'greyskull'] },
          routines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'short routine name, e.g. "Upper A"' },
                glyph: { type: 'string', enum: ['figureStrength', 'arm', 'abs', 'legs', 'pullup', 'dumbbell', 'barbell', 'kettlebell', 'plate', 'machine', 'figureRun', 'bike', 'swim', 'boxing', 'timer'] },
                days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'weekdays for this routine, 0 = Sunday … 6 = Saturday; spread sessions out, never two heavy days for the same muscles back to back' },
                exercises: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', description: 'MUST be an id from the list' },
                      sets: { type: 'integer' },
                      reps: { type: 'integer', description: 'target reps per set (top of the range)' },
                      rest: { type: 'integer', description: 'seconds of rest between sets' },
                      minutes: { type: 'integer', description: 'for cardio only: duration' },
                      note: { type: 'string', description: 'optional, ≤ 12 words: tempo, cue, or why it is here' }
                    },
                    required: ['id']
                  }
                }
              },
              required: ['name', 'glyph', 'days', 'exercises']
            }
          },
          cardio: { type: 'string', description: 'one or two sentences on cardio outside the listed sessions, if relevant' },
          nutrition: {
            type: 'object',
            properties: {
              kcal: { type: 'integer' }, protein: { type: 'integer' }, carbs: { type: 'integer' }, fat: { type: 'integer' },
              why: { type: 'string', description: 'one or two sentences' }
            },
            required: ['kcal', 'protein', 'carbs', 'fat', 'why']
          }
        },
        required: ['summary', 'split', 'progression', 'routines', 'nutrition']
      }
    }],
    tool_choice: { type: 'tool', name: 'training_plan' }
  };
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY, ai: !!ANTHROPIC_API_KEY, billing: BILLING_ENABLED, trialDays: TRIAL_DAYS, email: emailConfigured() }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: pubUser(user) });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { console.error('webauthn verify', e.message); return json(res, 400, { error: 'verification failed' }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    let invite = null;
    if (INVITE_ONLY) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    json(res, 200, { user: pubUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { console.error('webauthn verify', e.message); return json(res, 400, { error: 'verification failed' }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    if (user.deletedAt) { delete user.deletedAt; saveDb(); }   // signing in within the grace period undoes the deletion
    json(res, 200, { user: pubUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  /* ---------- email + password accounts (docs/ACCOUNTS.md) ---------- */
  'POST /api/auth/register': async (req, res) => {
    const body = await readBody(req);
    const email = normEmail(body.email), name = String(body.name || '').trim().slice(0, 40), password = String(body.password || '');
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'enter a valid email' });
    if (!name) return json(res, 400, { error: 'name required' });
    const bad = passwordProblem(password);
    if (bad) return json(res, 400, { error: bad === 'too short' ? 'password must be at least 8 characters' : bad === 'too long' ? 'password is too long' : 'that password is too common — pick another' });
    const code = String(body.code || '').trim().toUpperCase();
    const invite = INVITE_ONLY ? db.invites.find(i => i.code === code && !i.usedBy && !i.revoked) : null;
    if (INVITE_ONLY && !invite) return json(res, 403, { error: 'a valid invite code is required' });
    if (db.users.some(u => u.email === email)) return json(res, 409, { error: 'there is already an account with this email — sign in instead' });
    const user = { id: crypto.randomBytes(12).toString('base64url'), name, email, emailVerified: false, pw: hashPassword(password), created: nowISO() };
    const referrer = findReferrer(body.ref);
    if (referrer) { user.referredBy = referrer.id; referrer.referrals = [...(referrer.referrals || []), { id: user.id, at: user.created }]; }
    if (BILLING_ENABLED && TRIAL_DAYS > 0) user.trialEnds = new Date(Date.now() + (TRIAL_DAYS + (referrer ? REF_REFEREE_TRIAL_DAYS : 0)) * 86400_000).toISOString();
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    db.users.push(user);
    saveDb();
    if (body.lang === 'en' || body.lang === 'es') { try { atomicWrite(stateFile(user.id), JSON.stringify({ lang: body.lang, _ts: Date.now() })); } catch {} }
    sendVerifyMail(user).catch(e => console.error('verify mail', e));
    json(res, 200, withToken(body, user, { user: pubUser(user) }), { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/auth/login': async (req, res) => {
    const body = await readBody(req);
    const email = normEmail(body.email), password = String(body.password || '');
    if (!email || !password) return json(res, 400, { error: 'email and password required' });
    const wait = lockedFor(email);
    if (wait) return json(res, 429, { error: 'too many attempts — try again in a few minutes', retryAfter: wait });
    const user = db.users.find(u => u.email === email);
    // verify against a dummy hash when the account doesn't exist so timing doesn't reveal it
    const ok = verifyPassword(password, user && user.pw ? user.pw : DUMMY_HASH) && !!(user && user.pw);
    if (!ok) { noteFail(email); return json(res, 401, { error: 'invalid email or password' }); }
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    clearFails(email);
    if (needsRehash(user.pw)) user.pw = hashPassword(password);
    if (user.deletedAt) delete user.deletedAt;
    user.lastLogin = nowISO();
    saveDb();
    json(res, 200, withToken(body, user, { user: pubUser(user) }), { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/auth/verify': async (req, res) => {
    const body = await readBody(req);
    const user = consumeToken(body.token, 'verify');
    if (!user) return json(res, 400, { error: 'this link is no longer valid — request a new one from Settings' });
    user.emailVerified = true;
    saveDb();
    json(res, 200, { ok: true, user: pubUser(user) });
  },

  'POST /api/auth/resend-verify': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!user.email) return json(res, 400, { error: 'no email on this account' });
    if (user.emailVerified) return json(res, 200, { ok: true, already: true });
    if (mailLimited('rv:' + user.id)) return json(res, 429, { error: 'already sent — check your inbox and spam, and try again in an hour' });
    await sendVerifyMail(user);
    json(res, 200, { ok: true });
  },

  // My share code and what it has earned.
  'GET /api/referral': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const code = refCodeOf(user);
    const refs = user.referrals || [];
    const converted = refs.filter(r => { const u = db.users.find(x => x.id === r.id); return u && u.referralRewarded; }).length;
    json(res, 200, { code, link: `${ORIGIN}/?ref=${code}`, invited: refs.length, converted, earnedDays: user.referralEarnedDays || 0,
      refereeBonusDays: REF_REFEREE_TRIAL_DAYS, referrerDays: REF_REFERRER_DAYS, trialDays: TRIAL_DAYS });
  },

  // Always 200: whether the email exists is not something this endpoint reveals.
  'POST /api/auth/forgot': async (req, res) => {
    const body = await readBody(req);
    const email = normEmail(body.email);
    if (!EMAIL_RE.test(email)) return json(res, 200, { ok: true });
    if (mailLimited('fg:' + email) || mailLimited('fgip:' + clientIp(req), 10)) return json(res, 200, { ok: true });
    const user = db.users.find(u => u.email === email && !u.disabled);
    if (user) {
      const raw = issueToken(user.id, 'reset', 60 * 60_000);
      sendEmail({ to: user.email, ...mail(userLang(user), 'reset', user.name, `${ORIGIN}/#/reset?token=${raw}`) }).catch(e => console.error('reset mail', e));
    }
    json(res, 200, { ok: true });
  },

  'POST /api/auth/reset': async (req, res) => {
    const body = await readBody(req);
    const password = String(body.password || '');
    const bad = passwordProblem(password);
    if (bad) return json(res, 400, { error: bad === 'too short' ? 'password must be at least 8 characters' : bad === 'too long' ? 'password is too long' : 'that password is too common — pick another' });
    const user = consumeToken(body.token, 'reset');
    if (!user) return json(res, 400, { error: 'this link is no longer valid — request a new one' });
    user.pw = hashPassword(password);
    user.pwChangedAt = nowISO();
    user.sv = sessionVersion(user) + 1;          // every other session dies
    if (user.deletedAt) delete user.deletedAt;
    if (!user.emailVerified) user.emailVerified = true;   // they just proved they own the inbox
    clearFails(user.email);
    saveDb();
    sendEmail({ to: user.email, ...mail(userLang(user), 'passwordChanged', user.name) }).catch(() => {});
    json(res, 200, withToken(body, user, { ok: true, user: pubUser(user) }), { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/auth/password': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (user.pw && !verifyPassword(String(body.current || ''), user.pw)) return json(res, 401, { error: 'current password is wrong' });
    const bad = passwordProblem(String(body.next || ''));
    if (bad) return json(res, 400, { error: bad === 'too short' ? 'password must be at least 8 characters' : bad === 'too long' ? 'password is too long' : 'that password is too common — pick another' });
    user.pw = hashPassword(String(body.next));
    user.pwChangedAt = nowISO();
    user.sv = sessionVersion(user) + 1;
    saveDb();
    if (user.email) sendEmail({ to: user.email, ...mail(userLang(user), 'passwordChanged', user.name) }).catch(() => {});
    json(res, 200, withToken(body, user, { ok: true, user: pubUser(user) }), { 'Set-Cookie': sessionCookie(user) });
  },

  // Change email (password required), or add email + password to a passkey-only account.
  'POST /api/auth/email': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const email = normEmail(body.email);
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'enter a valid email' });
    if (db.users.some(u => u.email === email && u.id !== user.id)) return json(res, 409, { error: 'that email is already used by another account' });
    if (user.pw) {
      if (!verifyPassword(String(body.password || ''), user.pw)) return json(res, 401, { error: 'password is wrong' });
    } else {
      const bad = passwordProblem(String(body.password || ''));
      if (bad) return json(res, 400, { error: bad === 'too short' ? 'password must be at least 8 characters' : bad === 'too long' ? 'password is too long' : 'that password is too common — pick another' });
      user.pw = hashPassword(String(body.password));
    }
    const old = user.email;
    user.email = email; user.emailVerified = false;
    saveDb();
    sendVerifyMail(user).catch(() => {});
    if (old && old !== email) sendEmail({ to: old, ...mail(userLang(user), 'emailChanged', user.name, email) }).catch(() => {});
    json(res, 200, { ok: true, user: pubUser(user) });
  },

  // Add a passkey to the signed-in account (any account — email ones get Face ID too).
  'POST /api/passkey/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(user.id), userName: user.email || user.name, userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: db.creds.filter(c => c.userId === user.id).map(c => ({ id: c.id, transports: c.transports }))
    });
    const cid = putChallenge({ challenge: options.challenge, addTo: user.id });
    json(res, 200, { cid, options });
  },
  'POST /api/passkey/verify': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || c.addTo !== user.id) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({ response: body.credential, expectedChallenge: c.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false });
    } catch (e) { return json(res, 400, { error: 'verification failed' }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    db.creds.push({ id: credential.id, userId: user.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter || 0, transports: body.credential?.response?.transports || [] });
    saveDb();
    json(res, 200, { ok: true, user: pubUser(user) });
  },

  // Soft delete: hidden and signed out everywhere at once, purged after 30 days unless they
  // sign in again. Password required when there is one; passkey-only accounts just confirm.
  'DELETE /api/account': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (user.pw && !verifyPassword(String(body.password || ''), user.pw)) return json(res, 401, { error: 'password is wrong' });
    if (isAdmin(user)) return json(res, 400, { error: 'admin accounts cannot be deleted from the app' });
    user.deletedAt = nowISO();
    user.sv = sessionVersion(user) + 1;
    db.subs = db.subs.filter(s => s.userId !== user.id);
    presence.delete(user.id);
    saveDb();
    if (user.stripeSubscriptionId && STRIPE_SECRET_KEY) stripe('DELETE', '/subscriptions/' + user.stripeSubscriptionId).catch(e => console.error('stripe cancel on delete', e.message));
    if (user.email) sendEmail({ to: user.email, ...mail(userLang(user), 'deleted', user.name) }).catch(() => {});
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'openGym', body: 'Test notification ✅ — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.filter(u => !u.deletedAt).map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    // 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
    // (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
    // good, so the code itself has to be the thing that isn't worth guessing. Codes already in
    // db.json keep working — validation is an exact string compare, never a length or format check.
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    db.invites.push(invite);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    json(res, 200, { ok: true });
  },

  // Turns "did 3x10 at 60kg" into { sets, reps, weight }. Forced tool-use keeps the reply
  // machine-readable — no prose to strip, no JSON-in-a-string to hope the model got right.
  // What this profile has spent on AI this month (tokens + USD at list price) and the cap, if any.
  'GET /api/ai/usage': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { month: monthKey(), ...aiUsageOf(user.id), cap: AI_MONTHLY_USD_CAP || null, model: ANTHROPIC_MODEL_TEXT, models: MODELS_IN_USE });
  },
  'GET /api/admin/ai-usage': async (req, res) => {
    const user = readSession(req);
    if (!isAdmin(user)) return json(res, 403, { error: 'admin only' });
    const month = monthKey();
    const rows = db.users.map(u => ({ id: u.id, name: u.name, ...(db.aiUsage[u.id]?.[month] || { calls: 0, in: 0, out: 0, usd: 0, features: {} }) }));
    json(res, 200, { month, model: ANTHROPIC_MODEL_TEXT, models: MODELS_IN_USE, cap: AI_MONTHLY_USD_CAP || null, total: Math.round(rows.reduce((a, r) => a + r.usd, 0) * 1e4) / 1e4, users: rows });
  },

  /* ---------- billing (docs/BILLING.md) ---------- */
  'GET /api/billing/plans': async (req, res) => json(res, 200, { enabled: BILLING_ENABLED, payments: !!STRIPE_SECRET_KEY, currency: CURRENCY, trialDays: TRIAL_DAYS,
    plans: PLANS.map(p => ({ id: p.id, months: p.months, amount: p.amount, perMonth: Math.round(p.amount / p.months), available: !!p.price })) }),

  'GET /api/billing/status': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { ...entitlement(user), tier: entitlement(user).status, aiCapUsd: entitlement(user).status === 'trial' ? AI_TRIAL_USD_CAP : (AI_MONTHLY_USD_CAP || null) });
  },

  'POST /api/billing/checkout': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!BILLING_ENABLED || !STRIPE_SECRET_KEY) return json(res, 501, { error: 'payments are not set up yet' });
    if (!user.email) return json(res, 400, { error: 'add an email to your account first' });
    if (!user.emailVerified) return json(res, 403, { error: 'confirm your email first' });
    const body = await readBody(req);
    const plan = PLANS.find(p => p.id === body.plan && p.price);
    if (!plan) return json(res, 400, { error: 'unknown plan' });
    try {
      if (!user.stripeCustomerId) {
        const c = await stripe('POST', '/customers', { email: user.email, name: user.name, metadata: { userId: user.id } });
        user.stripeCustomerId = c.id; saveDb();
      }
      const session = await stripe('POST', '/checkout/sessions', {
        mode: 'subscription', customer: user.stripeCustomerId, client_reference_id: user.id,
        line_items: { 0: { price: plan.price, quantity: 1 } },
        subscription_data: { metadata: { userId: user.id, plan: plan.id } },
        ...(user.referredBy && !user.referralRewarded && STRIPE_REFERRAL_COUPON ? { discounts: { 0: { coupon: STRIPE_REFERRAL_COUPON } } } : { allow_promotion_codes: 'true' }),
        locale: userLang(user),
        success_url: `${ORIGIN}/#/settings?checkout=success`, cancel_url: `${ORIGIN}/#/settings?checkout=cancel`
      });
      json(res, 200, { url: session.url });
    } catch (e) { console.error('stripe checkout', e.message); json(res, 502, { error: 'could not start the payment — try again' }); }
  },

  'POST /api/billing/portal': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!STRIPE_SECRET_KEY || !user.stripeCustomerId) return json(res, 400, { error: 'no subscription to manage' });
    try {
      const p = await stripe('POST', '/billing_portal/sessions', { customer: user.stripeCustomerId, return_url: `${ORIGIN}/#/settings` });
      json(res, 200, { url: p.url });
    } catch (e) { console.error('stripe portal', e.message); json(res, 502, { error: 'could not open the billing portal — try again' }); }
  },

  // Stripe → us. Signature-verified, idempotent on event id, and tolerant: any event we don't
  // care about is acknowledged so Stripe stops retrying it.
  'POST /api/billing/webhook': async (req, res) => {
    if (!STRIPE_WEBHOOK_SECRET) return json(res, 501, { error: 'webhook not configured' });
    const raw = await new Promise((resolve, reject) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > MAX_BODY) { req.destroy(); reject(new Error('too large')); } c.push(d); }); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); req.on('error', reject); });
    if (!verifyStripeSignature(raw, req.headers['stripe-signature'])) return json(res, 400, { error: 'bad signature' });
    let ev; try { ev = JSON.parse(raw, noProto); } catch { return json(res, 400, { error: 'bad json' }); }
    if (db.stripeEvents.includes(ev.id)) return json(res, 200, { ok: true, duplicate: true });
    db.stripeEvents = [...db.stripeEvents.slice(-499), ev.id];
    try {
      const obj = ev.data?.object || {};
      if (ev.type === 'checkout.session.completed' && obj.subscription) applySubscription(await stripe('GET', '/subscriptions/' + obj.subscription));
      else if (ev.type.startsWith('customer.subscription.')) applySubscription(obj);
      else if ((ev.type === 'invoice.paid' || ev.type === 'invoice.payment_failed') && (obj.subscription || obj.parent?.subscription_details?.subscription))
        applySubscription(await stripe('GET', '/subscriptions/' + (obj.subscription || obj.parent.subscription_details.subscription)));
      saveDb();
      json(res, 200, { ok: true });
    } catch (e) { console.error('stripe webhook', ev.type, e.message); json(res, 500, { error: 'handler failed' }); }
  },

  /* ---------- progress photos (scaffold — see docs/PROGRESS_PHOTOS.md) ---------- */
  // Contract only. The real implementation needs object storage; the JSON state file is the
  // wrong place for images. Metadata (date, pose, weight that day) stays in the profile state.
  'POST /api/progress-photos/upload-url': async (req, res) => json(res, 501, { error: 'progress photos need object storage — not configured' }),
  'GET /api/progress-photos': async (req, res) => json(res, 501, { error: 'progress photos need object storage — not configured' }),
  'DELETE /api/progress-photos': async (req, res) => json(res, 501, { error: 'progress photos need object storage — not configured' }),

  'POST /api/ai/parse-set': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    const body = await readBody(req);
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return json(res, 400, { error: 'text required' });
    if (aiRateLimited(user.id, 20, 60_000)) return json(res, 429, { error: 'too many requests — slow down' });
    if (aiOverBudget(user.id)) return json(res, 402, { error: 'AI budget for this month is used up' });
    try {
      const r = await callAnthropic({
        max_tokens: 300,
        system: `Parse a spoken/typed description of one set of a strength exercise into numbers. ` +
          `Weight unit is ${body.unit === 'lb' ? 'pounds' : 'kilograms'} unless the person says otherwise. ` +
          `Leave a field null if it truly isn't mentioned or implied. Set confident=false only if you ` +
          `cannot extract sets or reps at all.`,
        messages: [{ role: 'user', content: (body.exercise ? `Exercise: ${body.exercise}\n` : '') + text }],
        tools: [{
          name: 'log_set',
          description: 'The parsed set',
          input_schema: {
            type: 'object',
            properties: {
              sets: { type: ['integer', 'null'], description: 'number of sets performed' },
              reps: { type: ['integer', 'null'], description: 'reps per set' },
              weight: { type: ['number', 'null'], description: 'load used, in the given unit' },
              confident: { type: 'boolean' }
            },
            required: ['confident']
          }
        }],
        tool_choice: { type: 'tool', name: 'log_set' }
      }, { uid: user.id, feature: 'parse-set' });
      const call = (r.content || []).find(b => b.type === 'tool_use');
      if (!call) return json(res, 502, { error: 'no structured reply from model' });
      json(res, 200, { ok: true, ...call.input });
    } catch (e) { console.error('ai/parse-set', e); json(res, 502, { error: 'AI request failed' }); }
  },

  // Reads the caller's own recent workouts server-side (never another user's) and asks for a
  // short plain-language read: what's working, what's stalling, 1-3 concrete suggestions.
  'POST /api/ai/coach': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    if (aiRateLimited(user.id, 20, 60 * 60_000)) return json(res, 429, { error: 'you have asked the coach a lot — try again in a bit' });
    if (aiOverBudget(user.id)) return json(res, 402, { error: 'AI budget for this month is used up' });
    const body = await readBody(req);
    const question = String(body.question || '').slice(0, 600).trim();
    // Prior turns of this sheet's conversation, so follow-ups ("and on rest days?") make sense.
    // Capped so a long chat can't grow the prompt without bound.
    const history = Array.isArray(body.history) ? body.history.slice(-8)
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) })) : [];
    // The persona the person picked; only a short whitelisted name reaches the prompt.
    const coach = body.coach && typeof body.coach.name === 'string'
      ? { name: body.coach.name.replace(/[^\p{L} ]/gu, '').slice(0, 24) || 'Coach', gender: body.coach.gender === 'f' ? 'f' : 'm' }
      : null;
    const S = readState(user.id);
    if (!S || !((S.workouts || []).length || (S.meals || []).length || (S.bodyweight || []).length)) {
      return json(res, 400, { error: 'log a workout, a meal or your weight first so the coach has something to look at' });
    }
    try {
      const r = await callAnthropic({
        max_tokens: question ? 500 : 700,
        system: coachSystemPrompt(S, !!question, coach),
        messages: [
          { role: 'user', content: 'My data (JSON): ' + JSON.stringify(coachContext(S)) },
          { role: 'assistant', content: 'Got it — I have your recent training, nutrition, steps and weight in front of me.' },
          ...history,
          { role: 'user', content: question || 'Give me a read-out on my recent training.' }
        ]
      }, { uid: user.id, feature: 'coach' });
      const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      if (!text) return json(res, 502, { error: 'no reply from model' });
      json(res, 200, { ok: true, text });
    } catch (e) { console.error('ai/coach', e); json(res, 502, { error: 'AI request failed' }); }
  },

  // Photo of a gym machine/exercise -> best-guess name + body part + equipment. The frontend
  // matches this against the exercise catalog itself (or offers to create it as custom) — this
  // endpoint only has to describe what it sees, not know the catalog.
  'POST /api/ai/identify-exercise': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    const body = await readBody(req);
    const image = String(body.image || '');
    const mediaType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(body.mediaType) ? body.mediaType : 'image/jpeg';
    if (!image || image.length > 4_000_000) return json(res, 400, { error: 'image required (send it resized client-side)' });
    if (aiRateLimited(user.id, 10, 60 * 60_000)) return json(res, 429, { error: 'too many photos — try again in a bit' });
    if (aiOverBudget(user.id)) return json(res, 402, { error: 'AI budget for this month is used up' });
    try {
      const r = await callAnthropic({
        max_tokens: 300,
        system: 'You identify gym equipment and exercises from a photo taken on a gym floor. Give your single ' +
          'best guess, even from a partial or blurry view — a gym-goer just pointed a phone at a machine or a ' +
          'move mid-rep and wants it logged, not a hedge.',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: 'What exercise/machine is this? If nothing exercise-related is visible, say so via confidence: "none".' }
          ]
        }],
        tools: [{
          name: 'identify_exercise',
          description: 'The identified exercise',
          input_schema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'common exercise name, lowercase, e.g. "lever chest press" or "dumbbell lateral raise"' },
              bodyPart: { type: 'string', enum: ['back', 'cardio', 'chest', 'lower arms', 'lower legs', 'neck', 'shoulders', 'upper arms', 'upper legs', 'waist'] },
              equipment: { type: 'string', description: 'e.g. "leverage machine", "dumbbell", "cable", "barbell", "body weight"' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
              note: { type: 'string', description: 'one short clause on what gave it away, or why confidence is low/none' }
            },
            required: ['name', 'bodyPart', 'equipment', 'confidence']
          }
        }],
        tool_choice: { type: 'tool', name: 'identify_exercise' }
      }, { uid: user.id, feature: 'identify-exercise' });
      const call = (r.content || []).find(b => b.type === 'tool_use');
      if (!call) return json(res, 502, { error: 'no structured reply from model' });
      json(res, 200, { ok: true, ...call.input });
    } catch (e) { console.error('ai/identify-exercise', e); json(res, 502, { error: 'AI request failed' }); }
  },

  // Mid-workout exercise swap (issue: change an exercise for an equivalent one). The client
  // sends the exercise you're on plus a shortlist of real catalog exercises (same muscle),
  // so the model can only ever pick things already in the library — the frontend then swaps
  // straight to a known id rather than fuzzy-matching a free-text name. `reason` is optional
  // ("machine taken", "hurts my shoulder", "no barbell") and steers the picks.

  // Meal photo (and/or a typed description) -> itemised calorie + macro estimate. The model
  // reads portion size from visual cues (plate, cutlery, hand) and returns one row per food,
  // each with an estimated weight so the client can rescale a portion without another call.
  // Photos are never stored server-side — the estimate is what gets logged, not the image.
  'POST /api/ai/analyze-meal': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    const body = await readBody(req);
    const image = String(body.image || '');
    const text = String(body.text || '').trim().slice(0, 500);
    const lang = String(body.lang || 'en').slice(0, 5);
    // Correction round: the person disagrees with an item ("it's unsweetened Greek yoghurt") —
    // resend the same photo/text plus the previous itemised estimate and their note.
    const correction = String(body.correction || '').trim().slice(0, 300);
    const previous = correction && Array.isArray(body.previous) ? body.previous.slice(0, 30).map(i => ({
      name: String(i.name || '').slice(0, 80), portion: String(i.portion || '').slice(0, 80), grams: +i.grams || 0,
      kcal: +i.kcal || 0, protein: +i.protein || 0, carbs: +i.carbs || 0, fat: +i.fat || 0,
      sugar: +i.sugar || 0, fiber: +i.fiber || 0, sodium: +i.sodium || 0 })) : null;
    const mediaType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(body.mediaType) ? body.mediaType : 'image/jpeg';
    if (image.length > 4_000_000) return json(res, 400, { error: 'image too large (send it resized client-side)' });
    if (!image && !text && !previous) return json(res, 400, { error: 'photo or description required' });
    if (aiRateLimited(user.id, 15, 60 * 60_000)) return json(res, 429, { error: 'too many meals analysed — try again in a bit' });
    if (aiOverBudget(user.id)) return json(res, 402, { error: 'AI budget for this month is used up' });
    try {
      const r = await callAnthropic(mealAnalysisRequest({ image, mediaType, text, lang, previous, correction }), { uid: user.id, feature: 'analyze-meal' });
      const call = (r.content || []).find(b => b.type === 'tool_use');
      if (!call) return json(res, 502, { error: 'no structured reply from model' });
      json(res, 200, { ok: true, ...call.input });
    } catch (e) { console.error('ai/analyze-meal', e); json(res, 502, { error: 'AI request failed' }); }
  },

  // Meal plan photo or PDF -> daily targets for the goal sheet. Nothing is stored server-side.
  // One meal of the person's diet plan -> 3 alternative recipes that keep the plan's macros and rules.
  'POST /api/ai/recipes': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    const body = await readBody(req);
    const str = (v, n) => String(v || '').slice(0, n);
    const num = v => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : undefined);
    const m = body.meal || {};
    const meal = {
      name: str(m.name, 60), time: str(m.time, 30),
      options: (Array.isArray(m.options) ? m.options : []).slice(0, 6).map(o => ({
        title: str(o.title, 80), items: (Array.isArray(o.items) ? o.items : []).slice(0, 20).map(x => str(x, 80)),
        kcal: num(o.kcal), protein: num(o.protein), carbs: num(o.carbs), fat: num(o.fat)
      }))
    };
    if (!meal.name && !meal.options.length) return json(res, 400, { error: 'meal required' });
    const targets = Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].map(k => [k, num(body.targets && body.targets[k])]).filter(([, v]) => v));
    const rules = (Array.isArray(body.rules) ? body.rules : []).slice(0, 25).map(x => str(x, 160));
    const avoid = (Array.isArray(body.avoid) ? body.avoid : []).slice(0, 12).map(x => str(x, 80));
    const lang = str(body.lang, 5) || 'en';
    if (aiRateLimited(user.id, 20, 60 * 60_000)) return json(res, 429, { error: 'too many recipe requests — try again in a bit' });
    if (aiOverBudget(user.id)) return json(res, 402, { error: 'AI budget for this month is used up' });
    try {
      const r = await callAnthropic(recipesRequest({ meal, targets, rules, lang, wish: str(body.wish, 200), avoid, mealsPerDay: num(body.mealsPerDay) }), { uid: user.id, feature: 'recipes' });
      const call = (r.content || []).find(b => b.type === 'tool_use');
      if (!call) return json(res, 502, { error: 'no structured reply from model' });
      json(res, 200, { ok: true, ...call.input });
    } catch (e) { console.error('ai/recipes', e); json(res, 502, { error: 'AI request failed' }); }
  },

  'POST /api/ai/import-plan': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    const body = await readBody(req);
    const image = String(body.image || '');
    const pdf = String(body.pdf || '');
    const lang = String(body.lang || 'en').slice(0, 5);
    const mediaType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(body.mediaType) ? body.mediaType : 'image/jpeg';
    if (!image && !pdf) return json(res, 400, { error: 'photo or PDF required' });
    if (image.length > 4_000_000 || pdf.length > 4_500_000) return json(res, 400, { error: 'file too large (max ~3 MB PDF)' });
    if (aiRateLimited(user.id, 10, 60 * 60_000)) return json(res, 429, { error: 'too many plans imported — try again in a bit' });
    if (aiOverBudget(user.id)) return json(res, 402, { error: 'AI budget for this month is used up' });
    try {
      const r = await callAnthropic(planTargetsRequest({ image, mediaType, pdf, lang }), { uid: user.id, feature: 'import-plan' });
      const call = (r.content || []).find(b => b.type === 'tool_use');
      if (!call) return json(res, 502, { error: 'no structured reply from model' });
      json(res, 200, { ok: true, ...call.input });
    } catch (e) { console.error('ai/import-plan', e); json(res, 502, { error: 'AI request failed' }); }
  },

  // Questionnaire -> weekly plan. The client sends the exercise shortlist (lib/trainer.js) so the
  // model can only pick real library ids; the client validates them again before saving.
  'POST /api/ai/trainer-plan': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    const body = await readBody(req);
    const p = body.profile || {};
    const profile = {
      goal: String(p.goal || 'general').slice(0, 20), level: String(p.level || 'beginner').slice(0, 20),
      daysPerWeek: Math.min(7, Math.max(1, +p.daysPerWeek || 3)), minutesPerSession: Math.min(180, Math.max(15, +p.minutesPerSession || 60)),
      equipment: String(p.equipment || 'gym').slice(0, 20), focus: (Array.isArray(p.focus) ? p.focus : []).slice(0, 8).map(f => String(f).slice(0, 20)),
      limitations: String(p.limitations || '').slice(0, 300), age: +p.age || null, sex: p.sex === 'female' ? 'female' : 'male',
      bodyweight: +p.bodyweight || null, targetWeight: +p.targetWeight || null, unit: p.unit === 'lb' ? 'lb' : 'kg', lang: String(p.lang || 'en').slice(0, 5)
    };
    const candidates = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 500)
      .map(c => ({ id: String(c.id || '').slice(0, 20), n: String(c.n || '').slice(0, 60), tg: String(c.tg || '').slice(0, 30), eq: String(c.eq || '').slice(0, 30) }))
      .filter(c => c.id && c.n);
    if (candidates.length < 10) return json(res, 400, { error: 'exercise candidates required' });
    if (aiRateLimited(user.id, 6, 60 * 60_000)) return json(res, 429, { error: 'you can build a new plan again in a bit' });
    if (aiOverBudget(user.id)) return json(res, 402, { error: 'AI budget for this month is used up' });
    try {
      const r = await callAnthropic(trainerPlanRequest({ profile, candidates }), { uid: user.id, feature: 'trainer-plan' });
      const call = (r.content || []).find(b => b.type === 'tool_use');
      if (!call) return json(res, 502, { error: 'no structured reply from model' });
      json(res, 200, { ok: true, ...call.input });
    } catch (e) { console.error('ai/trainer-plan', e); json(res, 502, { error: 'AI request failed' }); }
  },

  'POST /api/ai/alternatives': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    const body = await readBody(req);
    const ex = body.exercise || {};
    const reason = String(body.reason || '').trim().slice(0, 120);
    const candidates = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, 150)
      .map(c => ({ id: String(c.id || '').slice(0, 20), n: String(c.n || '').slice(0, 60), eq: String(c.eq || '').slice(0, 40), tg: String(c.tg || '').slice(0, 40) }))
      .filter(c => c.id && c.n);
    if (!ex.name || !candidates.length) return json(res, 400, { error: 'exercise and candidates required' });
    if (aiRateLimited(user.id, 20, 60_000)) return json(res, 429, { error: 'too many requests — slow down' });
    if (aiOverBudget(user.id)) return json(res, 402, { error: 'AI budget for this month is used up' });
    try {
      const r = await callAnthropic({
        max_tokens: 500,
        system: `A lifter mid-workout wants to swap the exercise "${ex.name}"` +
          (ex.target ? ` (trains ${ex.target})` : '') + (ex.equipment ? `, done with ${ex.equipment}` : '') + `. ` +
          (reason ? `Their reason for swapping: "${reason}". ` : '') +
          `Choose 3-5 alternatives from the provided candidate list that train the same muscle and are the ` +
          `closest substitutes given the reason (e.g. a machine that's free when one is taken, an easier or ` +
          `harder variation, a different implement, something that spares an aggravated joint). Only pick ids ` +
          `that appear in the candidate list. Order them best-first. For each, give a short reason ` +
          `(max ~8 words) for why it's a good swap here.`,
        messages: [{ role: 'user', content: JSON.stringify({ current: ex, candidates }) }],
        tools: [{
          name: 'suggest_alternatives',
          description: 'The chosen alternative exercises',
          input_schema: {
            type: 'object',
            properties: {
              alternatives: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'exercise id, MUST be one from the candidate list' },
                    why: { type: 'string', description: 'short reason this is a good swap' }
                  },
                  required: ['id', 'why']
                }
              }
            },
            required: ['alternatives']
          }
        }],
        tool_choice: { type: 'tool', name: 'suggest_alternatives' }
      }, { uid: user.id, feature: 'alternatives' });
      const call = (r.content || []).find(b => b.type === 'tool_use');
      if (!call) return json(res, 502, { error: 'no structured reply from model' });
      // Keep only ids the client actually offered — the model is grounded, but this is cheap insurance
      // against a hallucinated id the frontend then couldn't resolve.
      const valid = new Set(candidates.map(c => c.id));
      const alternatives = (call.input.alternatives || []).filter(a => valid.has(a.id)).slice(0, 6);
      json(res, 200, { ok: true, alternatives });
    } catch (e) { console.error('ai/alternatives', e); json(res, 502, { error: 'AI request failed' }); }
  }
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // CORS for the store apps: they load from capacitor://localhost (iOS) / https://localhost
  // (Android) and call this API cross-origin with a bearer token. Only the allowed shell
  // origins get the headers; the web app is same-origin and needs none.
  const reqOrigin = req.headers.origin;
  if (reqOrigin && reqOrigin !== ORIGIN && ALLOWED_ORIGINS.has(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  // Paid feature gate (docs/BILLING.md): the AI routes need an active trial or subscription.
  // Checked here, once, so no route can forget it.
  if (BILLING_ENABLED && handler && url.pathname.startsWith('/api/ai/')) {
    const u = readSession(req);
    if (u && !entitlement(u).active) return json(res, 402, { error: 'subscription required', code: 'subscription_required' });
  }
  if (!handler) return json(res, 404, { error: 'not found' });
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin && !ALLOWED_ORIGINS.has(req.headers.origin)) {
    return json(res, 403, { error: 'cross-origin request refused' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
