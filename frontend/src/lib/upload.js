// Reading a photo or PDF the person picked, before it goes anywhere. The server re-checks the
// bytes (api/upload.js); this side exists so the person gets a plain answer in a second
// instead of a round trip, and so HEIC (what iPhones shoot by default) works everywhere.
//
//   readUpload(file)  -> { kind: 'image', base64, mediaType: 'image/jpeg' }   (resized, re-encoded)
//                     -> { kind: 'pdf', base64 }
//   throws Error(<key for t()>) on anything else
//
// Type is decided from the first bytes, never from the extension or file.type (Android often
// sends "" or application/octet-stream, and renaming a file proves nothing).
import { t } from './i18n.js'

export const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf'
export const PDF_MAX_BYTES = 3_300_000
export const IMAGE_MAX_BYTES = 40_000_000   // a raw HEIC/JPEG from a phone — we resize it anyway

const asciiAt = (b, from, to) => String.fromCharCode(...b.slice(from, to))

// What the first bytes say the file is.
export function sniff(bytes) {
  const b = bytes
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x89 && asciiAt(b, 1, 4) === 'PNG') return 'png'
  if (asciiAt(b, 0, 4) === 'RIFF' && asciiAt(b, 8, 12) === 'WEBP') return 'webp'
  if (asciiAt(b, 0, 5) === '%PDF-') return 'pdf'
  // ISO base media: size(4) 'ftyp' brand(4). HEIC/HEIF brands from iPhones and Androids.
  if (asciiAt(b, 4, 8) === 'ftyp') {
    const brand = asciiAt(b, 8, 12)
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)$/.test(brand)) return 'heic'
  }
  return null
}

const head = file => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(new Uint8Array(r.result))
  r.onerror = () => reject(new Error('could not read file'))
  r.readAsArrayBuffer(file.slice(0, 16))
})

const toDataBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(r.result.split(',')[1])
  r.onerror = () => reject(new Error('could not read file'))
  r.readAsDataURL(blob)
})

// Decode with the browser first (Safari and iOS WebViews read HEIC natively); when that fails,
// pull in the WebAssembly decoder on demand — it is ~2 MB, so only HEIC files pay for it.
async function imageBitmapOf(file, kind) {
  const draw = blob => new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')) }
    img.src = url
  })
  try { return await draw(file) } catch (e) { if (kind !== 'heic') throw e }
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  return draw(Array.isArray(out) ? out[0] : out)
}

export async function fileToJpeg(file, kind, maxDim = 1568, quality = 0.82) {
  const img = await imageBitmapOf(file, kind)
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  canvas.getContext('2d').drawImage(img, 0, 0, w, h)
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('image encoding failed')
  return { kind: 'image', base64: await toDataBase64(blob), mediaType: 'image/jpeg' }
}

export async function readUpload(file, { maxDim = 1568 } = {}) {
  if (!file) throw new Error('No file')
  const kind = sniff(await head(file))
  if (!kind) throw new Error(t('That file type isn’t supported — use a photo (JPG, PNG, HEIC) or a PDF.'))
  if (kind === 'pdf') {
    if (file.size > PDF_MAX_BYTES) throw new Error(t('PDF too large — keep it under 3 MB (or photograph the pages).'))
    return { kind: 'pdf', base64: await toDataBase64(file) }
  }
  if (file.size > IMAGE_MAX_BYTES) throw new Error(t('That photo is too big to read.'))
  try { return await fileToJpeg(file, kind, maxDim) }
  catch { throw new Error(t('Couldn’t read that photo — try another one or a screenshot.')) }
}
