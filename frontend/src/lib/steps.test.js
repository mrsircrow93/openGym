import { describe, it, expect } from 'vitest'
import { setSteps, addSteps, stepsOn, stepSeries, stepStreak, stepStats, stepGoalOf, stepPct } from './steps.js'

describe('steps', () => {
  it('upserts and keeps rows sorted', () => {
    const S = {}
    setSteps(S, '2026-09-29', 4000)
    setSteps(S, '2026-09-27', 9000)
    setSteps(S, '2026-09-29', 5000)
    expect(S.steps.map(r => r.d)).toEqual(['2026-09-27', '2026-09-29'])
    expect(stepsOn(S, '2026-09-29')).toBe(5000)
    expect(stepsOn(S, '2026-09-28')).toBe(0)
  })
  it('adds to manual rows, refuses to touch a health-sourced day', () => {
    const S = { steps: [{ d: '2026-09-29', n: 1000, src: 'health' }] }
    expect(addSteps(S, '2026-09-29', 500)).toBe(false)
    expect(stepsOn(S, '2026-09-29')).toBe(1000)
    expect(addSteps(S, '2026-09-28', 500)).toBe(true)
    expect(stepsOn(S, '2026-09-28')).toBe(500)
    addSteps(S, '2026-09-28', -900)
    expect(stepsOn(S, '2026-09-28')).toBe(0)
  })
  it('series covers the window oldest-first, streak counts back from the day', () => {
    const S = { stepGoal: 8000, steps: [] }
    for (const d of ['2026-09-27', '2026-09-28', '2026-09-29']) setSteps(S, d, 8500)
    const s = stepSeries(S, '2026-09-29', 7)
    expect(s.length).toBe(7)
    expect(s[0].d).toBe('2026-09-23')
    expect(s[6].n).toBe(8500)
    expect(stepStreak(S, '2026-09-29')).toBe(3)
    setSteps(S, '2026-09-28', 100)
    expect(stepStreak(S, '2026-09-29')).toBe(1)
  })
  it('goal, percent and stats', () => {
    expect(stepGoalOf({})).toBe(8000)
    expect(stepGoalOf({ stepGoal: 100 })).toBe(500)
    expect(stepPct(12000, 8000)).toBe(100)
    expect(stepStats(10000)).toEqual({ km: 7.2, kcal: 350 })
    expect(stepStats(10000, { heightCm: 180, weightKg: 80 })).toEqual({ km: 7.5, kcal: 400 })
  })
})
