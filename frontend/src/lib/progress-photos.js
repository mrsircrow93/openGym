// Progress photos: a check-in is a front / side / back set taken the same day, ideally once a
// month. The images live on the server (api: /api/progress-photos, private per account); the
// profile state keeps only metadata, so sync stays small:
//   S.checkins: [{ id, d: 'YYYY-MM-DD', t, w: bodyweight or null, photos: { front, side, back }: ids,
//                  review: { headline, summary, observations, tips, comparable, mood, at } | null }]
import { api } from './api.js'
import { API_BASE, getToken } from './mobile.js'
import { readUpload } from './upload.js'
import { uid } from './format.js'
import { t } from './i18n.js'

export const POSES = ['front', 'side', 'back']
export const POSE_LABEL = { front: 'Front view', side: 'Side view', back: 'Back view' }
export const CHECKIN_EVERY_DAYS = 28

// Resize on the device (1200 px long edge is plenty for a comparison and ~150 KB), then post.
export async function uploadPhoto(file) {
  const up = await readUpload(file, { maxDim: 1200 })
  if (up.kind !== 'image') throw new Error('photo required')
  const ctl = new AbortController()
  const tm = setTimeout(() => ctl.abort(), 60_000)
  try {
    const r = await api('/api/progress-photos', { method: 'POST', body: JSON.stringify({ image: up.base64 }), signal: ctl.signal })
    return r.id
  } catch (e) { if (e.name === 'AbortError') throw new Error(t('The upload took too long — check your connection and try again.')); throw e }
  finally { clearTimeout(tm) }
}

// Object URLs for the session: the GET needs the auth header, so an <img src> can't hit the
// API directly. Cached per id — a check-in screen asks for the same six photos repeatedly.
const urls = new Map()
export async function photoUrl(id) {
  if (!id) return null
  if (urls.has(id)) return urls.get(id)
  const p = (async () => {
    const headers = {}
    const tok = getToken()
    if (tok) headers.Authorization = 'Bearer ' + tok
    const r = await fetch(API_BASE + '/api/progress-photos?id=' + encodeURIComponent(id), { headers })
    if (!r.ok) throw new Error('photo ' + r.status)
    return URL.createObjectURL(await r.blob())
  })()
  urls.set(id, p)
  p.catch(() => urls.delete(id))
  return p
}

export async function deletePhoto(id) {
  if (!id) return
  try { await api('/api/progress-photos?id=' + encodeURIComponent(id), { method: 'DELETE' }) } catch { /* already gone */ }
  urls.delete(id)
}

export const checkinsOf = S => [...(S.checkins || [])].sort((a, b) => (a.d < b.d ? -1 : 1))
export const lastCheckin = S => { const c = checkinsOf(S); return c[c.length - 1] || null }
// The check-in to compare against: the latest one before `c`.
export const previousCheckin = (S, c) => { const all = checkinsOf(S).filter(x => x.id !== c.id && x.d <= c.d); return all[all.length - 1] || null }
export const daysSince = iso => iso ? Math.floor((Date.now() - new Date(iso + 'T12:00:00').getTime()) / 86400000) : null
// Time for the monthly photos? True with no check-in at all, or when the last one is 4+ weeks old.
export const checkinDue = S => { const l = lastCheckin(S); return !l || daysSince(l.d) >= CHECKIN_EVERY_DAYS }

export const newCheckin = (d, w, photos) => ({ id: uid(), d, t: Date.now(), w: w || null, photos, review: null })

// Facts the review prompt gets alongside the photos — all derived here so the server trusts
// nothing it can't bound.
export function reviewFacts(S, c) {
  const prev = previousCheckin(S, c)
  const between = prev ? S.workouts.filter(w => w.d > prev.d && w.d <= c.d).length : S.workouts.filter(w => w.d <= c.d).length
  return {
    current: c.photos, previous: prev ? prev.photos : null,
    weightNow: c.w, weightBefore: prev ? prev.w : null, unit: S.unit || 'kg',
    daysBetween: prev ? Math.max(0, daysSince(prev.d) - daysSince(c.d)) : 0, workoutsBetween: between,
    goal: (S.trainer && S.trainer.answers && S.trainer.answers.goal) || '', sex: S.body === 'female' ? 'female' : 'male',
    checkinNumber: checkinsOf(S).findIndex(x => x.id === c.id) + 1, lang: S.lang || 'en'
  }
}
