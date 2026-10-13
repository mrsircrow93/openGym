import { describe, it, expect } from 'vitest'
import { toDisplay, fromDisplay, loadUnit, bodyUnit, toCanonicalKg, WEIGHT_SCHEMA, KG_PER_LB } from './units.js'

const fmt1 = v => Math.round(v * 10) / 10

describe('display conversion', () => {
  it('kilograms pass through untouched', () => {
    expect(toDisplay(82.5, 'kg')).toBe(82.5)
    expect(fromDisplay(82.5, 'kg')).toBe(82.5)
  })

  // The bug this whole change exists for: 20 lb used to become 9.1 kg and come back as 20.1,
  // and the drift was written into the history every time the unit was switched.
  it('survives the round trip at every weight a gym actually has', () => {
    const plates = [2.5, 5, 10, 20, 22.5, 25, 32.5, 35, 40, 45, 52.5, 60, 70, 80, 90, 100, 110, 135, 185, 225, 275, 315, 405]
    for (const lb of plates) expect(fmt1(toDisplay(fromDisplay(lb, 'lb'), 'lb'))).toBe(lb)
  })

  it('leaves null and empty alone rather than turning them into zero', () => {
    for (const v of [null, undefined, '']) {
      expect(toDisplay(v, 'lb')).toBe(v)
      expect(fromDisplay(v, 'lb')).toBe(v)
    }
  })
})

describe('which unit applies', () => {
  const S = { unit: 'lb', bwUnit: 'kg', exUnits: { 'leg-press': 'kg' } }
  it('an exercise override wins over the profile default', () => expect(loadUnit(S, 'leg-press')).toBe('kg'))
  it('without an override the profile default applies', () => expect(loadUnit(S, 'bench')).toBe('lb'))
  it('body weight reads in its own unit, so you can lift in pounds and weigh in kilos', () => expect(bodyUnit(S)).toBe('kg'))
  it('falls back to kilograms for a profile that has nothing set', () => {
    expect(loadUnit({}, 'bench')).toBe('kg')
    expect(bodyUnit({})).toBe('kg')
  })
})

describe('migration to canonical kilograms', () => {
  const pounds = () => ({
    unit: 'lb',
    targetW: 180,
    bodyweight: [{ d: '2026-01-01', w: 200 }],
    checkins: [{ id: 'c1', d: '2026-01-01', w: 200 }],
    exWeights: { bench: { w: 135, d: '2026-01-01' } },
    routines: [{ id: 'r', ex: [{ id: 'bench', weight: 135, inc: 5 }] }],
    workouts: [{ id: 'w', bw: 200, vol: 4000, entries: [{ id: 'bench', topW: 135, target: { weight: 135 }, sets: [{ w: 135, r: 5 }, { w: 95, r: 8 }] }] }],
    trainer: { answers: { weight: 200, targetW: 180 } }
  })

  it('converts every weight-bearing field exactly once', () => {
    const S = toCanonicalKg(pounds())
    expect(S.bodyweight[0].w).toBeCloseTo(200 * KG_PER_LB, 2)
    expect(S.targetW).toBeCloseTo(180 * KG_PER_LB, 2)
    expect(S.checkins[0].w).toBeCloseTo(200 * KG_PER_LB, 2)
    expect(S.exWeights.bench.w).toBeCloseTo(135 * KG_PER_LB, 2)
    expect(S.routines[0].ex[0].weight).toBeCloseTo(135 * KG_PER_LB, 2)
    expect(S.workouts[0].bw).toBeCloseTo(200 * KG_PER_LB, 2)
    expect(S.workouts[0].vol).toBe(Math.round(4000 * KG_PER_LB))
    expect(S.workouts[0].entries[0].topW).toBeCloseTo(135 * KG_PER_LB, 2)
    expect(S.workouts[0].entries[0].target.weight).toBeCloseTo(135 * KG_PER_LB, 2)
    expect(S.workouts[0].entries[0].sets.map(s => s.w)).toEqual([135, 95].map(v => Math.round(v * KG_PER_LB * 1000) / 1000))
    expect(S.trainer.answers.weight).toBeCloseTo(200 * KG_PER_LB, 2)
  })

  // A progression step is a statement about the gym ("add five pounds"), not a stored weight.
  it('leaves the progression increment in the unit it was written in', () => {
    expect(toCanonicalKg(pounds()).routines[0].ex[0].inc).toBe(5)
  })

  it('runs once and no more, however many times it is called', () => {
    const once = toCanonicalKg(pounds())
    const twice = toCanonicalKg(JSON.parse(JSON.stringify(once)))
    expect(twice).toEqual(once)
    expect(twice.wSchema).toBe(WEIGHT_SCHEMA)
  })

  it('touches nothing in a profile already kept in kilograms', () => {
    const S = toCanonicalKg({ unit: 'kg', bodyweight: [{ d: '2026-01-01', w: 82.5 }] })
    expect(S.bodyweight[0].w).toBe(82.5)
    expect(S.bwUnit).toBe('kg')
  })

  // Nobody's screen should change on the day they update: a pounds profile keeps reading pounds.
  it('keeps the old unit as the display default for loads and for body weight', () => {
    const S = toCanonicalKg(pounds())
    expect(S.unit).toBe('lb')
    expect(S.bwUnit).toBe('lb')
    expect(S.exUnits).toEqual({})
  })
})
