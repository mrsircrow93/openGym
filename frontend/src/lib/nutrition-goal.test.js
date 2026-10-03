import { describe, it, expect } from 'vitest'
import { bmr, tdee, plan, problem, reviewDue, toKg } from './nutrition-goal.js'

const man = { sex: 'male', age: 30, heightCm: 175, weightKg: 80, activity: 'moderate' }
const woman = { sex: 'female', age: 45, heightCm: 160, weightKg: 58, activity: 'sedentary' }

describe('Mifflin-St Jeor', () => {
  it('matches the published equation', () => {
    expect(bmr(man)).toBe(Math.round(10 * 80 + 6.25 * 175 - 5 * 30 + 5))   // 1749
    expect(bmr(woman)).toBe(10 * 58 + 6.25 * 160 - 5 * 45 - 161)    // 1194
    expect(tdee(man)).toBe(Math.round(1749 * 1.55))
  })
})

describe('plan', () => {
  it('moderate fat loss is a 20 % deficit, ~0.5 kg a week, protein 2 g/kg', () => {
    const p = plan({ ...man, goal: 'lose', pace: 'moderate' })
    expect(p.maintenance).toBe(2711)
    expect(p.deficit).toBe(Math.round(2711 * 0.2))
    expect(p.kcal).toBe(2711 - p.deficit)
    expect(p.protein).toBe(160)
    expect(p.weeklyKg).toBeCloseTo(0.49, 1)
    expect(p.protein * 4 + p.carbs * 4 + p.fat * 9).toBeLessThanOrEqual(p.kcal + 10)
  })
  it('never goes under the floor for a small sedentary woman', () => {
    const p = plan({ ...woman, goal: 'lose', pace: 'strong' })
    expect(p.kcal).toBe(1200)
    expect(p.floorApplied).toBe(true)
  })
  it('caps the pace at 1 % of body weight a week', () => {
    const light = { sex: 'female', age: 25, heightCm: 165, weightKg: 50, activity: 'very' }
    const p = plan({ ...light, goal: 'lose', pace: 'strong' })
    expect(p.weeklyKg).toBeLessThanOrEqual(0.5 + 0.01)
    expect(p.capped || p.floorApplied).toBe(true)
  })
  it('maintain keeps maintenance; gain adds a small surplus', () => {
    expect(plan({ ...man, goal: 'maintain' }).kcal).toBe(2711)
    const g = plan({ ...man, goal: 'gain', pace: 'moderate' })
    expect(g.kcal).toBe(2711 + Math.round(2711 * 0.1))
    expect(g.weeklyKg).toBeGreaterThan(0)
  })
  it('estimates the date for a target weight', () => {
    const p = plan({ ...man, goal: 'lose', pace: 'moderate', targetKg: 75, now: Date.UTC(2026, 9, 3) })
    expect(p.weeksToTarget).toBe(Math.ceil(5 / p.weeklyKg))
    expect(p.eta).toBe("2026-12-19")
  })
})

describe('problem + reviewDue + units', () => {
  it('refuses minors and nonsense', () => {
    expect(problem({ ...man, age: 16 })).toMatch(/18/)
    expect(problem({ ...man, heightCm: 50 })).toMatch(/height/)
    expect(problem(man)).toBe(null)
  })
  it('asks for a review after 4 weeks or 3 kg', () => {
    const now = Date.now()
    expect(reviewDue({ at: now - 10 * 86400_000, weightKg: 80 }, 79, now)).toBe(false)
    expect(reviewDue({ at: now - 30 * 86400_000, weightKg: 80 }, 80, now)).toBe(true)
    expect(reviewDue({ at: now, weightKg: 80 }, 76.5, now)).toBe(true)
  })
  it('converts pounds', () => { expect(toKg(176.37, 'lb')).toBeCloseTo(80, 1) })
})
