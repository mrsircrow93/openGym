// Boots the real API in a temp data dir and drives POST /api/billing/revenuecat the way
// RevenueCat does: shared-secret Authorization header, one event per call, idempotent on id.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../api/server.js')
const PORT = 3900 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}`
const AUTH = 'Bearer test-webhook-secret'
let proc, dir, token, uid

const call = (p, body, headers = {}) => fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
const hook = (event, auth = AUTH) => fetch(BASE + '/api/billing/revenuecat', { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth }, body: JSON.stringify({ api_version: '1.0', event }) })
const me = async () => (await (await call('/api/me')).json()).user

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'))
  proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, BILLING_ENABLED: '1', TRIAL_DAYS: '0', REVENUECAT_WEBHOOK_AUTH: AUTH, STRIPE_PRICE_MONTHLY: '', EMAIL_FROM: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => { proc.stdout.on('data', d => { if (String(d).includes('gym-api on')) resolve() }); proc.on('exit', c => reject(new Error('server exited ' + c))); setTimeout(() => reject(new Error('server did not start')), 8000) })
  const r = await (await call('/api/auth/register', { email: 'buyer@example.com', name: 'Buyer', password: 'correct horse battery', client: 'mobile' })).json()
  token = r.token; uid = r.user.id
  expect(r.user.billing.active).toBe(false)   // no trial, no plan: locked
}, 15000)
afterAll(() => { proc?.kill(); try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

const day = 86400_000
describe('RevenueCat webhook', () => {
  it('refuses a bad or missing secret', async () => {
    expect((await hook({ id: 'e0', type: 'TEST', app_user_id: uid }, 'Bearer nope')).status).toBe(401)
    expect((await hook({ id: 'e0', type: 'TEST', app_user_id: uid }, '')).status).toBe(401)
  })
  it('acknowledges TEST and unknown users without changing anything', async () => {
    expect((await hook({ id: 'e1', type: 'TEST', app_user_id: uid })).status).toBe(200)
    expect((await hook({ id: 'e2', type: 'INITIAL_PURCHASE', app_user_id: 'nobody', product_id: 'app.vantixgym.mobile.yearly', expiration_at_ms: Date.now() + 365 * day, store: 'APP_STORE' })).status).toBe(200)
    expect((await me()).billing.active).toBe(false)
  })
  it('INITIAL_PURCHASE unlocks the account with the right plan and provider', async () => {
    const exp = Date.now() + 30 * day
    expect((await hook({ id: 'e3', type: 'INITIAL_PURCHASE', app_user_id: uid, product_id: 'app.vantixgym.mobile.monthly', expiration_at_ms: exp, store: 'APP_STORE', environment: 'PRODUCTION', period_type: 'NORMAL' })).status).toBe(200)
    const b = (await me()).billing
    expect(b).toMatchObject({ active: true, status: 'pro', plan: 'monthly', provider: 'apple', cancelAtPeriodEnd: false })
    expect(Date.parse(b.tierUntil)).toBeGreaterThan(exp)   // +1 day grace
  })
  it('is idempotent on the event id', async () => {
    const r = await hook({ id: 'e3', type: 'EXPIRATION', app_user_id: uid, product_id: 'app.vantixgym.mobile.monthly', expiration_at_ms: Date.now() - day, store: 'APP_STORE' })
    expect(await r.json()).toMatchObject({ ok: true, duplicate: true })
    expect((await me()).billing.active).toBe(true)
  })
  it('CANCELLATION keeps access to the end of the period; UNCANCELLATION turns renewal back on', async () => {
    await hook({ id: 'e4', type: 'CANCELLATION', app_user_id: uid, product_id: 'app.vantixgym.mobile.monthly', expiration_at_ms: Date.now() + 20 * day, store: 'APP_STORE', cancel_reason: 'UNSUBSCRIBE' })
    expect((await me()).billing).toMatchObject({ active: true, cancelAtPeriodEnd: true })
    await hook({ id: 'e5', type: 'UNCANCELLATION', app_user_id: uid, product_id: 'app.vantixgym.mobile.monthly', expiration_at_ms: Date.now() + 20 * day, store: 'APP_STORE' })
    expect((await me()).billing).toMatchObject({ active: true, cancelAtPeriodEnd: false })
  })
  it('PRODUCT_CHANGE on Play maps the base-plan style product id and provider', async () => {
    await hook({ id: 'e6', type: 'PRODUCT_CHANGE', app_user_id: uid, new_product_id: 'x', product_id: 'app.vantixgym.mobile.yearly:p1y', expiration_at_ms: Date.now() + 365 * day, store: 'PLAY_STORE' })
    expect((await me()).billing).toMatchObject({ active: true, plan: 'yearly', provider: 'google' })
  })
  it('a refund pulls access now; EXPIRATION locks the account', async () => {
    await hook({ id: 'e7', type: 'CANCELLATION', app_user_id: uid, product_id: 'app.vantixgym.mobile.yearly', expiration_at_ms: Date.now() + 300 * day, store: 'APP_STORE', cancel_reason: 'CUSTOMER_SUPPORT' })
    expect((await me()).billing.active).toBe(false)
    await hook({ id: 'e8', type: 'RENEWAL', app_user_id: uid, product_id: 'app.vantixgym.mobile.semester', expiration_at_ms: Date.now() + 180 * day, store: 'APP_STORE' })
    expect((await me()).billing).toMatchObject({ active: true, plan: 'semester' })
    await hook({ id: 'e9', type: 'EXPIRATION', app_user_id: uid, product_id: 'app.vantixgym.mobile.semester', expiration_at_ms: Date.now() - 1000, store: 'APP_STORE' })
    expect((await me()).billing).toMatchObject({ active: false, status: 'expired' })
  })
  it('store subscribers get the store page from /api/billing/portal, and sync is 501 without a key', async () => {
    expect(await (await call('/api/billing/portal', {})).json()).toMatchObject({ store: 'apple', url: expect.stringContaining('apps.apple.com') })
    expect((await call('/api/billing/sync', {})).status).toBe(501)
  })
})
