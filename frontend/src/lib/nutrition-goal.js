// Calorie goal assistant: how many calories and macros for the goal the person picked, with the
// maths and the guard-rails in one place. Everything the UI shows comes from here, so the
// "where do these numbers come from" sheet and the tests describe the same thing.
//
// Evidence used (cited in the UI):
//  - Resting energy: Mifflin-St Jeor (1990), the equation with the best accuracy in adults.
//  - Activity multipliers: the usual 1.2–1.9 ladder from the same literature.
//  - Deficit / surplus: 10–25 % of maintenance; ~0.25–0.75 kg a week; never more than 1 % of
//    body weight a week (WHO / CDC guidance on sustainable weight loss).
//  - Protein 1.6–2.2 g/kg (ISSN position stand), higher end in a deficit; fat 25–30 % of kcal.
//  - Floors: 1,200 kcal (women) / 1,500 kcal (men) — below that, a professional should be involved.

export const GOALS = ['lose', 'maintain', 'gain']
export const GOAL_LABEL = { lose: 'Lose fat', maintain: 'Maintain', gain: 'Gain muscle' }
export const ACTIVITY = ['sedentary', 'light', 'moderate', 'active', 'very']
export const ACTIVITY_LABEL = { sedentary: 'Mostly sitting', light: 'Light: on my feet some of the day, or 1–2 workouts a week', moderate: 'Moderate: 3–4 workouts a week', active: 'Active: 5–6 workouts a week or a physical job', very: 'Very active: hard training most days plus a physical job' }
export const ACTIVITY_FACTOR = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9 }
export const PACES = ['gentle', 'moderate', 'strong']
export const PACE_LABEL = { gentle: 'Gentle', moderate: 'Moderate (recommended)', strong: 'Strong' }
// Fraction of maintenance taken off (lose) or added (gain). Gain is deliberately small: muscle
// grows slowly and a big surplus just adds fat.
const PACE_PCT = { lose: { gentle: 0.12, moderate: 0.20, strong: 0.25 }, gain: { gentle: 0.05, moderate: 0.10, strong: 0.15 }, maintain: { gentle: 0, moderate: 0, strong: 0 } }
export const KCAL_PER_KG = 7700          // energy in a kilogram of body fat, the usual planning figure
export const FLOOR = { female: 1200, male: 1500 }
export const MAX_WEEKLY_FRACTION = 0.01  // never plan to lose more than 1 % of body weight a week

export const toKg = (w, unit) => (unit === 'lb' ? w * 0.45359237 : w)
export const fromKg = (kg, unit) => (unit === 'lb' ? kg / 0.45359237 : kg)

// Resting energy expenditure, kcal/day.
export function bmr({ sex, age, heightCm, weightKg }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return Math.round(sex === 'female' ? base - 161 : base + 5)
}
export const tdee = (p) => Math.round(bmr(p) * (ACTIVITY_FACTOR[p.activity] || 1.55))

// What is wrong with the inputs, as a message key, or null.
export function problem(p) {
  if (!(p.age >= 18)) return 'This assistant is for adults (18+). Under 18, please work with a nutritionist or doctor.'
  if (!(p.age <= 90)) return 'Enter a valid age.'
  if (!(p.heightCm >= 120 && p.heightCm <= 230)) return 'Enter your height in centimetres (120–230).'
  if (!(p.weightKg >= 35 && p.weightKg <= 300)) return 'Enter a valid body weight.'
  return null
}

// The plan: { kcal, protein, carbs, fat, maintenance, deficit, weeklyKg, floorApplied, capped, weeksToTarget, eta }
export function plan(p) {
  const maint = tdee(p)
  const pct = (PACE_PCT[p.goal] || PACE_PCT.maintain)[p.pace || 'moderate'] || 0
  let delta = Math.round(maint * pct)                      // kcal/day taken off or added
  let capped = false, floorApplied = false
  if (p.goal === 'lose') {
    // 1 % of body weight a week is the ceiling whatever the pace says
    const maxDaily = Math.round(p.weightKg * MAX_WEEKLY_FRACTION * KCAL_PER_KG / 7)
    if (delta > maxDaily) { delta = maxDaily; capped = true }
  }
  let kcal = p.goal === 'lose' ? maint - delta : p.goal === 'gain' ? maint + delta : maint
  const floor = FLOOR[p.sex === 'female' ? 'female' : 'male']
  if (kcal < floor) { kcal = floor; floorApplied = true; delta = maint - kcal }
  // protein by body weight: more in a deficit (keeps muscle), the ISSN 1.6–2.2 g/kg band
  const gkg = p.goal === 'lose' ? 2.0 : p.goal === 'gain' ? 1.8 : 1.6
  let protein = Math.round(p.weightKg * gkg)
  protein = Math.min(protein, Math.round(kcal * 0.4 / 4))   // never more than 40 % of calories
  let fat = Math.round(kcal * 0.28 / 9)
  let carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  const weeklyKg = p.goal === 'maintain' ? 0 : Math.round((delta * 7 / KCAL_PER_KG) * 100) / 100
  let weeksToTarget = null, eta = null
  if (p.targetKg && p.goal !== 'maintain' && weeklyKg > 0) {
    const gap = p.goal === 'lose' ? p.weightKg - p.targetKg : p.targetKg - p.weightKg
    if (gap > 0) { weeksToTarget = Math.ceil(gap / weeklyKg); eta = new Date((p.now || Date.now()) + weeksToTarget * 7 * 86400_000).toISOString().slice(0, 10) }
  }
  return { kcal, protein, carbs, fat, maintenance: maint, bmr: bmr(p), deficit: p.goal === 'lose' ? delta : p.goal === 'gain' ? -delta : 0, weeklyKg, floorApplied, capped, weeksToTarget, eta }
}

// When to look at the goal again: 4 weeks later, or once the scale moved 3 kg either way.
export function reviewDue(goal, currentKg, now = Date.now()) {
  if (!goal) return false
  if (now - (goal.at || 0) > 28 * 86400_000) return true
  return currentKg != null && Math.abs(currentKg - goal.weightKg) >= 3
}
