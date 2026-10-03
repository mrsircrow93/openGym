import { describe, it, expect } from 'vitest'
import { reachedGoals, freshGoals, markGoalsSeen } from './goals.js'

const iso = '2026-10-03'
const base = { unit: 'kg', waterGoal: 2000, stepGoal: 8000, macroGoal: { kcal: 2000, protein: 140 }, water: [], steps: [], meals: [], bodyweight: [], workouts: [] }
const evening = new Date('2026-10-03T20:00:00')

describe('reachedGoals', () => {
  it('water and steps when the goal is met, not before', () => {
    expect(reachedGoals({ ...base, water: [{ d: iso, ml: 1500 }] }, iso, evening).map(x => x.id)).toEqual([])
    const r = reachedGoals({ ...base, water: [{ d: iso, ml: 2000 }], steps: [{ d: iso, n: 8200 }] }, iso, evening)
    expect(r.map(x => x.id)).toEqual(['water', 'steps'])
    expect(r[0].detail).toBe('2 L')
  })
  it('protein any time; calories only in the evening with 3+ meals inside the window', () => {
    const meal = (k, p) => ({ id: k, d: iso, type: 'lunch', items: [{ name: 'x', kcal: k, protein: p, carbs: 0, fat: 0 }] })
    const S = { ...base, meals: [meal(700, 50), meal(700, 50), meal(550, 45)] }
    expect(reachedGoals(S, iso, new Date('2026-10-03T13:00:00')).map(x => x.id)).toEqual(['protein'])
    expect(reachedGoals(S, iso, evening).map(x => x.id)).toEqual(['protein', 'kcal'])
    expect(reachedGoals({ ...base, meals: [meal(1200, 50), meal(1200, 50), meal(500, 45)] }, iso, evening).map(x => x.id)).toEqual(['protein'])
  })
  it('target weight once, keyed on the target', () => {
    const S = { ...base, targetW: 72, bodyweight: [{ d: iso, w: 72.1 }] }
    const r = reachedGoals(S, iso, evening); expect(r[0]).toMatchObject({ id: 'weight', ever: 'weight:72' })
    markGoalsSeen(S, r, iso)
    expect(freshGoals(S, iso, evening)).toEqual([])
    expect(S.goalsSeen.ever).toEqual(['weight:72'])
  })
  it('each daily goal fires once and old days are pruned', () => {
    const S = { ...base, water: [{ d: iso, ml: 2500 }], goalsSeen: { '2026-09-01': ['water'] } }
    const f = freshGoals(S, iso, evening); expect(f.map(x => x.id)).toEqual(['water'])
    markGoalsSeen(S, f, iso)
    expect(freshGoals(S, iso, evening)).toEqual([])
    expect(S.goalsSeen['2026-09-01']).toBeUndefined()
  })
})
