// Step counter: pure helpers. One row per day in S.steps: { d: 'YYYY-MM-DD', n, src }.
// `src` is 'manual' today; a native source (HealthKit / Health Connect on the store builds)
// writes 'health' rows through the same setSteps() and wins over a manual entry for that day.
// Browsers have no pedometer API, so the web/PWA path is hand entry — see docs/STEPS.md.

export const DEFAULT_STEP_GOAL = 8000
export const stepGoalOf = S => Math.max(500, +S.stepGoal || DEFAULT_STEP_GOAL)

export const stepRow = (S, iso) => (S.steps || []).find(r => r.d === iso) || null
export const stepsOn = (S, iso) => (stepRow(S, iso) || {}).n || 0

// Percent of goal, capped for bars; the label shows the real number.
export const stepPct = (n, goal) => (goal > 0 ? Math.min(100, Math.round((n / goal) * 100)) : 0)

// Upsert the day's total. Rows stay sorted by date so the last one is always "latest".
export function setSteps(S, iso, n, src = 'manual') {
  S.steps = S.steps || []
  const row = S.steps.find(r => r.d === iso)
  const v = Math.max(0, Math.round(+n || 0))
  if (row) { row.n = v; row.src = src } else S.steps.push({ d: iso, n: v, src })
  S.steps.sort((a, b) => (a.d < b.d ? -1 : 1))
}

// Only manual rows can be bumped by hand; a health-sourced day is the phone's number.
export function addSteps(S, iso, delta) {
  const row = stepRow(S, iso)
  if (row && row.src === 'health') return false
  setSteps(S, iso, stepsOn(S, iso) + delta, 'manual')
  return true
}

const isoOfDate = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

// Last `days` calendar days ending on `iso`, oldest first — for the week bars.
export function stepSeries(S, iso, days = 7) {
  const end = new Date(iso + 'T12:00:00')
  const out = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end); d.setDate(end.getDate() - i)
    const k = isoOfDate(d)
    out.push({ d: k, n: stepsOn(S, k) })
  }
  return out
}

// Consecutive days up to and including `iso` that met the goal.
export function stepStreak(S, iso) {
  const goal = stepGoalOf(S)
  let n = 0
  const d = new Date(iso + 'T12:00:00')
  while (n < 3650 && stepsOn(S, isoOfDate(d)) >= goal) { n++; d.setDate(d.getDate() - 1) }
  return n
}

// Rough distance and burn so the card can say "5.2 km · 210 kcal". Stride from height when
// known (0.415 × height), else 0.72 m; ~0.0005 kcal per step per kg is the usual flat-walk figure.
export function stepStats(n, { heightCm, weightKg } = {}) {
  const stride = heightCm ? (heightCm / 100) * 0.415 : 0.72
  const km = Math.round((n * stride) / 100) / 10
  const kcal = Math.round(n * 0.0005 * (weightKg || 70))
  return { km, kcal }
}
