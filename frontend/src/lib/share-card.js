// Strava-style share image for a finished workout: a 1080×1920 story with the numbers over the
// person's own photo, over the brand background, or transparent to drop on top of a video.
// Pure canvas, no dependencies. Returns a PNG Blob.
import { fmtNum, fmtDur } from './format.js'
import { setsDone } from './history.js'
import { t } from './i18n.js'
import { EXIDX } from './exercises.js'

const FONT = "'Plus Jakarta Sans', -apple-system, system-ui, sans-serif"
const W = 1080, H = 1920
const V = [[10, 26], [42, 90], [86, 10]], A = [[58.4, 21.8], [86, 10], [90.8, 39.6]]

function drawMark(ctx, x, y, size, color) {
  const k = size / 100
  ctx.save(); ctx.translate(x, y); ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.miterLimit = 8; ctx.strokeStyle = color
  for (const pts of [V, A]) { ctx.lineWidth = 12.5 * k; ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px * k, py * k) : ctx.moveTo(px * k, py * k))); ctx.stroke() }
  ctx.restore()
}
const loadImage = file => new Promise((res, rej) => { const url = URL.createObjectURL(file); const im = new Image(); im.onload = () => { URL.revokeObjectURL(url); res(im) }; im.onerror = rej; im.src = url })

function topLift(w, unit) {
  let best = null
  for (const e of w.entries || []) for (const s of e.sets || []) if (s.done && !s.warmup && s.w > 0 && (!best || s.w > best.w)) best = { id: e.id, w: s.w, r: s.r }
  if (!best) return null
  const name = (EXIDX[best.id] || {}).n || ''
  return { name, line: `${fmtNum(best.w)} ${unit} × ${best.r || 1}` }
}

export async function renderShareCard({ workout: w, unit, style = 'brand', photo = null, prs = [] }) {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d')
  try { await document.fonts.load(`800 100px ${FONT}`); await document.fonts.load(`600 40px ${FONT}`) } catch { /* system font */ }

  // ---- background
  if (style === 'photo' && photo) {
    const im = await loadImage(photo)
    const s = Math.max(W / im.width, H / im.height)
    ctx.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s)
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,.25)'); g.addColorStop(.45, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,.35)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  } else if (style === 'brand') {
    ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, W, H)
    const g = ctx.createRadialGradient(W / 2, H * .38, 50, W / 2, H * .38, 900); g.addColorStop(0, 'rgba(208,255,82,.22)'); g.addColorStop(1, 'rgba(208,255,82,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
    ctx.save(); ctx.globalAlpha = .07; drawMark(ctx, W / 2 - 520, H / 2 - 520, 1040, '#d0ff52'); ctx.restore()
  }
  // transparent: nothing

  const shadow = on => { ctx.shadowColor = on ? 'rgba(0,0,0,.55)' : 'transparent'; ctx.shadowBlur = on ? 18 : 0; ctx.shadowOffsetY = on ? 2 : 0 }
  const label = (txt, y) => { ctx.font = `600 34px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.72)'; ctx.textAlign = 'center'; ctx.fillText(txt.toUpperCase(), W / 2, y) }
  const big = (txt, y, size = 112, color = '#fff') => { ctx.font = `800 ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(txt, W / 2, y) }

  shadow(style !== 'brand')
  // ---- title
  const name = (w.name || t('Workout')).replace(/^\w/, ch => ch.toUpperCase())
  ctx.font = `700 46px ${FONT}`; ctx.fillStyle = '#d0ff52'; ctx.textAlign = 'center'
  ctx.fillText(name.length > 26 ? name.slice(0, 25) + '…' : name, W / 2, 520)

  // ---- stats stack
  const rows = [
    [t('Duration'), fmtDur(Math.max(0, (w.end || Date.now()) - w.start))],
    [t('Volume'), `${fmtNum(w.vol || 0)} ${unit}`],
    [t('Sets'), String(setsDone(w))]
  ]
  const top = topLift(w, unit)
  if (top) rows.push([top.name.length > 22 ? top.name.slice(0, 21) + '…' : top.name, top.line])
  let y = 640
  for (const [l, v] of rows) { label(l, y); big(v, y + 118, l === rows[3]?.[0] ? 92 : 112); y += 240 }
  if (prs.length) { ctx.font = `700 40px ${FONT}`; ctx.fillStyle = '#d0ff52'; ctx.fillText(`🏆 ${prs.length === 1 ? t('New personal record') : t('{0} personal records', prs.length)}`, W / 2, y + 20) }

  // ---- brand
  shadow(false)
  drawMark(ctx, W / 2 - 150, H - 240, 90, '#d0ff52')
  ctx.textAlign = 'left'; ctx.font = `800 64px ${FONT}`
  ctx.fillStyle = '#d0ff52'; ctx.fillText('Vantix', W / 2 - 40, H - 170)
  const vw = ctx.measureText('Vantix').width
  ctx.fillStyle = style === 'brand' ? '#8a918c' : 'rgba(255,255,255,.75)'; ctx.fillText('Gym', W / 2 - 40 + vw, H - 170)

  return new Promise(res => c.toBlob(res, 'image/png'))
}

// Hand the image to the OS share sheet; falls back to a download.
export async function shareImage(blob, filename = 'vantixgym.png') {
  const { MOBILE } = await import('./mobile.js')
  if (MOBILE) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob) })
    const f = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: b64 })
    await Share.share({ files: [f.uri] })
    return 'shared'
  }
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return 'shared' }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return 'downloaded'
}
