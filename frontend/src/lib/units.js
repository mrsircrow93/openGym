// Weight units.
//
// Weights are stored in KILOGRAMS, always, whatever the person reads on screen. That was not
// always true: until the canonical migration below, every number was stored exactly as typed in
// whatever unit the profile had that day, and switching the unit rewrote the whole history. The
// rewrite rounded to one decimal, so it lost information and never came back to where it started
// — 20 lb became 9.1 kg became 20.1 lb, and the drift stuck. It also made it impossible to log a
// pound dumbbell and a kilo machine in the same session, which is what a real gym looks like.
//
// With kilograms underneath, a unit is only ever a way to read and type a number: the history,
// the records, the volumes and the progression suggestions never move. Three units can be in
// play at once and still agree — the profile's default for loads (S.unit), an optional override
// per exercise (S.exUnits[id]) and a separate one for body weight (S.bwUnit).
export const KG_PER_LB = 0.45359237
export const UNITS = ['kg', 'lb']

// Stored precision. Three decimals is past anything a plate can express, and it survives the
// round trip: 20 lb stores as 9.072 kg and reads back as 20.0, not 20.1.
const r3 = v => Math.round(v * 1000) / 1000

/** kg (stored) → the number to show in `unit`. */
export const toDisplay = (kg, unit) => (kg == null || kg === '' ? kg : unit === 'lb' ? kg / KG_PER_LB : kg)
/** a number typed in `unit` → kg to store. */
export const fromDisplay = (v, unit) => (v == null || v === '' ? v : unit === 'lb' ? r3(v * KG_PER_LB) : r3(v))

/** The unit this exercise is logged in: its own override, else the profile's load unit. */
export const loadUnit = (S, exId) => (exId && S.exUnits && S.exUnits[exId]) || (S && S.unit) || 'kg'
/** Body weight reads in its own unit — a person can train in pounds and weigh in kilos. */
export const bodyUnit = S => (S && S.bwUnit) || (S && S.unit) || 'kg'

export const plateStep = unit => (unit === 'lb' ? 5 : 2.5)
// Round to the nearest plate-friendly step for the unit (warm-up seeds, suggestions). Works in
// display units, because plates are a fact about the gym, not about storage.
export const roundPlate = (w, unit) => { const s = plateStep(unit); return Math.max(0, Math.round(w / s) * s) }

// Every field in the profile that holds a weight. One list, used by the migration and by the
// tests, so a new weight-bearing field cannot be added in one place and forgotten in the other.
function eachWeight(S, fn) {
  const map = (o, k) => { if (o && o[k] != null && o[k] !== '') o[k] = fn(o[k]) }
  for (const b of S.bodyweight || []) map(b, 'w')
  map(S, 'targetW')
  for (const c of S.checkins || []) map(c, 'w')
  const workout = w => {
    map(w, 'bw')
    if (w.vol != null) w.vol = Math.round(fn(w.vol))
    for (const e of w.entries || []) {
      map(e, 'topW')
      if (e.target) map(e.target, 'weight')
      for (const s of e.sets || []) map(s, 'w')
    }
  }
  for (const w of S.workouts || []) workout(w)
  if (S.active) workout(S.active)
  // `cfg.inc` is deliberately NOT here. A progression step is a statement about the gym — "add
  // five pounds" — so it stays in the unit the exercise is logged in, and the progression engine
  // works in display units and hands back a number to convert on the way into storage.
  for (const r of S.routines || []) for (const cfg of r.ex || []) map(cfg, 'weight')
  for (const k of Object.keys(S.exWeights || {})) map(S.exWeights[k], 'w')
  if (S.trainer && S.trainer.answers) { map(S.trainer.answers, 'weight'); map(S.trainer.answers, 'targetW') }
  return S
}

// Bump when the stored shape of weights changes again.
export const WEIGHT_SCHEMA = 2

/**
 * One-way migration to canonical kilograms, idempotent and safe to run on every load path —
 * local storage, a server pull and an imported backup all go through it.
 *
 * A profile that has never been touched is marked without converting anything, because an empty
 * history has nothing to misread. A profile from before the change is converted out of whatever
 * `unit` it was written in, and that same unit stays as the display default so nobody's screen
 * changes on the day they update.
 */
export function toCanonicalKg(S) {
  if (!S || S.wSchema >= WEIGHT_SCHEMA) return S
  const from = S.unit === 'lb' ? 'lb' : 'kg'
  if (from === 'lb') eachWeight(S, v => r3(v * KG_PER_LB))
  // Body weight keeps reading in the unit it was written in; the person can split the two later.
  if (!S.bwUnit) S.bwUnit = from
  if (!S.exUnits) S.exUnits = {}
  S.wSchema = WEIGHT_SCHEMA
  return S
}

// Exported for tests and for anything that needs to walk the weights (an export, say).
export { eachWeight }
