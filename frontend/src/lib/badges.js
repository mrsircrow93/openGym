// Achievements ("Logros"). Everything is derived from the profile's history, so there is
// nothing to store except which ones the person has already been shown (S.badgesSeen).
// Each badge: { id, cat, icon, tier, name, desc, goal, value, earned: ISO|null, pct }.
import { t } from './i18n.js'
import { weekKey, isoOf } from './format.js'
import { workoutVolume } from './history.js'

export const CATS = ['workouts', 'streaks', 'month', 'volume', 'milestones', 'steps']
export const CAT_NAME = { workouts: 'Workouts', streaks: 'Streaks', month: 'Calendar', volume: 'Volume', milestones: 'Milestones', steps: 'Steps' }
export const CAT_ICON = { workouts: 'target', streaks: 'flame', month: 'calendar', volume: 'kettlebell', milestones: 'trophy', steps: 'footsteps' }

// Thresholds per category. `tier` drives the badge colour (1 bronze … 4 gold).
const TIERS = {
  workouts: [[1, 1], [10, 1], [25, 2], [50, 2], [100, 3], [250, 4], [500, 4]],
  streaks: [[2, 1], [4, 1], [8, 2], [12, 2], [26, 3], [52, 4]],
  month: [[8, 1], [12, 2], [16, 3], [20, 4]],
  volume: [[10, 1], [50, 2], [100, 2], [250, 3], [500, 3], [1000, 4]],   // tonnes lifted, all time
  steps: [[10, 1], [15, 2], [20, 3], [100, 4]]                             // k steps in a day; last = 100k in a week
}

const sortedWorkouts = S => [...(S.workouts || [])].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))

export function computeBadges(S) {
  const ws = sortedWorkouts(S)
  const out = []
  const push = b => out.push({ ...b, pct: b.earned ? 1 : Math.min(0.999, Math.max(0, (b.value || 0) / b.goal)) })

  // --- workouts: nth completed
  for (const [n, tier] of TIERS.workouts) push({ id: 'w' + n, cat: 'workouts', icon: 'target', tier, goal: n, value: ws.length,
    name: n === 1 ? t('First workout') : t('{0} workouts', n), desc: t('Complete {0} workouts', n), earned: ws[n - 1] ? ws[n - 1].d : null })

  // --- streaks: longest run of consecutive weeks with a workout (date = end of that run)
  const weeks = [...new Set(ws.map(w => weekKey(w.d)))].sort()
  const weekEnd = {}
  for (const w of ws) weekEnd[weekKey(w.d)] = w.d
  let bestRun = 0, run = 0, prev = null, runEnds = {}
  for (const wk of weeks) {
    const d = new Date(weekEnd[wk] + 'T12:00:00')
    const prevD = prev ? new Date(weekEnd[prev] + 'T12:00:00') : null
    run = prevD && (d - prevD) < 14 * 86400000 && weekKey(isoOf(new Date(prevD.getTime() + 7 * 86400000))) === wk ? run + 1 : 1
    bestRun = Math.max(bestRun, run)
    if (!runEnds[run]) runEnds[run] = weekEnd[wk]
    prev = wk
  }
  for (const [n, tier] of TIERS.streaks) push({ id: 's' + n, cat: 'streaks', icon: 'flame', tier, goal: n, value: bestRun,
    name: t('{0}-week streak', n), desc: t('Train at least once a week for {0} weeks in a row', n), earned: bestRun >= n ? (runEnds[n] || null) : null })

  // --- calendar: workouts in one calendar month
  const byMonth = {}
  for (const w of ws) (byMonth[w.d.slice(0, 7)] = byMonth[w.d.slice(0, 7)] || []).push(w)
  const bestMonth = Math.max(0, ...Object.values(byMonth).map(a => a.length))
  for (const [n, tier] of TIERS.month) {
    const m = Object.keys(byMonth).sort().find(k => byMonth[k].length >= n)
    push({ id: 'm' + n, cat: 'month', icon: 'calendar', tier, goal: n, value: bestMonth,
      name: t('{0} workouts in a month', n), desc: t('Complete {0} workouts within one calendar month', n), earned: m ? byMonth[m][n - 1].d : null })
  }

  // --- volume: cumulative tonnes
  let cum = 0, cumAt = {}
  for (const w of ws) { cum += (w.vol || workoutVolume(w) || 0) / 1000; for (const [n] of TIERS.volume) if (cum >= n && !cumAt[n]) cumAt[n] = w.d }
  for (const [n, tier] of TIERS.volume) push({ id: 'v' + n, cat: 'volume', icon: 'kettlebell', tier, goal: n, value: Math.round(cum * 10) / 10,
    name: t('{0} tonnes lifted', n), desc: t('Lift {0} tonnes in total across all workouts', n), earned: cumAt[n] || null })

  // --- milestones: one-offs
  const firstPR = ws.find(w => w.prs && w.prs.length)
  const prCount = ws.reduce((a, w) => a + ((w.prs || []).length), 0)
  const prAt = (() => { let c = 0; for (const w of ws) { c += (w.prs || []).length; if (c >= 10) return w.d } return null })()
  const meals = S.meals || []
  const mealDays = [...new Set(meals.map(m => m.d))].sort()
  let mealRun = 0, bestMealRun = 0, mealRunEnd = null, prevDay = null
  for (const d of mealDays) { mealRun = prevDay && (new Date(d) - new Date(prevDay)) === 86400000 ? mealRun + 1 : 1; prevDay = d; if (mealRun > bestMealRun) { bestMealRun = mealRun; mealRunEnd = d } }
  const bw = S.bodyweight || []
  const goalHit = S.targetW && bw.length > 1 ? bw.find((b, i) => i > 0 && ((bw[0].w > S.targetW && b.w <= S.targetW) || (bw[0].w < S.targetW && b.w >= S.targetW))) : null
  const ms = [
    { id: 'pr1', icon: 'trophy', tier: 1, name: t('First personal record'), desc: t('Beat your best weight on an exercise'), earned: firstPR ? firstPR.d : null, goal: 1, value: prCount },
    { id: 'pr10', icon: 'trophy', tier: 3, name: t('10 personal records'), desc: t('Beat your best on exercises 10 times'), earned: prAt, goal: 10, value: prCount },
    { id: 'plan', icon: 'sparkles', tier: 1, name: t('Plan in hand'), desc: t('Let the trainer build your week'), earned: S.trainer ? isoOf(new Date(S.trainer.at || Date.now())) : null, goal: 1, value: S.trainer ? 1 : 0 },
    { id: 'meal1', icon: 'camera', tier: 1, name: t('First meal logged'), desc: t('Log your first meal'), earned: mealDays[0] || null, goal: 1, value: mealDays.length },
    { id: 'meal7', icon: 'utensils', tier: 2, name: t('7 days of meals'), desc: t('Log meals seven days in a row'), earned: bestMealRun >= 7 ? mealRunEnd : null, goal: 7, value: bestMealRun },
    { id: 'coach', icon: 'heart', tier: 1, name: t('Met your coach'), desc: t('Pick Sofía or Leo'), earned: S.coach ? (ws[0] ? ws[0].d : isoOf(new Date())) : null, goal: 1, value: S.coach ? 1 : 0 },
    { id: 'goalw', icon: 'scale', tier: 4, name: t('Goal weight reached'), desc: t('Reach the body-weight goal you set'), earned: goalHit ? goalHit.d : null, goal: 1, value: goalHit ? 1 : 0 }
  ]
  for (const m of ms) push({ cat: 'milestones', ...m })

  // --- steps
  const steps = S.steps || []
  const bestDay = Math.max(0, ...steps.map(r => r.n || 0))
  const dayAt = n => (steps.find(r => (r.n || 0) >= n * 1000) || {}).d || null
  for (const [n, tier] of TIERS.steps.slice(0, 3)) push({ id: 'st' + n, cat: 'steps', icon: 'footsteps', tier, goal: n * 1000, value: bestDay,
    name: t('{0} steps in a day', n + 'k'), desc: t('Walk {0} steps in a single day', fmtK(n * 1000)), earned: dayAt(n) })
  const byWeek = {}
  for (const r of steps) byWeek[weekKey(r.d)] = (byWeek[weekKey(r.d)] || 0) + (r.n || 0)
  const bestWeek = Math.max(0, ...Object.values(byWeek))
  const wkAt = Object.keys(byWeek).sort().find(k => byWeek[k] >= 100000)
  push({ id: 'st100w', cat: 'steps', icon: 'footsteps', tier: 4, goal: 100000, value: bestWeek, name: t('100k steps in a week'), desc: t('Walk 100,000 steps within one week'),
    earned: wkAt ? (steps.filter(r => weekKey(r.d) === wkAt).slice(-1)[0] || {}).d || null : null })

  return out
}
const fmtK = n => n.toLocaleString()

export const earnedBadges = S => computeBadges(S).filter(b => b.earned)
// Badges earned but not yet celebrated. The caller marks them seen after showing.
export const newBadges = S => earnedBadges(S).filter(b => !(S.badgesSeen || []).includes(b.id))
export const latestInCat = (badges, cat) => badges.filter(b => b.cat === cat && b.earned).sort((a, b) => (a.earned < b.earned ? 1 : -1))[0] || null
export const nextInCat = (badges, cat) => badges.filter(b => b.cat === cat && !b.earned).sort((a, b) => a.goal - b.goal)[0] || null
