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
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';
// AI features (natural-language set logging, coach insights) are entirely optional — unset
// this and both endpoints answer 501 instead of the frontend silently failing on a fetch.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

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
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
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
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
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
function aiRateLimited(uid, limit, windowMs) {
  const now = Date.now();
  const hits = (aiHits.get(uid) || []).filter(t => now - t < windowMs);
  if (hits.length >= limit) return true;
  hits.push(now);
  aiHits.set(uid, hits);
  return false;
}
async function callAnthropic({ system, messages, tools, tool_choice, max_tokens }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: max_tokens || 1024, system, messages, tools, tool_choice })
  });
  if (!r.ok) throw new Error('anthropic ' + r.status + ': ' + (await r.text()).slice(0, 300));
  return r.json();
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
      '- Split by availability: 2-3 days → full body; 4 days → upper/lower; 5-6 days → push/pull/legs or upper/lower/full. Each muscle trained ~2× per week.\n' +
      '- Weekly volume per major muscle: beginners ~8-12 hard sets, intermediates 12-18, advanced 15-22.\n' +
      '- Strength goal: main compound lifts 3-6 reps, 3-5 sets, 2-4 min rest; accessories 6-12. Muscle goal: 6-12 reps on compounds, 10-20 on isolation, 1.5-3 min rest, sets 1-3 reps from failure. Fat loss: keep resistance training (it preserves muscle in a deficit), moderate reps, plus 2-4 cardio sessions. Endurance: zone-2 cardio, intervals once a week, full-body strength 2× to keep tissue robust. General health: 2-3 full-body sessions + cardio, all major patterns (squat, hinge, push, pull, carry).\n' +
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
          summary: { type: 'string' },
          split: { type: 'string', description: 'short split name, e.g. "Upper / Lower"' },
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
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
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
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
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
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
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
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
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
    const users = db.users.map(u => {
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
  'POST /api/ai/parse-set': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    if (!ANTHROPIC_API_KEY) return json(res, 501, { error: 'AI not configured on this server' });
    const body = await readBody(req);
    const text = String(body.text || '').trim().slice(0, 300);
    if (!text) return json(res, 400, { error: 'text required' });
    if (aiRateLimited(user.id, 20, 60_000)) return json(res, 429, { error: 'too many requests — slow down' });
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
      });
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
    if (aiRateLimited(user.id, 5, 60 * 60_000)) return json(res, 429, { error: 'you can ask for a new read-out again in a bit' });
    const S = readState(user.id);
    if (!S || !(S.workouts || []).length) return json(res, 400, { error: 'log a few workouts first' });
    // Keep the prompt small and cheap: last 15 sessions, only what a coach would actually look
    // at — no settings, no push subscriptions, no ids that mean nothing off-device.
    const recent = S.workouts.slice(-15).map(w => ({
      date: w.d,
      entries: (w.entries || []).map(e => ({
        id: e.id,
        target: e.target,
        sets: (e.sets || []).map(s => ({ done: !!s.done, r: s.r, w: s.w, sec: s.sec, min: s.min }))
      }))
    }));
    const routines = (S.routines || []).map(r => ({ name: r.name, prog: r.prog || 'linear', exCount: (r.ex || []).length }));
    try {
      const r = await callAnthropic({
        max_tokens: 700,
        system: `You are a concise, encouraging strength-training coach reviewing a client's recent logged ` +
          `workouts (raw JSON: routines they follow, then up to 15 sessions with each exercise's target vs what ` +
          `was actually done — "done" sets counted as hit). Weight unit is ${S.unit || 'kg'}. Exercise ids are ` +
          `from a public exercise database and not human-readable — refer to exercises by their role (e.g. ` +
          `"your pressing work", "the leg curl") rather than by id. Write 150-250 words in plain language: ` +
          `what's trending well, where reps/weight have stalled across sessions, and 1-3 concrete, specific ` +
          `suggestions (e.g. a deload, a technique check, adding a set). No markdown headers, just prose. ` +
          `Respond in ${S.lang === 'es' ? 'Spanish' : 'English'}.`,
        messages: [{ role: 'user', content: JSON.stringify({ routines, recent }) }]
      });
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
      });
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
    try {
      const r = await callAnthropic(mealAnalysisRequest({ image, mediaType, text, lang, previous, correction }));
      const call = (r.content || []).find(b => b.type === 'tool_use');
      if (!call) return json(res, 502, { error: 'no structured reply from model' });
      json(res, 200, { ok: true, ...call.input });
    } catch (e) { console.error('ai/analyze-meal', e); json(res, 502, { error: 'AI request failed' }); }
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
    try {
      const r = await callAnthropic(trainerPlanRequest({ profile, candidates }));
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
      });
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
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
