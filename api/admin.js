// Operations console backend (docs/ADMIN_PANEL.md). Everything here is additive: new routes
// under /api/admin/*, a role field on staff accounts, an append-only audit log and an in-memory
// request log. Nothing in the end-user auth or billing paths changes.
//
// Security model
//   roles      owner > admin > support | finance | viewer. A permission table says which roles may
//              call which routes; `isAdmin` (free access, admin UI link) is true for any staff role.
//   step-up    staff must re-prove themselves (password or passkey) before the console answers;
//              the grant lasts STEPUP_HOURS and is bound to the client's IP prefix + user agent.
//   audit      every mutation (and sensitive user events the server reports) is appended to
//              /data/audit.log as JSON lines, each carrying the sha256 of the previous line, so a
//              removed or edited entry breaks the chain. Never deleted from the UI.
//   limits     20 admin requests/min per staff account; repeated denials alert the owners.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROLES = ['owner', 'admin', 'support', 'finance', 'viewer'];
const PERMS = {
  'overview.read': ['owner', 'admin', 'support', 'finance', 'viewer'],
  'users.read': ['owner', 'admin', 'support', 'finance', 'viewer'],
  'users.write': ['owner', 'admin', 'support'],
  'users.delete': ['owner', 'admin'],
  'billing.read': ['owner', 'admin', 'finance'],
  'billing.write': ['owner', 'finance'],
  'coupons.read': ['owner', 'admin', 'finance', 'support'],
  'coupons.write': ['owner', 'admin', 'finance'],
  'ai.read': ['owner', 'admin', 'support', 'finance', 'viewer'],
  'team.read': ['owner', 'admin', 'support', 'finance', 'viewer'],
  'team.write': ['owner'],
  'audit.read': ['owner', 'admin'],
  'logs.read': ['owner', 'admin'],
  'system.read': ['owner', 'admin'],
  'system.write': ['owner'],
  'invites.write': ['owner', 'admin', 'support']
};
const STEPUP_HOURS = 12;
const ADMIN_RPM = 90;   // the console polls (overview 30 s, logs 10 s): generous for humans, still a wall for scripts
const TRIAL_EXTEND_MAX = 30;      // days a support/admin may add per action
const COMP_DAYS_MAX_STAFF = 30;   // owner/finance may grant more

export const roleOf = user => (user && ROLES.includes(user.role) ? user.role : null);
export const can = (user, perm) => { const r = roleOf(user); return !!r && (PERMS[perm] || []).includes(r); };

export function createAdmin(ctx) {
  const { db, saveDb, readSession, json, readBody, readState, DATA, ORIGIN, clientIp, sendEmail } = ctx;
  db.stepUp = db.stepUp || {};            // uid -> { exp, ipp, ua, at }
  db.teamInvites = db.teamInvites || [];  // legacy field kept for forward compat (unused for now)
  db.flags = db.flags || {};              // { signups: true, ai: true, payments: true, banner: '' }
  db.health = db.health || {};            // { stripe: { lastEventAt, lastError }, revenuecat: {...} }
  db.notes = db.notes || {};              // uid -> [{ t, by, text }]

  // Legacy admins become owners once; ADMIN_UIDS stays an env-level override.
  for (const u of db.users) if (!roleOf(u) && ctx.isLegacyAdmin(u)) u.role = 'owner';
  saveDb();

  /* ---------- audit log (hash chain) ---------- */
  const auditFile = path.join(DATA, 'audit.log');
  let lastHash = '';
  try {
    const fd = fs.openSync(auditFile, 'r'); const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 64 * 1024); const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    const lines = buf.toString('utf8').trim().split('\n').filter(Boolean);
    if (lines.length) lastHash = JSON.parse(lines[lines.length - 1]).hash || '';
  } catch { /* no log yet */ }
  const ipPrefix = raw => { const ip = String(raw || '').replace(/^::ffff:/i, ''); const v4 = /^(\d+\.\d+\.\d+)\.\d+$/.exec(ip); if (v4) return v4[1] + '.x'; const i = ip.indexOf(':'); return i > 0 ? ip.split(':').slice(0, 4).join(':') + '::' : ip; };
  const uaHash = ua => crypto.createHash('sha256').update(String(ua || '')).digest('hex').slice(0, 12);
  function audit(req, actor, action, target, extra = {}) {
    const entry = {
      t: new Date().toISOString(), id: crypto.randomBytes(6).toString('hex'),
      actor: actor ? actor.id : null, actorName: actor ? actor.name : null, actorRole: roleOf(actor),
      action, target: target || null, ...extra,
      ip: req ? ipPrefix(clientIp(req)) : null, ua: req ? uaHash(req.headers['user-agent']) : null, prev: lastHash
    };
    entry.hash = crypto.createHash('sha256').update(lastHash + JSON.stringify({ ...entry, hash: undefined })).digest('hex');
    lastHash = entry.hash;
    try { fs.appendFileSync(auditFile, JSON.stringify(entry) + '\n', { mode: 0o600 }); } catch (e) { console.error('audit append', e.message); }
    return entry;
  }
  function readAudit({ limit = 200, q = '', action = '', actor = '', target = '', since = '' } = {}) {
    let text = ''; try { text = fs.readFileSync(auditFile, 'utf8'); } catch { return []; }
    const out = [];
    const lines = text.trim().split('\n');
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      if (!lines[i]) continue;
      let e; try { e = JSON.parse(lines[i]); } catch { continue; }
      if (action && e.action !== action) continue;
      if (actor && e.actor !== actor) continue;
      if (target && e.target !== target) continue;
      if (since && e.t < since) continue;
      if (q && !JSON.stringify(e).toLowerCase().includes(q.toLowerCase())) continue;
      out.push(e);
    }
    return out;
  }
  function verifyAudit() {
    let text = ''; try { text = fs.readFileSync(auditFile, 'utf8'); } catch { return { ok: true, entries: 0 }; }
    let prev = '', n = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { return { ok: false, entries: n, error: 'unparsable line after ' + n }; }
      const { hash, ...rest } = e;
      const expect = crypto.createHash('sha256').update(prev + JSON.stringify({ ...rest, hash: undefined })).digest('hex');
      if (e.prev !== prev || hash !== expect) return { ok: false, entries: n, error: 'chain broken at entry ' + (n + 1) + ' (' + e.id + ')' };
      prev = hash; n++;
    }
    return { ok: true, entries: n };
  }

  /* ---------- request log ring (PII-free) ---------- */
  const ring = []; const RING = 3000;
  function logRequest(rec) { ring.push(rec); if (ring.length > RING) ring.splice(0, ring.length - RING); if (process.env.LOG_JSON !== '0') process.stdout.write(JSON.stringify(rec) + '\n'); }

  /* ---------- owners' alerts ---------- */
  const owners = () => db.users.filter(u => roleOf(u) === 'owner' && u.email && u.emailVerified && !u.disabled && !u.deletedAt);
  async function alertOwners(subject, text) {
    for (const o of owners()) { try { await sendEmail({ to: o.email, subject: '[VantixGym admin] ' + subject, text }); } catch (e) { console.error('alert mail', e.message); } }
  }

  /* ---------- guards ---------- */
  const rpm = new Map();   // uid -> timestamps
  const denials = new Map();
  function limited(uid) {
    const now = Date.now(); const arr = (rpm.get(uid) || []).filter(t => now - t < 60_000); arr.push(now); rpm.set(uid, arr); return arr.length > ADMIN_RPM;
  }
  function stepUpOk(user, req) {
    const s = db.stepUp[user.id]; if (!s || s.exp < Date.now()) return false;
    return s.ipp === ipPrefix(clientIp(req)) && s.ua === uaHash(req.headers['user-agent']);
  }
  // Resolves the staff member for `perm`, answering 401/403/428/429 itself when it can't.
  function guard(req, res, perm, { stepUp = true } = {}) {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    if (!roleOf(user)) { json(res, 403, { error: 'forbidden' }); return null; }
    if (limited(user.id)) { json(res, 429, { error: 'slow down' }); return null; }
    if (stepUp && !stepUpOk(user, req)) { json(res, 428, { error: 'step-up required', code: 'stepup_required' }); return null; }
    if (perm && !can(user, perm)) {
      audit(req, user, 'admin.denied', null, { perm });
      const d = (denials.get(user.id) || 0) + 1; denials.set(user.id, d);
      if (d === 3) alertOwners('repeated denied admin actions', `${user.name} (${user.email || user.id}, role ${roleOf(user)}) was refused 3 admin actions (last: ${perm}).`);
      json(res, 403, { error: 'your role cannot do that' }); return null;
    }
    return user;
  }
  const q = req => new URL(req.url, 'http://x').searchParams;
  const safeUser = u => ({
    id: u.id, name: u.name, email: u.email || null, emailVerified: !!u.emailVerified, created: u.created || null,
    role: roleOf(u), disabled: !!u.disabled, deletedAt: u.deletedAt || null,
    hasPassword: !!u.pw, hasGoogle: !!u.googleSub, hasApple: !!u.appleSub, hasPasskey: db.creds.some(c => c.userId === u.id),
    billing: ctx.entitlement(u), subscriptionStatus: u.subscriptionStatus || null, stripeCustomer: u.stripeCustomerId ? u.stripeCustomerId.slice(0, 8) + '…' : null,
    storeSandbox: !!u.storeSandbox, referredBy: u.referredBy || null, referrals: (u.referrals || []).length, refCode: u.refCode || null,
    invitedBy: u.invitedBy || null, trialMsgs: u.trialMsgs || null
  });
  const mask = s => (s ? String(s).slice(0, 7) + '…' : null);

  /* ---------- metrics ---------- */
  function overview() {
    const now = Date.now(), day = 86400_000;
    const users = db.users.filter(u => !u.deletedAt);
    const ent = users.map(u => ({ u, e: ctx.entitlement(u), S: readState(u.id) || {} }));
    const by = (arr, f) => arr.reduce((m, x) => { const k = f(x) || 'none'; m[k] = (m[k] || 0) + 1; return m; }, {});
    const pro = ent.filter(x => x.e.status === 'pro');
    const planAmt = id => (ctx.PLANS.find(p => p.id === id) || {});
    const mrr = pro.reduce((a, x) => { const p = planAmt(x.u.plan); return a + (p.amount && p.months ? p.amount / p.months : 0); }, 0);
    const olderThan7 = ent.filter(x => x.u.created && now - Date.parse(x.u.created) > 7 * day && !roleOf(x.u));
    const converted = olderThan7.filter(x => x.u.tierUntil && x.u.provider).length;
    const active = ms => ent.filter(x => x.S._ts && now - x.S._ts < ms).length;
    const month = ctx.monthKey();
    const ai = Object.values(db.aiUsage).reduce((a, u) => { const m = u[month] || {}; a.usd += m.usd || 0; a.calls += m.calls || 0; return a; }, { usd: 0, calls: 0 });
    let backup = null; try { backup = JSON.parse(fs.readFileSync(path.join(DATA, '.last-backup'), 'utf8')); } catch { /* none */ }
    const attention = [];
    for (const x of ent) {
      if (x.u.subscriptionStatus === 'past_due') attention.push({ kind: 'past_due', id: x.u.id, name: x.u.name, detail: 'payment failed, retrying' });
      if (x.u.email && !x.u.emailVerified && x.u.created && now - Date.parse(x.u.created) > 3 * day && x.e.status === 'trial') attention.push({ kind: 'unverified', id: x.u.id, name: x.u.name, detail: 'trial, email unverified > 3 d' });
      if (x.u.deletedAt) attention.push({ kind: 'deleting', id: x.u.id, name: x.u.name, detail: 'purge on ' + x.u.deletedAt.slice(0, 10) });
    }
    if (backup && now - Date.parse(backup.at) > 2 * day) attention.push({ kind: 'backup', detail: 'last backup ' + backup.at });
    if (!backup) attention.push({ kind: 'backup', detail: 'no backup marker yet (scripts/backup.sh writes data/.last-backup)' });
    if (db.health.stripe?.lastError) attention.push({ kind: 'webhook', detail: 'Stripe webhook error: ' + db.health.stripe.lastError });
    if (db.health.revenuecat?.lastError) attention.push({ kind: 'webhook', detail: 'RevenueCat webhook error: ' + db.health.revenuecat.lastError });
    return {
      users: users.length, staff: users.filter(u => roleOf(u)).length, verified: users.filter(u => u.emailVerified).length,
      status: by(ent, x => x.e.status), provider: by(pro, x => x.u.provider), plan: by(pro, x => x.u.plan),
      mrr: Math.round(mrr), currency: ctx.CURRENCY, cancelling: pro.filter(x => x.u.cancelAtPeriodEnd).length,
      conversion7d: olderThan7.length ? Math.round(100 * converted / olderThan7.length) : null, cohort7d: olderThan7.length,
      dau: active(day), wau: active(7 * day), mau: active(30 * day), live: [...ctx.presence.keys()].length,
      ai: { ...ai, usd: Math.round(ai.usd * 100) / 100, capUser: ctx.AI_MONTHLY_USD_CAP || null, capGlobal: ctx.AI_GLOBAL_MONTHLY_USD_CAP || null, month },
      signups7d: users.filter(u => u.created && now - Date.parse(u.created) < 7 * day).length,
      backup, flags: db.flags, attention
    };
  }

  /* ---------- Stripe helpers (plain REST through ctx.stripe) ---------- */
  const stripeOn = () => ctx.hasStripe();
  async function stripeList(pathname, params = {}) {
    const usp = new URLSearchParams({ limit: '100', ...params });
    return ctx.stripe('GET', pathname + '?' + usp.toString());
  }

  const routes = {
    /* ----- step-up ----- */
    'GET /api/admin/me': async (req, res) => {
      const user = readSession(req);
      if (!user || !roleOf(user)) return json(res, 403, { error: 'forbidden' });
      json(res, 200, { role: roleOf(user), stepUp: stepUpOk(user, req), hasPassword: !!user.pw, hasPasskey: db.creds.some(c => c.userId === user.id), perms: Object.fromEntries(Object.keys(PERMS).map(p => [p, can(user, p)])) });
    },
    // Password step-up. Passkey step-up reuses /api/login/options and posts the assertion here.
    'POST /api/admin/stepup': async (req, res) => {
      const user = readSession(req);
      if (!user || !roleOf(user)) return json(res, 403, { error: 'forbidden' });
      if (limited(user.id)) return json(res, 429, { error: 'slow down' });
      const body = await readBody(req);
      let ok = false, how = '';
      if (body.password && user.pw) { ok = ctx.verifyPassword(String(body.password), user.pw); how = 'password'; }
      else if (body.cid && body.credential) { ok = await ctx.verifyPasskeyFor(user, body.cid, body.credential); how = 'passkey'; }
      if (!ok) { audit(req, user, 'admin.stepup.failed', user.id, { how }); return json(res, 401, { error: 'verification failed' }); }
      const prev = db.stepUp[user.id];
      const ua = uaHash(req.headers['user-agent']), ipp = ipPrefix(clientIp(req));
      db.stepUp[user.id] = { exp: Date.now() + STEPUP_HOURS * 3600_000, ipp, ua, at: new Date().toISOString(), seen: [...new Set([...(prev?.seen || []), ua])].slice(-10) };
      saveDb();
      audit(req, user, 'admin.stepup', user.id, { how });
      if (!(prev?.seen || []).includes(ua)) alertOwners('admin console opened from a new device', `${user.name} (${user.email || user.id}, ${roleOf(user)}) passed step-up from a new browser/device, network ${ipp}. If this wasn't them, remove their role in Team.`);
      json(res, 200, { ok: true, until: db.stepUp[user.id].exp });
    },
    'POST /api/admin/stepdown': async (req, res) => {
      const user = readSession(req);
      if (user) { delete db.stepUp[user.id]; saveDb(); }
      json(res, 200, { ok: true });
    },

    /* ----- overview ----- */
    'GET /api/admin/overview': async (req, res) => { if (!guard(req, res, 'overview.read')) return; json(res, 200, overview()); },

    /* ----- users ----- */
    'GET /api/admin/users': async (req, res) => {
      if (!guard(req, res, 'users.read')) return;
      const p = q(req); const text = (p.get('q') || '').toLowerCase(); const status = p.get('status') || ''; const provider = p.get('provider') || ''; const plan = p.get('plan') || '';
      const rows = db.users.filter(u => !u.deletedAt || p.get('deleted') === '1').map(u => {
        const S = readState(u.id) || {}; const workouts = S.workouts || [];
        return { ...safeUser(u), workouts: workouts.length, lastWorkout: workouts.length ? workouts[workouts.length - 1].d : null, lastSync: S._ts || null, lang: S.lang || null, live: ctx.livePresence(u.id), hasPush: db.subs.some(s => s.userId === u.id) };
      }).filter(r => (!text || (r.name || '').toLowerCase().includes(text) || (r.email || '').toLowerCase().includes(text) || r.id.toLowerCase() === text)
        && (!status || r.billing.status === status) && (!provider || r.billing.provider === provider) && (!plan || r.billing.plan === plan));
      rows.sort((a, b) => (b.lastSync || 0) - (a.lastSync || 0));
      json(res, 200, { users: rows, now: Date.now(), invite_only: ctx.INVITE_ONLY });
    },
    'GET /api/admin/user': async (req, res) => {
      const me = guard(req, res, 'users.read'); if (!me) return;
      const u = db.users.find(x => x.id === q(req).get('id'));
      if (!u) return json(res, 404, { error: 'no such user' });
      const S = readState(u.id) || {};
      const month = ctx.monthKey();
      json(res, 200, {
        user: { ...safeUser(u), trialEnds: u.trialEnds || null, tierUntil: u.tierUntil || null, plan: u.plan || null, provider: u.provider || null, cancelAtPeriodEnd: !!u.cancelAtPeriodEnd, stripeSubscription: mask(u.stripeSubscriptionId), referralEarnedDays: u.referralEarnedDays || 0, sv: u.sv || 0 },
        unit: S.unit || 'kg', lang: S.lang || null, lastSync: S._ts || null,
        counts: { workouts: (S.workouts || []).length, meals: (S.meals || []).length, bodyweight: (S.bodyweight || []).length, routines: (S.routines || []).length, photos: ctx.listPhotos(u.id).length },
        workouts: (S.workouts || []).slice(-40).reverse().map(w => ({ id: w.id, name: w.name, d: w.d, start: w.start, end: w.end, sets: (w.ex || []).reduce((a, e) => a + (e.sets || []).filter(s => s.done).length, 0), prs: (w.prs || []).length })),
        ai: { month, ...ctx.aiUsageOf(u.id) },
        notes: db.notes[u.id] || [],
        audit: can(me, 'audit.read') ? readAudit({ target: u.id, limit: 50 }) : []
      });
    },
    'POST /api/admin/user/action': async (req, res) => {
      const me = guard(req, res, 'users.write'); if (!me) return;
      const body = await readBody(req);
      const u = db.users.find(x => x.id === body.id);
      if (!u) return json(res, 404, { error: 'no such user' });
      const act = String(body.action || '');
      const isStaff = !!roleOf(u);
      const before = { disabled: !!u.disabled, trialEnds: u.trialEnds || null, tierUntil: u.tierUntil || null, sv: u.sv || 0, role: roleOf(u) };
      if (isStaff && u.id !== me.id && roleOf(me) !== 'owner' && ['disable', 'signout_all', 'delete'].includes(act)) return json(res, 403, { error: 'only an owner can act on staff accounts' });
      switch (act) {
        case 'disable': if (roleOf(u) === 'owner') return json(res, 400, { error: 'owners cannot be disabled' }); u.disabled = true; ctx.presence.delete(u.id); break;
        case 'enable': u.disabled = false; break;
        case 'signout_all': u.sv = (u.sv || 0) + 1; break;
        case 'resend_verify': if (!u.email || u.emailVerified) return json(res, 400, { error: 'nothing to verify' }); await ctx.sendVerifyMail(u); break;
        case 'extend_trial': {
          const days = Math.round(+body.days || 0);
          if (days < 1 || days > TRIAL_EXTEND_MAX) return json(res, 400, { error: `1 to ${TRIAL_EXTEND_MAX} days` });
          u.trialEnds = ctx.addDays(u.trialEnds, days); break;
        }
        case 'comp_days': {
          const days = Math.round(+body.days || 0);
          const max = ['owner', 'finance'].includes(roleOf(me)) ? 366 : COMP_DAYS_MAX_STAFF;
          if (days < 1 || days > max) return json(res, 400, { error: `1 to ${max} days for your role` });
          u.tierUntil = ctx.addDays(u.tierUntil, days); if (!u.provider) u.provider = 'comp'; if (!u.plan) u.plan = 'comp'; break;
        }
        case 'note': {
          const text = String(body.text || '').replace(/[ -]/g, ' ').trim().slice(0, 500);
          if (!text) return json(res, 400, { error: 'empty note' });
          db.notes[u.id] = [...(db.notes[u.id] || []), { t: new Date().toISOString(), by: me.name, text }].slice(-50); break;
        }
        case 'delete': {
          if (!can(me, 'users.delete')) return json(res, 403, { error: 'your role cannot delete accounts' });
          if (roleOf(u)) return json(res, 400, { error: 'remove the role first' });
          u.deletedAt = new Date().toISOString(); u.sv = (u.sv || 0) + 1; ctx.presence.delete(u.id); break;
        }
        case 'undelete': { if (!can(me, 'users.delete')) return json(res, 403, { error: 'your role cannot restore accounts' }); delete u.deletedAt; break; }
        case 'stripe_pull': {
          if (!stripeOn() || !u.stripeSubscriptionId) return json(res, 400, { error: 'no Stripe subscription' });
          ctx.applySubscription(await ctx.stripe('GET', '/subscriptions/' + u.stripeSubscriptionId)); break;
        }
        case 'rc_sync': {
          if (!ctx.hasRevenueCat()) return json(res, 501, { error: 'RevenueCat secret key not configured' });
          await ctx.syncStoreSubscriber(u); break;
        }
        default: return json(res, 400, { error: 'unknown action' });
      }
      saveDb();
      const after = { disabled: !!u.disabled, trialEnds: u.trialEnds || null, tierUntil: u.tierUntil || null, sv: u.sv || 0, role: roleOf(u) };
      audit(req, me, 'user.' + act, u.id, { targetName: u.name, days: body.days, before, after });
      json(res, 200, { ok: true, user: safeUser(u) });
    },
    'GET /api/admin/user/export': async (req, res) => {
      const me = guard(req, res, 'users.delete'); if (!me) return;
      const u = db.users.find(x => x.id === q(req).get('id'));
      if (!u) return json(res, 404, { error: 'no such user' });
      audit(req, me, 'user.export', u.id, { targetName: u.name });
      const { pw, ...account } = u; void pw;
      json(res, 200, { account, state: readState(u.id), notes: db.notes[u.id] || [] });
    },

    /* ----- billing ----- */
    'GET /api/admin/billing': async (req, res) => {
      if (!guard(req, res, 'billing.read')) return;
      const out = { stripe: { configured: stripeOn(), health: db.health.stripe || null }, revenuecat: { configured: ctx.hasRevenueCat(), health: db.health.revenuecat || null }, pastDue: [], store: [] };
      for (const u of db.users) {
        if (u.subscriptionStatus === 'past_due') out.pastDue.push({ ...safeUser(u) });
        if (u.provider === 'apple' || u.provider === 'google') out.store.push({ id: u.id, name: u.name, provider: u.provider, plan: u.plan, tierUntil: u.tierUntil, sandbox: !!u.storeSandbox, cancel: !!u.cancelAtPeriodEnd });
      }
      if (stripeOn()) {
        try {
          const subs = await stripeList('/subscriptions', { status: 'all' });
          out.stripe.subscriptions = subs.data.map(s => ({ id: s.id, status: s.status, customer: s.customer, userId: s.metadata?.userId || null, userName: (db.users.find(u => u.id === s.metadata?.userId) || {}).name || null, plan: s.metadata?.plan || null, cancelAtPeriodEnd: s.cancel_at_period_end, periodEnd: (s.items?.data?.[0]?.current_period_end || s.current_period_end || 0) * 1000, trialEnd: (s.trial_end || 0) * 1000, created: s.created * 1000 }));
          const bal = await ctx.stripe('GET', '/balance');
          out.stripe.balance = { available: (bal.available || []).map(b => ({ amount: b.amount / 100, currency: b.currency })), pending: (bal.pending || []).map(b => ({ amount: b.amount / 100, currency: b.currency })) };
          const inv = await stripeList('/invoices', { limit: '30' });
          out.stripe.invoices = inv.data.map(i => ({ id: i.id, number: i.number, status: i.status, total: i.total / 100, currency: i.currency, created: i.created * 1000, customer: i.customer, userName: (db.users.find(u => u.stripeCustomerId === i.customer) || {}).name || null, hostedUrl: i.hosted_invoice_url || null, charge: i.charge || null }));
        } catch (e) { out.stripe.error = e.message; }
      }
      json(res, 200, out);
    },
    'POST /api/admin/billing/refund': async (req, res) => {
      const me = guard(req, res, 'billing.write'); if (!me) return;
      if (!stripeOn()) return json(res, 501, { error: 'Stripe not configured' });
      const body = await readBody(req);
      const charge = String(body.charge || ''); const amount = body.amount ? Math.round(+body.amount * 100) : undefined;
      if (!/^ch_[A-Za-z0-9]+$/.test(charge)) return json(res, 400, { error: 'charge id required' });
      try {
        const r = await ctx.stripe('POST', '/refunds', { charge, ...(amount ? { amount } : {}), reason: 'requested_by_customer' });
        audit(req, me, 'billing.refund', charge, { amount: r.amount / 100, currency: r.currency, userId: body.userId || null });
        json(res, 200, { ok: true, refund: { id: r.id, amount: r.amount / 100, status: r.status } });
      } catch (e) { json(res, 502, { error: e.message }); }
    },

    /* ----- coupons (Stripe) ----- */
    'GET /api/admin/coupons': async (req, res) => {
      if (!guard(req, res, 'coupons.read')) return;
      if (!stripeOn()) return json(res, 200, { configured: false, coupons: [], promos: [] });
      try {
        const [c, p] = await Promise.all([stripeList('/coupons'), stripeList('/promotion_codes')]);
        json(res, 200, { configured: true,
          coupons: c.data.map(x => ({ id: x.id, name: x.name, percent: x.percent_off, amount: x.amount_off ? x.amount_off / 100 : null, currency: x.currency, duration: x.duration, months: x.duration_in_months, max: x.max_redemptions, redeemed: x.times_redeemed, redeemBy: x.redeem_by ? x.redeem_by * 1000 : null, valid: x.valid })),
          promos: p.data.map(x => ({ id: x.id, code: x.code, coupon: x.coupon?.id, active: x.active, max: x.max_redemptions, redeemed: x.times_redeemed, expires: x.expires_at ? x.expires_at * 1000 : null, firstTime: !!x.restrictions?.first_time_transaction })),
          referralCoupon: ctx.STRIPE_REFERRAL_COUPON || null, rescueCoupon: ctx.STRIPE_RESCUE_COUPON || null });
      } catch (e) { json(res, 502, { error: e.message }); }
    },
    'POST /api/admin/coupons': async (req, res) => {
      const me = guard(req, res, 'coupons.write'); if (!me) return;
      if (!stripeOn()) return json(res, 501, { error: 'Stripe not configured' });
      const b = await readBody(req);
      const name = String(b.name || '').trim().slice(0, 40); const code = String(b.code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
      const percent = b.percent ? Math.round(+b.percent) : 0; const amount = b.amount ? Math.round(+b.amount * 100) : 0;
      if (!name || (!percent && !amount) || (percent && (percent < 1 || percent > 100))) return json(res, 400, { error: 'name and a percent (1–100) or an amount are required' });
      if (percent > 50 && roleOf(me) !== 'owner') return json(res, 403, { error: 'discounts over 50 % need an owner' });
      const duration = ['once', 'repeating', 'forever'].includes(b.duration) ? b.duration : 'once';
      try {
        const coupon = await ctx.stripe('POST', '/coupons', { name, ...(percent ? { percent_off: percent } : { amount_off: amount, currency: ctx.CURRENCY.toLowerCase() }), duration, ...(duration === 'repeating' ? { duration_in_months: Math.max(1, Math.min(12, Math.round(+b.months || 3))) } : {}), ...(b.max ? { max_redemptions: Math.max(1, Math.round(+b.max)) } : {}), ...(b.redeemBy ? { redeem_by: Math.floor(Date.parse(b.redeemBy) / 1000) } : {}) });
        let promo = null;
        if (code) promo = await ctx.stripe('POST', '/promotion_codes', { coupon: coupon.id, code, ...(b.max ? { max_redemptions: Math.max(1, Math.round(+b.max)) } : {}), ...(b.redeemBy ? { expires_at: Math.floor(Date.parse(b.redeemBy) / 1000) } : {}), ...(b.firstTime ? { 'restrictions[first_time_transaction]': 'true' } : {}) });
        audit(req, me, 'coupon.create', coupon.id, { name, code: code || null, percent: percent || null, amount: amount ? amount / 100 : null, duration });
        if (percent > 50) alertOwners('large coupon created', `${me.name} created coupon "${name}" (${percent} % off${code ? ', code ' + code : ''}).`);
        json(res, 200, { ok: true, coupon: { id: coupon.id }, promo: promo && { id: promo.id, code: promo.code } });
      } catch (e) { json(res, 502, { error: e.message }); }
    },
    'POST /api/admin/coupons/deactivate': async (req, res) => {
      const me = guard(req, res, 'coupons.write'); if (!me) return;
      if (!stripeOn()) return json(res, 501, { error: 'Stripe not configured' });
      const b = await readBody(req);
      try {
        if (/^promo_/.test(b.id || '')) await ctx.stripe('POST', '/promotion_codes/' + b.id, { active: 'false' });
        else if (b.id) await ctx.stripe('DELETE', '/coupons/' + encodeURIComponent(b.id));
        else return json(res, 400, { error: 'id required' });
        audit(req, me, 'coupon.deactivate', b.id);
        json(res, 200, { ok: true });
      } catch (e) { json(res, 502, { error: e.message }); }
    },

    /* ----- team ----- */
    'GET /api/admin/team': async (req, res) => {
      if (!guard(req, res, 'team.read')) return;
      json(res, 200, { roles: ROLES, perms: PERMS, members: db.users.filter(u => roleOf(u) && !u.deletedAt).map(u => ({ ...safeUser(u), stepUpAt: db.stepUp[u.id]?.at || null, stepUpActive: !!(db.stepUp[u.id] && db.stepUp[u.id].exp > Date.now()) })) });
    },
    // Grants or removes a role on an EXISTING account (people sign up first, then get a role).
    'POST /api/admin/team/role': async (req, res) => {
      const me = guard(req, res, 'team.write'); if (!me) return;
      const b = await readBody(req);
      const target = db.users.find(u => u.id === b.id || (b.email && u.email === String(b.email).trim().toLowerCase()));
      if (!target || target.deletedAt) return json(res, 404, { error: 'no account with that email — they need to sign up first' });
      const role = b.role ? String(b.role) : null;
      if (role && !ROLES.includes(role)) return json(res, 400, { error: 'unknown role' });
      if (target.id === me.id && role !== 'owner') return json(res, 400, { error: 'you cannot demote yourself' });
      if (roleOf(target) === 'owner' && role !== 'owner' && owners().length <= 1) return json(res, 400, { error: 'there must always be one owner' });
      if (role && target.email && !target.emailVerified) return json(res, 400, { error: 'their email must be verified first' });
      const before = roleOf(target);
      if (role) target.role = role; else { delete target.role; delete target.admin; }
      delete db.stepUp[target.id];
      saveDb();
      audit(req, me, 'team.role', target.id, { targetName: target.name, before, after: role });
      alertOwners('role change', `${me.name} set ${target.name} (${target.email || target.id}) from ${before || 'none'} to ${role || 'none'}.`);
      if (target.email && role) { try { await sendEmail({ to: target.email, subject: 'VantixGym: you now have console access', text: `Hi ${target.name},\n\n${me.name} gave your account the role "${role}" in the VantixGym console. Sign in at ${ORIGIN}/#/admin and confirm with your password or passkey.\n\nIf you did not expect this, reply to this email.` }); } catch { /* best effort */ } }
      json(res, 200, { ok: true, member: safeUser(target) });
    },

    /* ----- audit + logs ----- */
    'GET /api/admin/audit': async (req, res) => {
      if (!guard(req, res, 'audit.read')) return;
      const p = q(req);
      json(res, 200, { entries: readAudit({ limit: Math.min(1000, +p.get('limit') || 200), q: p.get('q') || '', action: p.get('action') || '', actor: p.get('actor') || '', target: p.get('target') || '', since: p.get('since') || '' }) });
    },
    'GET /api/admin/audit/verify': async (req, res) => { if (!guard(req, res, 'audit.read')) return; json(res, 200, verifyAudit()); },
    'GET /api/admin/audit/export': async (req, res) => {
      const me = guard(req, res, 'audit.read'); if (!me) return;
      audit(req, me, 'audit.export', null);
      let text = ''; try { text = fs.readFileSync(auditFile, 'utf8'); } catch { /* empty */ }
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'content-disposition': 'attachment; filename="vantixgym-audit.ndjson"' });
      res.end(text);
    },
    'GET /api/admin/logs': async (req, res) => {
      if (!guard(req, res, 'logs.read')) return;
      const p = q(req); const status = p.get('status') || ''; const text = (p.get('q') || '').toLowerCase(); const limit = Math.min(1000, +p.get('limit') || 300);
      const out = [];
      for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) {
        const r = ring[i];
        if (status === '5xx' && r.s < 500) continue; if (status === '4xx' && (r.s < 400 || r.s >= 500)) continue; if (status === 'slow' && r.ms < 1000) continue;
        if (text && !(r.p.toLowerCase().includes(text) || String(r.s) === text)) continue;
        out.push(r);
      }
      const last5m = ring.filter(r => Date.now() - r.t < 300_000);
      json(res, 200, { entries: out, summary: { total: ring.length, last5m: last5m.length, err5m: last5m.filter(r => r.s >= 500).length, p95ms: pct(last5m.map(r => r.ms), 95) } });
    },

    /* ----- system ----- */
    'GET /api/admin/system': async (req, res) => {
      if (!guard(req, res, 'system.read')) return;
      let disk = null; try { const s = fs.statfsSync(DATA); disk = { freeGb: Math.round(s.bavail * s.bsize / 1e9 * 10) / 10, totalGb: Math.round(s.blocks * s.bsize / 1e9 * 10) / 10 }; } catch { /* unsupported */ }
      let dbSize = 0; try { dbSize = fs.statSync(path.join(DATA, 'db.json')).size; } catch { /* none */ }
      let backup = null; try { backup = JSON.parse(fs.readFileSync(path.join(DATA, '.last-backup'), 'utf8')); } catch { /* none */ }
      json(res, 200, {
        uptimeSec: Math.round(process.uptime()), node: process.version, memMb: Math.round(process.memoryUsage().rss / 1e6), disk, dbBytes: dbSize, users: db.users.length, backup,
        integrations: ctx.integrations(), flags: db.flags, audit: verifyAudit(), env: { origin: ORIGIN, billing: ctx.BILLING_ENABLED, inviteOnly: ctx.INVITE_ONLY, trialDays: ctx.TRIAL_DAYS }
      });
    },
    // Kill switches + banner. Default (absent) = on; enforcement lives in server.js (3 checks).
    'POST /api/admin/flags': async (req, res) => {
      const me = guard(req, res, 'system.write'); if (!me) return;
      const b = await readBody(req);
      const before = { ...db.flags };
      for (const k of ['signups', 'ai', 'payments']) if (k in b) db.flags[k] = b[k] !== false;
      if ('banner' in b) db.flags.banner = String(b.banner || '').replace(/[ -]/g, ' ').trim().slice(0, 160);
      saveDb();
      audit(req, me, 'system.flags', null, { before, after: { ...db.flags } });
      alertOwners('feature flags changed', `${me.name} changed flags: ${JSON.stringify(db.flags)}`);
      json(res, 200, { ok: true, flags: db.flags });
    }
  };

  return { routes, audit, logRequest, guard, roleOf, can, alertOwners };
}

function pct(arr, p) { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }
