// Meal log: pure helpers, no store access. Everything the Nutrition view and the meal sheets
// compute lives here so it can be unit-tested and so the numbers agree everywhere.
//
// A meal is { id, d: 'YYYY-MM-DD', t: 'HH:MM', type, name, items: [item], ai: bool, note }
// and an item is { name, portion, grams, kcal, protein, carbs, fat } — macros in grams for the
// portion as logged (not per 100 g). The meal's totals are always derived from its items, never
// stored, so editing a portion can't leave a stale sum behind.

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
export const MEAL_TYPE_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
export const MEAL_TYPE_ICON = { breakfast: 'sun', lunch: 'flame', dinner: 'moon', snack: 'star' }

// Default daily targets. Deliberately moderate — a first-time user sees a sensible bar rather
// than a bodybuilder's 3 500 kcal. Adjustable in the goal sheet.
export const DEFAULT_MACRO_GOAL = { kcal: 2000, protein: 140, carbs: 220, fat: 65 }
export const macroGoalOf = S => ({ ...DEFAULT_MACRO_GOAL, ...(S.macroGoal || {}) })

const r1 = n => Math.round((+n || 0) * 10) / 10
const r0 = n => Math.round(+n || 0)

export function cleanItem(raw) {
  const grams = Math.max(0, r0(raw.grams))
  return {
    name: String(raw.name || '').trim().slice(0, 80) || 'Food',
    portion: String(raw.portion || '').trim().slice(0, 80),
    grams,
    kcal: Math.max(0, r0(raw.kcal)),
    protein: Math.max(0, r1(raw.protein)),
    carbs: Math.max(0, r1(raw.carbs)),
    fat: Math.max(0, r1(raw.fat))
  }
}

// Re-estimate an item at a different weight. Nutrition scales linearly with mass, so a portion
// bumped from 150 g to 200 g is simply ×4/3 — that's how the "adjust portion" stepper works
// without another AI round-trip.
export function scaleItem(item, grams) {
  const g = Math.max(0, r0(grams))
  if (!item.grams) return { ...item, grams: g }
  const k = g / item.grams
  return { ...item, grams: g, kcal: r0(item.kcal * k), protein: r1(item.protein * k), carbs: r1(item.carbs * k), fat: r1(item.fat * k) }
}

export function totalsOf(items) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  for (const i of items || []) { t.kcal += +i.kcal || 0; t.protein += +i.protein || 0; t.carbs += +i.carbs || 0; t.fat += +i.fat || 0 }
  return { kcal: r0(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) }
}

export const mealsOn = (S, iso) => (S.meals || []).filter(m => m.d === iso).sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
export const dayTotals = (S, iso) => totalsOf(mealsOn(S, iso).flatMap(m => m.items || []))

// { iso: kcal } for every day with at least one meal — feeds the week strip and the calendar.
export function kcalByDay(S) {
  const out = {}
  for (const m of S.meals || []) out[m.d] = (out[m.d] || 0) + totalsOf(m.items).kcal
  return out
}

// Percent of a goal, capped at 100 for bars (the label shows the real number).
export const pctOf = (v, goal) => (goal > 0 ? Math.min(100, Math.round((v / goal) * 100)) : 0)

// Rough calorie split by macro: 4/4/9 kcal per gram. Used for the "where the calories come
// from" ring, which is more useful than another list of grams.
export function macroSplit(t) {
  const p = t.protein * 4, c = t.carbs * 4, f = t.fat * 9
  const sum = p + c + f
  if (!sum) return { protein: 0, carbs: 0, fat: 0 }
  return { protein: Math.round((p / sum) * 100), carbs: Math.round((c / sum) * 100), fat: Math.max(0, 100 - Math.round((p / sum) * 100) - Math.round((c / sum) * 100)) }
}

// Which meal slot a clock time most likely is — pre-selects the type so logging is one tap.
export function guessMealType(hhmm) {
  const h = parseInt(String(hhmm || '12:00').slice(0, 2), 10)
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 18) return 'snack'
  if (h < 23) return 'dinner'
  return 'snack'
}

export const nowHHMM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

// Average daily intake over the last `days` days that have entries (empty days aren't zeros —
// a missed log isn't a fast).
export function avgLogged(S, days = 7) {
  const by = {}
  for (const m of S.meals || []) (by[m.d] = by[m.d] || []).push(...(m.items || []))
  const keys = Object.keys(by).sort().slice(-days)
  if (!keys.length) return null
  const sum = totalsOf(keys.flatMap(k => by[k]))
  return { days: keys.length, kcal: r0(sum.kcal / keys.length), protein: r1(sum.protein / keys.length), carbs: r1(sum.carbs / keys.length), fat: r1(sum.fat / keys.length) }
}
