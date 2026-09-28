// Progress photos — client contract. The images themselves never go in the profile state (it's
// one JSON blob synced whole); only metadata does. Storage is a backend concern, and until an
// object store is wired up (docs/PROGRESS_PHOTOS.md) every call here rejects with NOT_CONFIGURED
// so the UI can show a "coming soon" instead of failing oddly.
//
// Metadata row in S.progressPhotos: { id, d: 'YYYY-MM-DD', pose: 'front'|'side'|'back'|'other',
//   w: bodyweight that day or null, note, remoteId, width, height, thumb: tiny base64 (≤ 4 KB) }
import { api, fileToResizedBase64 } from './api.js'

export const POSES = ['front', 'side', 'back', 'other']
export const POSE_LABEL = { front: 'Front', side: 'Side', back: 'Back', other: 'Other' }

export class NotConfigured extends Error { constructor() { super('progress photos need a backend with object storage'); this.code = 'NOT_CONFIGURED' } }

// Tiny inline thumbnail so the timeline renders offline and before the full image loads.
export async function makeThumb(file) {
  const { base64 } = await fileToResizedBase64(file, 96, 0.6)
  return base64
}

// 1) ask the server for a signed upload URL, 2) PUT the resized image there, 3) return the
// remote id to store in metadata. The server never proxies the bytes.
export async function uploadPhoto(file) {
  const { base64, mediaType } = await fileToResizedBase64(file, 1600, 0.85)
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  let grant
  try { grant = await api('/api/progress-photos/upload-url', { method: 'POST', body: JSON.stringify({ mediaType, size: bytes.length }) }) }
  catch (e) { if (e.status === 501) throw new NotConfigured(); throw e }
  const put = await fetch(grant.url, { method: 'PUT', headers: { 'content-type': mediaType }, body: bytes })
  if (!put.ok) throw new Error('upload failed (' + put.status + ')')
  return { remoteId: grant.id, width: grant.width || null, height: grant.height || null }
}

export async function photoUrl(remoteId) {
  try { return (await api('/api/progress-photos?id=' + encodeURIComponent(remoteId))).url }
  catch (e) { if (e.status === 501) throw new NotConfigured(); throw e }
}

export async function deletePhoto(remoteId) {
  try { await api('/api/progress-photos?id=' + encodeURIComponent(remoteId), { method: 'DELETE' }) }
  catch (e) { if (e.status === 501) throw new NotConfigured(); throw e }
}

export const isConfigured = async () => { try { await api('/api/progress-photos?id=probe'); return true } catch (e) { return e.status !== 501 } }
