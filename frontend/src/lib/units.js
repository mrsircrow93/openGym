// Weight units. Numbers are stored as typed, in the profile's unit; switching the unit can
// convert everything already logged so the history keeps meaning the same thing.
export const KG_PER_LB = 0.45359237
export const plateStep = unit => (unit === 'lb' ? 5 : 2.5)
// Round to the nearest plate-friendly step for the unit (warm-up seeds, suggestions).
export const roundPlate = (w, unit) => { const s = plateStep(unit); return Math.max(0, Math.round(w / s) * s) }
const conv = (v, from, to) => (v == null || v === '' ? v : from === to ? v : Math.round((from === 'kg' ? v / KG_PER_LB : v * KG_PER_LB) * 10) / 10)

// Convert every stored weight in the profile from one unit to the other, in place.
export function convertProfile(S, from, to) {
  if (from === to) return S
  const c = v => conv(v, from, to)
  for (const b of S.bodyweight || []) b.w = c(b.w)
  if (S.targetW) S.targetW = c(S.targetW)
  for (const w of S.workouts || []) {
    if (w.bw) w.bw = c(w.bw)
    if (w.vol) w.vol = Math.round(c(w.vol))
    for (const e of w.entries || []) {
      if (e.topW) e.topW = c(e.topW)
      if (e.target && e.target.weight) e.target.weight = c(e.target.weight)
      for (const s of e.sets || []) if (s.w) s.w = c(s.w)
    }
  }
  for (const r of S.routines || []) for (const cfg of r.ex || []) if (cfg.weight) cfg.weight = c(cfg.weight)
  for (const k of Object.keys(S.exWeights || {})) if (S.exWeights[k] && S.exWeights[k].w) S.exWeights[k].w = c(S.exWeights[k].w)
  if (S.active) {
    if (S.active.bw) S.active.bw = c(S.active.bw)
    for (const e of S.active.entries || []) { if (e.target && e.target.weight) e.target.weight = c(e.target.weight); for (const s of e.sets || []) if (s.w) s.w = c(s.w) }
  }
  if (S.trainer && S.trainer.answers) { const a = S.trainer.answers; if (a.weight) a.weight = c(a.weight); if (a.targetW) a.targetW = c(a.targetW) }
  S.unit = to
  return S
}
