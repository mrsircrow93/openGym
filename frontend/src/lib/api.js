// Backend + WebAuthn helpers (ported from the vanilla app).
import { t } from './i18n.js'
import { MOBILE, API_BASE, getToken, setToken } from './mobile.js'
import { hasUserKey, directParseSet, directCoach, directIdentify, directAlternatives, directAnalyzeMeal, directTrainerPlan, directImportPlan, directImportRoutine, directRecipes } from './ai.js'
import { sniff, fileToJpeg } from './upload.js'
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
export const webauthnOK = () => !!(window.PublicKeyCredential && navigator.credentials)

export async function api(path, opts) {
  const headers = { 'Content-Type': 'application/json' }
  const tok = getToken()
  if (tok) headers.Authorization = 'Bearer ' + tok
  const r = await fetch(API_BASE + path, Object.assign({ headers }, opts))
  if (r.status === 401 && tok && path === '/api/me') setToken(null)   // token revoked or expired: forget it
  // parsed with a reviver that drops __proto__/constructor keys: replies are merged into state
  // with Object.assign, which would otherwise honour them
  const data = await r.text().then(s => (s ? JSON.parse(s, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype') ? undefined : v) : {})).catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}
export async function passkeyRegister(name, code) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '' }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
// Natural-language set logging: "did 3x10 at 60kg" -> { sets, reps, weight, confident }.
// Any of sets/reps/weight can come back null if the text didn't mention it.
export async function aiParseSet(text, exercise, unit) {
  if (hasUserKey()) return directParseSet(text, exercise, unit)
  return api('/api/ai/parse-set', { method: 'POST', body: JSON.stringify({ text, exercise, unit }) })
}
// The coach: ask a question about training, food, steps or weight and get an answer grounded in
// the signed-in user's own data — or, with no question, the classic training read-out.
// `history` is the earlier turns of the same chat so follow-ups make sense. Rate-limited
// server-side, so failures here are expected once in a while — the caller shows the error.
export async function aiCoach(question = '', history = [], coach = null) {
  if (hasUserKey()) return directCoach(question, history, coach)
  return api('/api/ai/coach', { method: 'POST', body: JSON.stringify({ question: question || '', history, coach: coach ? { name: coach.name, gender: coach.gender } : null }) })
}
// Mid-workout swap: given the exercise you're on + a shortlist of real catalog candidates
// (id, name, equipment, target), returns { alternatives: [{ id, why }] } — ids are always
// from the candidates sent, so the caller can swap straight to a known exercise.
export async function aiAlternatives(exercise, candidates, reason) {
  if (hasUserKey()) return directAlternatives(exercise, candidates, reason)
  return api('/api/ai/alternatives', { method: 'POST', body: JSON.stringify({ exercise, candidates, reason: reason || '' }) })
}
// Photo of a machine/exercise -> { name, bodyPart, equipment, confidence, note }.
// image is a base64 string with no "data:...," prefix (see fileToResizedBase64 below).
export async function aiIdentifyExercise(image, mediaType) {
  if (hasUserKey()) return directIdentify(image, mediaType)
  return api('/api/ai/identify-exercise', { method: 'POST', body: JSON.stringify({ image, mediaType }) })
}
// What to show when an AI call fails. A bare "HTTP 502" means the app has no backend to
// proxy through (static deploy) and no key of its own — say that, and where to fix it.
export function aiErrorMessage(e) {
  const admin = (() => { try { return !!(JSON.parse(localStorage.getItem('gym_user')) || {}).admin } catch { return false } })()
  if (!hasUserKey() && e && (e.status === 501 || e.status === 502 || e.status === 404)) return t('This isn’t available right now — try again in a bit.') + (admin ? ' (admin: ' + (e.status === 501 ? 'ANTHROPIC_API_KEY not set on the server' : 'AI route failed, status ' + e.status) + ')' : '')
  if (!hasUserKey() && e && e.status === 401) return t('Sign in to use the coach and the photo features.')
  // A paid feature without an active plan: take them straight to the plans, with a plain line.
  if (!hasUserKey() && e && e.status === 402) { setTimeout(() => { try { window.location.hash = '#/plans' } catch {} }, 600); return t('This is part of the plan — pick one to keep going.') }
  if (!hasUserKey() && e && e.status === 403) return t('Confirm your email first (check your inbox and spam) — then the coach and photo features unlock.')
  return (e && e.message) || t('Something went wrong — try again')
}
// Meal photo and/or typed description -> { name, items: [{ name, portion, grams, kcal, protein,
// carbs, fat }], confidence, note }. Either input alone is enough; both together is best (the
// caption fixes quantities the photo can't show). The photo is analysed, never stored.
// Pass `previous` (the items shown) + `correction` ("it's unsweetened Greek yoghurt") to get a
// revised list instead of a fresh guess — untouched items come back unchanged.
export async function aiAnalyzeMeal({ image, mediaType, text, lang, previous, correction }) {
  if (hasUserKey()) return directAnalyzeMeal({ image, mediaType, text, lang, previous, correction })
  return api('/api/ai/analyze-meal', { method: 'POST', body: JSON.stringify({ image: image || '', mediaType, text: text || '', lang, previous: previous || null, correction: correction || '' }) })
}
// Meal-plan photo or PDF -> { found, kcal, protein, carbs, fat, sugar?, fiber?, sodium?, summary,
// note, confidence }. Reviewed in the goal sheet before it touches S.macroGoal; the file is never stored.
export async function aiImportPlan({ image, mediaType, pdf, lang }) {
  if (hasUserKey()) return directImportPlan({ image, mediaType, pdf, lang })
  return api('/api/ai/import-plan', { method: 'POST', body: JSON.stringify({ image: image || '', mediaType, pdf: pdf || '', lang }) })
}
// Routine photo or PDF -> { found, title, summary, routines: [{ name, glyph, days, exercises }], notes }.
// Matched against the library in lib/import-routine.js before anything is saved; the file is never stored.
export async function aiImportRoutine({ image, mediaType, pdf, lang }) {
  if (hasUserKey()) return directImportRoutine({ image, mediaType, pdf, lang })
  return api('/api/ai/import-routine', { method: 'POST', body: JSON.stringify({ image: image || '', mediaType, pdf: pdf || '', lang }) })
}
// Monthly check-in review: photo ids (this and the previous check-in) + facts -> { headline,
// summary, observations, tips, comparable, mood }. Server-only: the photos are read from the
// account's own storage, so there is no bring-your-own-key path for this one.
export const aiProgressReview = body => api('/api/ai/progress-review', { method: 'POST', body: JSON.stringify(body) })
// PDF as base64, no resizing possible — capped so the body stays under nginx's 6 MB.
export function fileToBase64(file, maxBytes = 3_300_000) {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) return reject(new Error('PDF too large — keep it under 3 MB'))
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(new Error('could not read file'))
    reader.readAsDataURL(file)
  })
}
// Questionnaire + exercise shortlist -> { summary, split, progression, routines, cardio, nutrition }.
// Every exercise id must come from the candidates sent; lib/trainer.js re-checks before saving.
export async function aiTrainerPlan(body) {
  if (hasUserKey()) return directTrainerPlan(body)
  return api('/api/ai/trainer-plan', { method: 'POST', body: JSON.stringify(body) })
}
// Downscales client-side before it ever leaves the device — a full-res phone photo is
// 3-8 MB and costs real API tokens for no accuracy gain past ~1024px on the long edge.
const readHead = file => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.onerror = () => reject(new Error('could not read file')); r.readAsArrayBuffer(file.slice(0, 16)) })
export async function fileToResizedBase64(file, maxDim = 1024, quality = 0.82) {
  // HEIC (the iPhone default) only decodes natively in WebKit — route it through the shared
  // reader, which falls back to the on-demand WebAssembly decoder on Chrome and Android.
  const kind = sniff(await readHead(file))
  if (kind === 'heic') { const r = await fileToJpeg(file, kind, maxDim, quality); return { base64: r.base64, mediaType: r.mediaType } }
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('image encoding failed'))
        const reader = new FileReader()
        reader.onload = () => resolve({ base64: reader.result.split(',')[1], mediaType: 'image/jpeg' })
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not read image')) }
    img.src = url
  })
}

export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
// Admin console step-up with a passkey: the same WebAuthn ceremony as sign-in, verified by the
// console route so the assertion must belong to the staff member who is already signed in.
export async function passkeyStepUp() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  return api('/api/admin/stepup', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
}
// One meal of the saved diet plan -> 3 alternative recipes that keep its macros and rules.
// body: { meal, targets, rules, lang, wish, avoid, mealsPerDay }
export async function aiRecipes(body) {
  if (hasUserKey()) return directRecipes(body)
  return api('/api/ai/recipes', { method: 'POST', body: JSON.stringify(body) })
}

/* ---------- email + password accounts, subscription (docs/ACCOUNTS.md, BILLING.md) ---------- */
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })
// The store app asks for a bearer token with every sign-in shaped call and keeps it.
const authPost = (path, body) => post(path, MOBILE ? { ...body, client: 'mobile' } : body).then(async r => { if (r.token) await setToken(r.token); return r })
export const authRegister = (email, password, name, code, lang, ref) => authPost('/api/auth/register', { email, password, name, code: code || '', lang, ref: ref || '' }).then(r => r.user)
export const fetchReferral = () => api('/api/referral')
export const authLogin = (email, password) => authPost('/api/auth/login', { email, password }).then(r => r.user)
// Google ID token (from the web button or the native picker) -> our session. New accounts get the
// same trial / referral / invite treatment as a password sign-up.
export const authApple = (identityToken, name, lang, ref, code) => authPost('/api/auth/apple', { identityToken, name: name || '', lang, ref: ref || '', code: code || '' }).then(r => r.user)
export const authGoogle = (credential, lang, ref, code) => authPost('/api/auth/google', { credential, lang, ref: ref || '', code: code || '' }).then(r => r.user)
export const authVerify = token => post('/api/auth/verify', { token })
export const authResendVerify = () => post('/api/auth/resend-verify')
export const authForgot = email => post('/api/auth/forgot', { email })
export const authReset = (token, password) => authPost('/api/auth/reset', { token, password })
export const authChangePassword = (current, next) => authPost('/api/auth/password', { current, next })
export const authChangeEmail = (email, password) => post('/api/auth/email', { email, password })
export const deleteAccount = password => api('/api/account', { method: 'DELETE', body: JSON.stringify({ password: password || '' }) })
export const fetchMe = () => api('/api/me').then(r => r.user)
// Add a passkey to the signed-in account (so an email account gets Face ID next time).
export async function passkeyAdd() {
  const { cid, options } = await post('/api/passkey/options')
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  return post('/api/passkey/verify', { cid, credential: credToJSON(cred) })
}
export const billingPlans = () => api('/api/billing/plans')
export const billingCheckout = plan => post('/api/billing/checkout', { plan })
export const billingPortal = () => post('/api/billing/portal')
