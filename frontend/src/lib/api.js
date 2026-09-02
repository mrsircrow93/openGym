// Backend + WebAuthn helpers (ported from the vanilla app).
import { hasUserKey, directParseSet, directCoach, directIdentify, directAlternatives } from './ai.js'
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
export const webauthnOK = () => !!(window.PublicKeyCredential && navigator.credentials)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
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
// Plain-language read-out of recent training, generated server-side from the signed-in
// user's own workout history. Rate-limited server-side, so failures here are expected
// once in a while — the caller shows the error rather than retrying silently.
export async function aiCoach() {
  if (hasUserKey()) return directCoach()
  return api('/api/ai/coach', { method: 'POST', body: '{}' })
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
// Downscales client-side before it ever leaves the device — a full-res phone photo is
// 3-8 MB and costs real API tokens for no accuracy gain past ~1024px on the long edge.
export function fileToResizedBase64(file, maxDim = 1024, quality = 0.82) {
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
