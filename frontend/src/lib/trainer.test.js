import { describe, it, expect } from 'vitest'
import { trainerCandidates, materializePlan, candidatesText } from './trainer.js'
import { EXDB, EXIDX } from './exercises.js'

const S = { customEx: [{ id: 'cx1', n: 'my press', bp: 'chest', tg: 'pectorals', eq: 'barbell' }], routines: [], workouts: [] }

describe('trainerCandidates', () => {
  it('respects equipment and caps the list, custom first', () => {
    const bw = trainerCandidates(S, 'bodyweight', 100)
    expect(bw[0].id).toBe('cx1')
    expect(bw.length).toBeLessThanOrEqual(100)
    expect(bw.slice(1).every(c => c.eq === 'body weight')).toBe(true)
  })
  it('spreads across muscles rather than filling from one', () => {
    const gym = trainerCandidates(S, 'gym', 200)
    const tgs = new Set(gym.map(c => c.tg))
    expect(tgs.size).toBeGreaterThan(12)
    expect(gym.some(c => c.eq === 'leverage machine')).toBe(true)
    expect(gym.some(c => c.eq === 'barbell')).toBe(true)
  })
  it('serialises compactly', () => {
    expect(candidatesText([{ id: '0001', n: 'x', tg: 'abs', eq: 'body weight' }])).toBe('0001|x|abs|body weight')
  })
})

describe('materializePlan', () => {
  const cands = trainerCandidates(S, 'gym')
  const some = cands.find(c => c.id !== 'cx1' && EXIDX[c.id] && EXIDX[c.id].bp !== 'cardio')
  const cardio = EXDB.find(e => e.bp === 'cardio')
  it('keeps only known ids, applies sets/reps/rest, assigns days once', () => {
    const plan = { progression: 'double', routines: [
      { name: 'Upper', glyph: 'arm', days: [1, 4], exercises: [{ id: some.id, sets: 4, reps: 8, rest: 120 }, { id: 'nope', sets: 3, reps: 10 }] },
      { name: 'Lower', glyph: 'bogus', days: [4, 9], exercises: [{ id: 'cx1', sets: 12, reps: 0 }] },
      { name: 'Empty', days: [2], exercises: [{ id: 'zzz' }] }
    ] }
    const { routines, week, dropped } = materializePlan(plan, cands)
    expect(dropped).toBe(2)
    expect(routines.length).toBe(2)
    expect(routines[0].ex[0]).toMatchObject({ id: some.id, sets: 4, reps: 8, rest: 120 })
    expect(routines[0].prog).toBe('double')
    expect(routines[1].emoji).toBe('figureStrength')
    expect(routines[1].ex[0].sets).toBe(8)      // clamped
    expect(routines[1].ex[0].reps).toBe(1)      // clamped up from 0
    expect(week[1]).toBe(routines[0].id)
    expect(week[4]).toBe(routines[0].id)        // first routine keeps Thursday
    expect(week[9]).toBeUndefined()
  })
  it('cardio entries take minutes', () => {
    const all = [...cands, { id: cardio.id, n: cardio.n, tg: cardio.tg, eq: cardio.eq }]
    const { routines } = materializePlan({ routines: [{ name: 'C', days: [], exercises: [{ id: cardio.id, minutes: 25 }] }] }, all)
    expect(routines[0].ex[0]).toMatchObject({ sets: 1, min: 25 })
  })
  it('tolerates garbage', () => {
    expect(materializePlan(null, cands)).toEqual({ routines: [], week: {}, dropped: 0 })
  })
})
