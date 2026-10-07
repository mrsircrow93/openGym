// A photo or a few seconds of video attached to an exercise the person created, so they
// remember how it goes. Private to the account: the GET needs the session, so the browser
// cannot point an <img>/<video> straight at the API — we fetch once and hand out an object URL.
import { api } from './api.js'
import { API_BASE, getToken } from './mobile.js'
import { readUpload } from './upload.js'
import { t } from './i18n.js'

export const CLIP_MAX_SECONDS = 8
export const CLIP_MAX_BYTES = 6 * 1024 * 1024
export const MEDIA_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.mp4,.mov,image/*,video/mp4,video/quicktime'
const VIDEO_RE = /^video\/(mp4|quicktime)$/i
const isVideoFile = f => VIDEO_RE.test(f.type || '') || /\.(mp4|mov)$/i.test(f.name || '')

const toBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onerror = () => reject(new Error('read failed'))
  r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)) }
  r.readAsDataURL(file)
})

// Reads the clip's duration in the browser before uploading, so a 30-second video is refused
// here with a clear message instead of travelling 6 MB to be rejected by the server.
const durationOf = file => new Promise(resolve => {
  const url = URL.createObjectURL(file)
  const v = document.createElement('video')
  v.preload = 'metadata'
  v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(v.duration) ? v.duration : null) }
  v.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
  v.src = url
})

export async function uploadExerciseMedia(file) {
  if (!file) throw new Error('no file')
  const video = isVideoFile(file)
  let payload
  if (video) {
    if (file.size > CLIP_MAX_BYTES) throw new Error(t('That clip is heavier than 6 MB — record a shorter one.'))
    const secs = await durationOf(file)
    if (secs !== null && secs > CLIP_MAX_SECONDS + 0.5) throw new Error(t('Keep the clip under {0} seconds — it is only a reference.', CLIP_MAX_SECONDS))
    payload = { video: await toBase64(file) }
  } else {
    const up = await readUpload(file, { maxDim: 1200 })
    if (up.kind !== 'image') throw new Error(t('Send a photo or a short clip.'))
    payload = { image: up.base64 }
  }
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), 90_000)
  try {
    const r = await api('/api/exercise-media', { method: 'POST', body: JSON.stringify(payload), signal: ctl.signal })
    return { id: r.id, kind: r.kind }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(t('The upload took too long — check your connection and try again.'))
    throw e
  } finally { clearTimeout(tm) }
}

// The last letter of the id says what it is, the same way the server decides what to serve.
export const mediaKind = id => (/[mq]$/.test(String(id || '')) ? 'video' : 'image')

const urls = new Map()
export async function mediaUrl(id) {
  if (!id) return null
  if (urls.has(id)) return urls.get(id)
  const p = (async () => {
    const headers = {}
    const tok = getToken()
    if (tok) headers.Authorization = 'Bearer ' + tok
    const r = await fetch(API_BASE + '/api/exercise-media?id=' + encodeURIComponent(id), { headers })
    if (!r.ok) throw new Error('media ' + r.status)
    return URL.createObjectURL(await r.blob())
  })()
  urls.set(id, p)
  p.catch(() => urls.delete(id))
  return p
}

export async function deleteExerciseMedia(id) {
  if (!id) return
  try { await api('/api/exercise-media?id=' + encodeURIComponent(id), { method: 'DELETE' }) } catch { /* already gone */ }
  urls.delete(id)
}
