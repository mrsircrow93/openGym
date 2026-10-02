import { describe, it, expect } from 'vitest'
import { materializeImport, matchImported } from './import-routine.js'
import { EXIDX } from './exercises.js'
import { sniff } from './upload.js'

const S = { customEx: [], routines: [] }
const parsed = {
  found: true, title: 'Upper / Lower', summary: '', confidence: 'high',
  routines: [
    { name: 'Día 1 — Pecho', glyph: 'barbell', days: [1], exercises: [
      { name: 'Press de banca', name_en: 'barbell bench press', muscle: 'chest', sets: 4, reps: 8, rest: 120, weight: '60 kg' },
      { name: 'Máquina rara del gym', name_en: 'mystery machine press', muscle: 'chest', sets: 3, reps: 12 },
      { name: 'Plancha', name_en: 'plank', muscle: 'abs', sets: 3, seconds: 45 },
      { name: 'Bici', name_en: 'stationary bike', muscle: 'cardio', minutes: 15 },
    ] },
    { name: 'Día 2 — Pierna', glyph: 'legs', days: [1, 4], exercises: [
      { name: 'Sentadilla', name_en: 'barbell squat', muscle: 'quads', sets: 5, reps: 5 },
    ] },
  ]
}

describe('matchImported', () => {
  it('finds library ids from the canonical English name', () => {
    expect(matchImported({ name: 'Press de banca', name_en: 'barbell bench press' })).toBe('0025')
    expect(matchImported({ name: 'Sentadilla', name_en: 'squat' })).toBe('0043')
  })
  it('knows the everyday names the model is asked for', () => {
    expect(matchImported({ name_en: 'dumbbell incline press' })).toBe('0314')
    expect(matchImported({ name_en: 'cable fly' })).toBe('0227')
    expect(matchImported({ name_en: 'parallel bar dips' })).toBe('0251')
    expect(matchImported({ name_en: 'single-arm dumbbell row' })).toBe('0292')
    expect(matchImported({ name_en: 'Lat Pulldown' })).toBe('2330')
    expect(matchImported({ name_en: 'barbell overhead press' })).toBe('0091')
    expect(matchImported({ name_en: 'Push-ups' })).toBe('0662')
  })
  it('returns null rather than guessing', () => {
    expect(matchImported({ name: 'xyz', name_en: 'mystery machine press' })).toBe(null)
  })
})

describe('materializeImport', () => {
  const m = materializeImport(parsed, S)
  it('keeps every exercise: matched ones by id, unknown ones as custom', () => {
    expect(m.routines.length).toBe(2)
    expect(m.routines[0].ex.length).toBe(4)
    expect(m.routines[0].ex[0].id).toBe('0025')
    expect(m.routines[0].ex[0].sets).toBe(4)
    expect(m.routines[0].ex[0].reps).toBe(8)
    expect(m.routines[0].ex[0].rest).toBe(120)
    expect(m.routines[0].ex[0].note).toContain('60 kg')
    expect(m.created).toBe(1)
    expect(m.custom[0].n).toBe('Máquina rara del gym')
    expect(m.custom[0].bp).toBe('chest')
    expect(m.routines[0].ex[1].id).toBe(m.custom[0].id)
    expect(EXIDX[m.routines[0].ex[0].id]).toBeTruthy()
  })
  it('handles timed holds and cardio', () => {
    expect(m.routines[0].ex[2].mode).toBe('time')
    expect(m.routines[0].ex[2].sec).toBe(45)
    expect(m.routines[0].ex[3].mode).toBe('cardio')
    expect(m.routines[0].ex[3].min).toBe(15)
  })
  it('assigns weekdays once each', () => {
    expect(m.week[1]).toBe(m.routines[0].id)
    expect(m.week[4]).toBe(m.routines[1].id)
  })
  it('lays out a sensible week when the sheet names no days', () => {
    const noDays = { ...parsed, routines: parsed.routines.map(r => ({ ...r, days: [] })) }
    const w = materializeImport(noDays, S).week
    expect(Object.keys(w).sort()).toEqual(['1', '2', '4', '5'])   // two routines -> 4 days, alternating
    const one = { ...noDays, routines: noDays.routines.slice(0, 1) }
    expect(Object.keys(materializeImport(one, S).week).sort()).toEqual(['1', '3', '5'])   // full body -> Mon/Wed/Fri
    const twice = { ...one, daysPerWeek: 2 }
    expect(Object.keys(materializeImport(twice, S).week).sort()).toEqual(['1', '3'])
  })
  it('ignores junk', () => {
    expect(materializeImport({ routines: [{ name: 'x', exercises: [{ name: '' }] }] }, S).routines.length).toBe(0)
    expect(materializeImport(null, S).routines.length).toBe(0)
  })
})

describe('sniff', () => {
  const bytes = (...xs) => Uint8Array.from([...xs, ...new Array(16).fill(0)])
  it('recognises real signatures only', () => {
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png')
    expect(sniff(Uint8Array.from([...[...'%PDF-1.7\n%'].map(c => c.charCodeAt(0)), ...new Array(8).fill(0)]))).toBe('pdf')
    expect(sniff(Uint8Array.from([0, 0, 0, 0x18, ...'ftypheic'.split('').map(c => c.charCodeAt(0)), 0, 0, 0, 0]))).toBe('heic')
    expect(sniff(Uint8Array.from('<script>alert(1)</script>'.split('').map(c => c.charCodeAt(0))))).toBe(null)
    expect(sniff(bytes(0x4d, 0x5a))).toBe(null) // MZ executable
  })
})
