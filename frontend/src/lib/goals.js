// Daily goal celebrations: which goals got reached today that we have not cheered yet.
// Pure; the App effect calls it after state changes and marks what it showed in S.goalsSeen
// ({ 'YYYY-MM-DD': ['water', ...], ever: ['weight:72'] }) so each one fires once.
import { todayISO } from './format.js'
import { macroGoalOf, dayTotals, mealsOn } from './nutrition.js'
import { stepsOn, stepGoalOf } from './steps.js'
import { lastBW } from './history.js'

export const GOAL_META = {
  water: { icon: 'droplet', color: 'var(--blue)', title: 'Water goal reached!', body: 'You drank your {0} for today. Your body thanks you.' },
  steps: { icon: 'footsteps', color: 'var(--teal)', title: 'Step goal reached!', body: '{0} steps today. Movement adds up — nice work.' },
  protein: { icon: 'bolt', color: 'var(--acc)', title: 'Protein target hit!', body: '{0} g of protein today. That is what keeps and builds muscle.' },
  kcal: { icon: 'target', color: 'var(--yellow)', title: 'Right on your calories!', body: 'Today landed within your target of {0} kcal. Consistency like this is what moves the scale.' },
  weight: { icon: 'trophy', color: 'var(--orange)', title: 'You reached your target weight!', body: '{0} — the number you set as your goal. Take a moment to enjoy it.' }
}

const waterOf = (S, iso) => ((S.water || []).find(w => w.d === iso) || {}).ml || 0
const fmtMl = ml => (ml >= 1000 ? (Math.round(ml / 100) / 10) + ' L' : ml + ' ml')

// Goals reached today (and the one-off weight goal), with the detail for the message.
export function reachedGoals(S, iso = todayISO(), now = new Date()) {
  const out = []
  const g = macroGoalOf(S)
  const water = waterOf(S, iso)
  if (water > 0 && water >= (S.waterGoal || 2000)) out.push({ id: 'water', detail: fmtMl(S.waterGoal || 2000) })
  const steps = stepsOn(S, iso)
  if (steps > 0 && steps >= stepGoalOf(S)) out.push({ id: 'steps', detail: steps.toLocaleString() })
  const tot = dayTotals(S, iso)
  if (g.protein > 0 && tot.protein >= g.protein) out.push({ id: 'protein', detail: Math.round(tot.protein) })
  // Calories: only once the day is mostly done (evening, 3+ meals) and the total sits in the window.
  const meals = mealsOn(S, iso).length
  if (g.kcal > 0 && meals >= 3 && now.getHours() >= 18 && tot.kcal >= g.kcal * 0.9 && tot.kcal <= g.kcal * 1.05) out.push({ id: 'kcal', detail: g.kcal.toLocaleString() })
  const bw = lastBW(S)
  if (S.targetW && bw && bw.d === iso && Math.abs(bw.w - S.targetW) <= 0.2) out.push({ id: 'weight', detail: bw.w + ' ' + (S.unit || 'kg'), ever: 'weight:' + S.targetW })
  return out
}

// The ones not yet celebrated.
export function freshGoals(S, iso = todayISO(), now = new Date()) {
  const seen = S.goalsSeen || {}
  const today = new Set(seen[iso] || []), ever = new Set(seen.ever || [])
  return reachedGoals(S, iso, now).filter(x => (x.ever ? !ever.has(x.ever) : !today.has(x.id)))
}

// Mark as shown and prune days older than a week.
export function markGoalsSeen(S, goals, iso = todayISO()) {
  const seen = { ...(S.goalsSeen || {}) }
  seen[iso] = [...new Set([...(seen[iso] || []), ...goals.filter(x => !x.ever).map(x => x.id)])]
  seen.ever = [...new Set([...(seen.ever || []), ...goals.filter(x => x.ever).map(x => x.ever)])]
  const cutoff = new Date(iso + 'T12:00:00'); cutoff.setDate(cutoff.getDate() - 7)
  for (const k of Object.keys(seen)) if (k !== 'ever' && k < cutoff.toISOString().slice(0, 10)) delete seen[k]
  S.goalsSeen = seen
}
