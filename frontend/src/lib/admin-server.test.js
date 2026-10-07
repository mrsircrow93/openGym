// Boots the real API and exercises the operations console: roles, step-up, permission table,
// audit chain, kill switches, team roles. Stripe-backed routes answer 501/"not configured".
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../api/server.js')
const PORT = 4100 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}`
const UA = 'vitest/1.0'
let proc, dir
const T = {}   // tokens by name
const call = (p, { as, body, headers = {} } = {}) => fetch(BASE + p, { method: body !== undefined ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'user-agent': UA, ...(as ? { authorization: 'Bearer ' + T[as] } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined })
const j = async r => ({ ...(await r.json().catch(() => ({}))), http: r.status })

async function boot(env = {}) {
  proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, BILLING_ENABLED: '1', TRIAL_DAYS: '7', LOG_JSON: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => { proc.stdout.on('data', d => { if (String(d).includes('gym-api on')) resolve() }); proc.stderr.on('data', d => process.stderr.write(d)); proc.on('exit', c => reject(new Error('server exited ' + c))); setTimeout(() => reject(new Error('server did not start')), 8000) })
}
const stop = () => new Promise(r => { if (!proc) return r(); proc.once('exit', r); proc.kill() })

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-'))
  await boot()
  for (const [name, email] of [['owner', 'owner@example.com'], ['sup', 'support@example.com'], ['bob', 'bob@example.com']]) {
    const r = await j(await call('/api/auth/register', { body: { email, name, password: 'correct horse battery ' + name, client: 'mobile' } }))
    T[name] = r.token; T[name + 'Id'] = r.user.id
  }
  // promote the first account to owner the legacy way (ADMIN_UIDS) and mark emails verified
  await stop()
  const dbf = path.join(dir, 'db.json'); const db = JSON.parse(fs.readFileSync(dbf, 'utf8'))
  for (const u of db.users) u.emailVerified = true
  fs.writeFileSync(dbf, JSON.stringify(db))
  await boot({ ADMIN_UIDS: T.ownerId })
}, 30000)
afterAll(async () => { await stop(); try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

describe('admin console', () => {
  it('legacy admin became owner; non-staff get 403; staff get 428 before step-up', async () => {
    const me = await j(await call('/api/me', { as: 'owner' }))
    expect(me.user.role).toBe('owner'); expect(me.user.admin).toBe(true)
    expect((await call('/api/admin/overview', { as: 'bob' })).status).toBe(403)
    const r = await j(await call('/api/admin/overview', { as: 'owner' }))
    expect(r.http).toBe(428); expect(r.code).toBe('stepup_required')
  })
  it('step-up with the wrong password is refused and audited; with the right one it opens the console', async () => {
    expect((await call('/api/admin/stepup', { as: 'owner', body: { password: 'nope' } })).status).toBe(401)
    const ok = await j(await call('/api/admin/stepup', { as: 'owner', body: { password: 'correct horse battery owner' } }))
    expect(ok.ok).toBe(true)
    const ov = await j(await call('/api/admin/overview', { as: 'owner' }))
    expect(ov.http).toBe(200); expect(ov.users).toBe(3); expect(ov.staff).toBe(1); expect(ov.status.trial).toBe(3)   // staff in trial now report their real status
    const me = await j(await call('/api/admin/me', { as: 'owner' })); expect(me.stepUp).toBe(true); expect(me.perms['team.write']).toBe(true)
  })
  it('step-up is bound to the device: another user agent must re-verify', async () => {
    expect((await call('/api/admin/overview', { as: 'owner', headers: { 'user-agent': 'other/2.0' } })).status).toBe(428)
  })
  it('owner grants support role; support sees users but cannot read billing or change roles', async () => {
    const g = await j(await call('/api/admin/team/role', { as: 'owner', body: { email: 'support@example.com', role: 'support' } }))
    expect(g.ok).toBe(true); expect(g.member.role).toBe('support')
    await call('/api/admin/stepup', { as: 'sup', body: { password: 'correct horse battery sup' } })
    const users = await j(await call('/api/admin/users?q=bob', { as: 'sup' }))
    expect(users.http).toBe(200); expect(users.users.map(u => u.name)).toEqual(['bob'])
    expect((await call('/api/admin/billing', { as: 'sup' })).status).toBe(403)
    expect((await call('/api/admin/team/role', { as: 'sup', body: { email: 'bob@example.com', role: 'owner' } })).status).toBe(403)
    expect((await call('/api/admin/audit', { as: 'sup' })).status).toBe(403)
  })
  it('support can extend a trial within the cap, and the action is audited with before/after', async () => {
    const bad = await j(await call('/api/admin/user/action', { as: 'sup', body: { id: T.bobId, action: 'extend_trial', days: 90 } }))
    expect(bad.http).toBe(400)
    const ok = await j(await call('/api/admin/user/action', { as: 'sup', body: { id: T.bobId, action: 'extend_trial', days: 10 } }))
    expect(ok.ok).toBe(true)
    const detail = await j(await call('/api/admin/user?id=' + T.bobId, { as: 'owner' }))
    expect(Date.parse(detail.user.trialEnds)).toBeGreaterThan(Date.now() + 16 * 86400_000)
    const a = detail.audit.find(e => e.action === 'user.extend_trial')
    expect(a).toBeTruthy(); expect(a.actorRole).toBe('support'); expect(a.before.trialEnds).not.toBe(a.after.trialEnds)
    expect((await j(await call('/api/admin/user/action', { as: 'sup', body: { id: T.bobId, action: 'delete' } }))).http).toBe(403)
  })
  it('the audit chain verifies, and a tampered line is detected', async () => {
    const v = await j(await call('/api/admin/audit/verify', { as: 'owner' }))
    expect(v.ok).toBe(true); expect(v.entries).toBeGreaterThan(4)
    const f = path.join(dir, 'audit.log'); const lines = fs.readFileSync(f, 'utf8').trim().split('\n')
    const e = JSON.parse(lines[1]); e.actorName = 'mallory'; lines[1] = JSON.stringify(e); fs.writeFileSync(f, lines.join('\n') + '\n')
    const v2 = await j(await call('/api/admin/audit/verify', { as: 'owner' }))
    expect(v2.ok).toBe(false); expect(v2.error).toMatch(/chain broken at entry 2/)
  })
  it('there must always be one owner, and you cannot demote yourself', async () => {
    expect((await j(await call('/api/admin/team/role', { as: 'owner', body: { id: T.ownerId, role: 'viewer' } }))).http).toBe(400)
  })
  it('kill switches: sign-ups paused returns 503 and is reversible; banner shows in /api/config', async () => {
    expect((await j(await call('/api/admin/flags', { as: 'sup', body: { signups: false } }))).http).toBe(403)
    await call('/api/admin/flags', { as: 'owner', body: { signups: false, banner: 'Mantenimiento 22:00' } })
    const reg = await j(await call('/api/auth/register', { body: { email: 'x@example.com', name: 'X', password: 'correct horse battery x' } }))
    expect(reg.http).toBe(503); expect(reg.code).toBe('paused')
    expect((await j(await call('/api/config'))).banner).toBe('Mantenimiento 22:00')
    await call('/api/admin/flags', { as: 'owner', body: { signups: true, banner: '' } })
    expect((await call('/api/auth/register', { body: { email: 'y@example.com', name: 'Y', password: 'correct horse battery y' } })).status).toBe(200)
  })
  it('Stripe-backed routes degrade cleanly without a key; logs and system answer', async () => {
    expect((await j(await call('/api/admin/coupons', { as: 'owner' }))).configured).toBe(false)
    expect((await call('/api/admin/coupons', { as: 'owner', body: { name: 'X', percent: 10 } })).status).toBe(501)
    const logs = await j(await call('/api/admin/logs?status=4xx', { as: 'owner' }))
    expect(logs.entries.length).toBeGreaterThan(0); expect(logs.entries.every(e => e.s >= 400 && e.s < 500)).toBe(true); expect(logs.entries[0]).not.toHaveProperty('body')
    const sys = await j(await call('/api/admin/system', { as: 'owner' }))
    expect(sys.integrations.stripe.on).toBe(false); expect(sys.audit.entries).toBeGreaterThan(0)
  })
  it('AI section: our meter answers, Anthropic cost is off without an admin key, caps are owner-editable and reversible', async () => {
    await call('/api/admin/stepup', { as: 'owner', body: { password: 'correct horse battery owner' } })
    const ai = await j(await call('/api/admin/ai', { as: 'owner' }))
    expect(ai.http).toBe(200); expect(ai.months).toHaveLength(3); expect(ai.anthropic.available).toBe(false); expect(ai.caps.overrides.global).toBe(null)
    expect((await call('/api/admin/ai/caps', { as: 'sup', body: { global: 5 } })).status).toBe(403)
    const set = await j(await call('/api/admin/ai/caps', { as: 'owner', body: { global: 5, trial: 0.5 } }))
    expect(set.caps.global).toBe(5); expect(set.caps.trial).toBe(0.5)
    expect((await j(await call('/api/billing/status', { as: 'bob' }))).aiCapUsd).toBe(0.5)
    const reset = await j(await call('/api/admin/ai/caps', { as: 'owner', body: { global: null, trial: null } }))
    expect(reset.caps.global).toBe(null)
  })
  it('a paying Stripe subscriber cannot open a second checkout', async () => {
    await call('/api/admin/stepup', { as: 'owner', body: { password: 'correct horse battery owner' } })
    await call('/api/admin/user/action', { as: 'owner', body: { id: T.bobId, action: 'comp_days', days: 30 } })
    const dbf = path.join(dir, 'db.json'); const db = JSON.parse(fs.readFileSync(dbf, 'utf8'))
    const bob = db.users.find(u => u.id === T.bobId); bob.provider = 'stripe'; bob.stripeSubscriptionId = 'sub_x'; bob.plan = 'monthly'
    fs.writeFileSync(dbf, JSON.stringify(db))
    await stop(); await boot({ ADMIN_UIDS: T.ownerId, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_MONTHLY: 'price_m' })
    const r = await j(await call('/api/billing/checkout', { as: 'bob', body: { plan: 'monthly' } }))
    expect(r.http).toBe(409); expect(r.code).toBe('already_subscribed')
  })
  it('step-down closes the console again', async () => {
    await call('/api/admin/stepdown', { as: 'owner', body: {} })
    expect((await call('/api/admin/overview', { as: 'owner' })).status).toBe(428)
  })
})
