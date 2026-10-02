// Someone's existing routine (coach's PDF, gym card photo) -> routine objects. The model
// transcribes (api: import-routine) and this file turns that into something the app can save:
// each exercise is matched to the library by its canonical English name; what does not match
// becomes a custom exercise with the name as written, so nothing on the sheet is lost.
import { EXIDX, isCardio } from './exercises.js'
import { defaultConfig } from './history.js'
import { uid } from './format.js'
import { GLYPHS, DEFAULT_GLYPH } from './glyphs.js'
import { matchExercise } from './import-csv.js'

const clampInt = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }

// The model's muscle labels -> the dataset's body parts, for the exercises we have to invent.
const MUSCLE_BP = {
  chest: 'chest', back: 'back', shoulders: 'shoulders', biceps: 'upper arms', triceps: 'upper arms', forearms: 'lower arms',
  quads: 'upper legs', hamstrings: 'upper legs', glutes: 'upper legs', calves: 'lower legs', abs: 'waist',
  cardio: 'cardio', 'full body': 'upper legs', other: 'upper legs'
}

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

// Library id for a transcribed exercise: canonical English name first, then the name as
// written (coaches in English-speaking gyms write the database name already), else null.
export function matchImported(e) {
  const tries = [e.name_en, e.name].map(x => clean(x, 80)).filter(Boolean)
  for (const n of tries) { const id = matchExercise(n); if (id && EXIDX[id]) return id }
  return null
}

// { routines, week, custom, matched, created } — `custom` are new entries for S.customEx,
// which the caller must push AND registerCustom() before the routines are usable.
export function materializeImport(parsed, S, maxDays = 7) {
  const routines = [], week = {}, custom = [], taken = new Set()
  const existing = new Map((S.customEx || []).map(c => [c.n.toLowerCase(), c.id]))
  let matched = 0, created = 0
  for (const r of (parsed && parsed.routines) || []) {
    const ex = []
    for (const e of r.exercises || []) {
      const name = clean(e.name, 60) || clean(e.name_en, 60)
      if (!name) continue
      let id = matchImported(e)
      if (id) matched++
      else {
        id = existing.get(name.toLowerCase())
        if (!id) {
          id = 'c' + uid()
          const c = { id, n: name, bp: MUSCLE_BP[e.muscle] || 'upper legs', desc: '', tg: '', eq: 'custom', custom: true }
          custom.push(c); existing.set(name.toLowerCase(), id); created++
        }
      }
      const cardio = EXIDX[id] ? isCardio(id) : e.muscle === 'cardio'
      const cfg = cardio || (!EXIDX[id] && e.minutes > 0)
        ? { ...defaultConfig(id, 'cardio'), mode: 'cardio', min: clampInt(e.minutes, 1, 180, 20) }
        : e.seconds > 0 && !(e.reps > 0)
          ? { ...defaultConfig(id, 'time'), sec: clampInt(e.seconds, 5, 600, 45) }
          : { ...defaultConfig(id, 'reps'), reps: clampInt(e.reps, 1, 50, 10) }
      if (cfg.mode !== 'cardio') {
        cfg.sets = clampInt(e.sets, 1, 10, cfg.sets || 3)
        if (e.rest > 0) cfg.rest = clampInt(e.rest, 15, 600, 90)
      }
      const note = [clean(e.weight, 20), clean(e.note, 100)].filter(Boolean).join(' · ')
      if (note) cfg.note = note.slice(0, 120)
      ex.push({ id, ...cfg })
    }
    if (!ex.length) continue
    const rid = uid()
    routines.push({ id: rid, name: clean(r.name, 40) || 'Workout', emoji: GLYPHS.includes(r.glyph) ? r.glyph : DEFAULT_GLYPH, prog: 'linear', ex })
    for (const d of r.days || []) { const k = clampInt(d, 0, 6, -1); if (k >= 0 && !taken.has(k) && taken.size < maxDays) { taken.add(k); week[k] = rid } }
  }
  // No weekdays on the sheet: lay the sessions out Mon, Wed, Fri… so the week view isn't empty.
  if (!Object.keys(week).length && routines.length) {
    const slots = routines.length <= 3 ? [1, 3, 5] : routines.length === 4 ? [1, 2, 4, 5] : [1, 2, 3, 4, 5, 6, 0]
    routines.forEach((r, i) => { if (slots[i] != null) week[slots[i]] = r.id })
  }
  return { routines, week, custom, matched, created, dropped: 0 }
}
