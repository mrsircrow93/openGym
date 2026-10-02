// Personal trainer: turns a short questionnaire into a weekly plan built only from exercises that
// exist in the library. Pure helpers here (candidate shortlist, validation, materialising the
// model's answer into routine objects); the sheet in sheets-trainer.jsx owns the UI.
import { allExercises, isCardio } from './exercises.js'
import { defaultConfig } from './history.js'
import { uid } from './format.js'
import { GLYPHS, DEFAULT_GLYPH } from './glyphs.js'

export const GOALS = ['strength', 'muscle', 'fatloss', 'endurance', 'general']
export const GOAL_LABEL = { strength: 'Get stronger', muscle: 'Build muscle', fatloss: 'Lose fat', endurance: 'Endurance & conditioning', general: 'General fitness & health' }
export const GOAL_ICON = { strength: 'barbell', muscle: 'arm', fatloss: 'flame', endurance: 'figureRun', general: 'heart' }
export const LEVELS = ['beginner', 'intermediate', 'advanced']
export const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
export const LEVEL_DESC = { beginner: 'under 6 months of consistent training', intermediate: '6 months – 2 years', advanced: '2+ years, structured training' }
export const EQUIP = ['gym', 'home', 'bodyweight']
export const EQUIP_LABEL = { gym: 'Full gym', home: 'Home: dumbbells & bands', bodyweight: 'Bodyweight only' }
export const EQUIP_ICON = { gym: 'machine', home: 'dumbbell', bodyweight: 'figureStrength' }
export const SESSION_LENGTHS = [30, 45, 60, 90]
export const FOCUS = ['chest', 'back', 'shoulders', 'arms', 'legs', 'glutes', 'core']
export const PROGRESSIONS = ['linear', 'double', 'greyskull']

export const DEFAULT_ANSWERS = { goal: 'muscle', level: 'beginner', days: 3, minutes: 60, equipment: 'gym', focus: [], limits: '', age: null, weight: null, targetW: null }

// Equipment sets that map onto the dataset's `eq` values. The gym list leaves out the odd
// one-offs (tire, hammer, bosu) that read as gimmicks in a plan.
const EQ_SETS = {
  gym: ['barbell', 'dumbbell', 'cable', 'leverage machine', 'body weight', 'smith machine', 'ez barbell', 'kettlebell', 'weighted', 'assisted', 'olympic barbell', 'trap bar', 'sled machine', 'rope', 'band', 'stationary bike', 'elliptical machine', 'stepmill machine', 'medicine ball', 'stability ball'],
  home: ['dumbbell', 'body weight', 'band', 'resistance band', 'kettlebell', 'weighted', 'stability ball'],
  bodyweight: ['body weight']
}

// "Body weight" in the dataset still includes moves that need a gym fixture — dip bars, a
// pull-up bar, a GHD, a bench, rings. At home or with no equipment those are out.
const FIXTURE_RE = /\b(dips?|pull[- ]?ups?|chin[- ]?ups?|hanging|glute[- ]?ham|muscle[- ]?ups?|rings?|parallel|bench|incline|decline|rope|sled|lever|machine|smith|cable|rack|ghd|rows?|inverted|australian|box|step[- ]?ups?|trx|suspension|roman chair|hyperextension|back extension|captain|preacher|pulldown|assisted|wall walk|handstand)\b/i
const HOME_BENCH_RE = /\b(bench|incline|decline|preacher|machine|cable|rack|smith|lever)\b/i
// At home or with nothing at all, a "body weight" move that needs a fixture is out; at home,
// dumbbell moves that need a bench or a rack are out too (floor and standing variants stay).
export const needsFixture = (ex, equipment) => {
  const n = (ex.n_en || ex.n || '')
  if (ex.eq === 'body weight') return FIXTURE_RE.test(n)
  return equipment === 'home' && HOME_BENCH_RE.test(n)
}

// Shortlist for the model. The whole library (1 300+) is too much to send and too much for
// the model to weigh, so: keep what the equipment allows, then take a round-robin per target
// muscle across equipment types, so every muscle has both free-weight and machine options and
// no single muscle hogs the list. Custom exercises always go in first — they're the person's.
export function trainerCandidates(S, equipment, cap = 420) {
  const allowed = new Set(EQ_SETS[equipment] || EQ_SETS.gym)
  const all = allExercises(S)
  const custom = (S.customEx || []).map(e => ({ id: e.id, n: e.n, tg: e.tg || e.bp, eq: e.eq || '' }))
  const byTg = {}
  for (const e of all) {
    if (custom.some(c => c.id === e.id) || !allowed.has(e.eq)) continue
    if (equipment !== 'gym' && needsFixture(e, equipment)) continue
    const k = e.tg || e.bp
    ;(byTg[k] = byTg[k] || {})[e.eq] = (byTg[k][e.eq] || []).concat([{ id: e.id, n: e.n, tg: k, eq: e.eq }])
  }
  const out = [...custom]
  const groups = Object.values(byTg)
  let added = true, round = 0
  while (out.length < cap && added) {
    added = false
    for (const g of groups) {
      for (const eq of Object.keys(g)) {
        const it = g[eq][round]
        if (it && out.length < cap) { out.push(it); added = true }
      }
    }
    round++
  }
  return out
}

// Prompt-side compaction: one short line per candidate keeps ~400 entries around 4k tokens.
export const candidatesText = cands => cands.map(c => `${c.id}|${c.n}|${c.tg}|${c.eq}`).join('\n')

const clampInt = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }

// Model answer -> { routines, week, dropped } with every id checked against the shortlist.
// Anything the model invented is dropped (and counted, so the UI can say so).
export function materializePlan(plan, candidates, maxDays = 7) {
  const valid = new Set(candidates.map(c => c.id))
  const routines = [], week = {}, taken = new Set()
  let dropped = 0
  for (const r of (plan && plan.routines) || []) {
    const ex = []
    for (const e of r.exercises || []) {
      if (!valid.has(e.id)) { dropped++; continue }
      const cfg = defaultConfig(e.id)
      if (isCardio(e.id)) { if (e.minutes > 0) cfg.min = clampInt(e.minutes, 5, 120, 20) }
      else {
        cfg.sets = clampInt(e.sets, 1, 8, cfg.sets)
        if (cfg.mode === 'time') { if (e.seconds > 0) cfg.sec = clampInt(e.seconds, 10, 300, cfg.sec) }
        else cfg.reps = clampInt(e.reps, 1, 30, cfg.reps)
        if (e.rest > 0) cfg.rest = clampInt(e.rest, 30, 300, 90)
      }
      if (e.note) cfg.note = String(e.note).slice(0, 120)
      ex.push({ id: e.id, ...cfg })
    }
    if (!ex.length) continue
    const id = uid()
    routines.push({ id, name: String(r.name || 'Workout').slice(0, 40), emoji: GLYPHS.includes(r.glyph) ? r.glyph : DEFAULT_GLYPH, prog: PROGRESSIONS.includes(plan.progression) ? plan.progression : 'linear', ex })
    for (const d of r.days || []) { const k = clampInt(d, 0, 6, -1); if (k >= 0 && !taken.has(k) && taken.size < maxDays) { taken.add(k); week[k] = id } }
  }
  return { routines, week, dropped }
}

// The request payload — profile facts folded in so the model gets everything in one place.
export function trainerRequestBody(S, answers, candidates) {
  const a = { ...DEFAULT_ANSWERS, ...answers }
  return {
    profile: {
      goal: a.goal, level: a.level, daysPerWeek: a.days, minutesPerSession: a.minutes, equipment: a.equipment,
      focus: a.focus, limitations: a.limits, age: a.age, sex: S.body === 'female' ? 'female' : 'male',
      bodyweight: a.weight, targetWeight: a.targetW, unit: S.unit || 'kg',
      lang: S.lang || 'en'
    },
    candidates
  }
}
