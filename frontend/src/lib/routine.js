// Plain-language facts about a routine, shared by the Plan screen and the trainer result.
import { t } from './i18n.js'
import { exOr, isCardio } from './exercises.js'
import { modeOf } from './history.js'

// Rough session length: strength sets ~2.5 min each (work + rest), cardio by its minutes.
export function routineMinutes(r) {
  let min = 0
  for (const cfg of r.ex || []) {
    if (isCardio(cfg.id) || modeOf(cfg) === 'cardio') min += (cfg.sets || 1) * (cfg.min || 20)
    else min += (cfg.sets || 3) * 2.5
  }
  return Math.max(5, Math.round(min / 5) * 5)
}
// "Pecho, hombros y brazos" — body parts of the routine, in the person's language.
export function routineMuscles(r) {
  const seen = []
  for (const cfg of r.ex || []) { const bp = exOr(cfg.id).bp; if (bp && !seen.includes(bp)) seen.push(bp) }
  const names = seen.slice(0, 3).map(bp => t(bp))
  if (!names.length) return ''
  const txt = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' ' + t('and') + ' ' + names[names.length - 1]
  return txt.charAt(0).toUpperCase() + txt.slice(1)
}
// "3 series × 8" / "3 × 20 min" — what a person reads, without weights or tempo.
export function setsLabel(cfg) {
  const n = cfg.sets || 1
  const mode = modeOf(cfg)
  if (mode === 'cardio') return `${n} × ${cfg.min || 20} min`
  if (mode === 'time') return `${n} × ${cfg.sec || 45} s`
  return `${n} × ${cfg.reps || cfg.r || 10}`
}
