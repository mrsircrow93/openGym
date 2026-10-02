import { describe, it, expect } from 'vitest'
import { convertProfile, roundPlate, plateStep } from './units.js'

describe('units', () => {
  it('converts every stored weight kg → lb and back', () => {
    const S = { unit: 'kg', targetW: 80, bodyweight: [{ d: '2026-01-01', w: 90 }], exWeights: { a: { w: 100 } },
      routines: [{ ex: [{ id: 'a', weight: 60 }] }],
      workouts: [{ bw: 90, vol: 1000, entries: [{ id: 'a', topW: 100, target: { weight: 100 }, sets: [{ w: 100, r: 5, done: true }] }] }],
      active: { bw: 90, entries: [{ target: { weight: 50 }, sets: [{ w: 50 }] }] }, trainer: { answers: { weight: 90, targetW: 80 } } }
    convertProfile(S, 'kg', 'lb')
    expect(S.unit).toBe('lb')
    expect(S.bodyweight[0].w).toBeCloseTo(198.4, 1)
    expect(S.workouts[0].entries[0].sets[0].w).toBeCloseTo(220.5, 1)
    expect(S.routines[0].ex[0].weight).toBeCloseTo(132.3, 1)
    expect(S.workouts[0].vol).toBe(2205)
    convertProfile(S, 'lb', 'kg')
    expect(S.bodyweight[0].w).toBeCloseTo(90, 0)
    expect(S.workouts[0].entries[0].sets[0].w).toBeCloseTo(100, 0)
  })
  it('rounds to plates per unit', () => {
    expect(plateStep('kg')).toBe(2.5); expect(plateStep('lb')).toBe(5)
    expect(roundPlate(46, 'kg')).toBe(45); expect(roundPlate(47, 'lb')).toBe(45); expect(roundPlate(48, 'lb')).toBe(50)
  })
})
