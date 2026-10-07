import { describe, it, expect } from 'vitest'
import { dosesOn, supplementStreak, supplementReminders, isoOf, onDay } from './supplements.js'

const day = (y, m, d, h = 8, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0)
const sup = (id, times, days = null) => ({ id, name: id, dose: 5, unit: 'g', times, days })
const S = { supplements: [sup('crea', ['09:00']), sup('prot', ['17:00', '22:00'])], supTaken: [] }

describe('supplements', () => {
  it('lists every dose due on a day, in clock order', () => {
    const d = dosesOn(S, day(2026, 10, 6))
    expect(d.map(x => x.sup.id + '@' + x.time)).toEqual(['crea@09:00', 'prot@17:00', 'prot@22:00'])
    expect(d.every(x => !x.taken)).toBe(true)
  })
  it('marks what was already taken, per supplement and time', () => {
    const t = { ...S, supTaken: [{ d: '2026-10-06', sid: 'prot', time: '17:00' }] }
    const d = dosesOn(t, day(2026, 10, 6))
    expect(d.filter(x => x.taken).map(x => x.sup.id + '@' + x.time)).toEqual(['prot@17:00'])
  })
  it('respects weekday restrictions', () => {
    const only = { supplements: [sup('x', ['09:00'], [1, 3, 5])] }   // Mon, Wed, Fri
    expect(onDay(only.supplements[0], day(2026, 10, 6))).toBe(false)  // Tuesday
    expect(dosesOn(only, day(2026, 10, 7))).toHaveLength(1)           // Wednesday
  })
  it('counts a streak of days where every dose was ticked, and today in progress does not break it', () => {
    const takenFor = iso => [{ d: iso, sid: 'crea', time: '09:00' }, { d: iso, sid: 'prot', time: '17:00' }, { d: iso, sid: 'prot', time: '22:00' }]
    const today = day(2026, 10, 6)
    const yest = new Date(today); yest.setDate(5)
    const before = new Date(today); before.setDate(4)
    const st = { ...S, supTaken: [...takenFor(isoOf(yest)), ...takenFor(isoOf(before))] }
    expect(supplementStreak(st, today)).toBe(2)
    expect(supplementStreak({ ...st, supTaken: [...st.supTaken, ...takenFor(isoOf(today))] }, today)).toBe(3)
    expect(supplementStreak({ supplements: [] }, today)).toBe(0)
  })
  it('a missed day ends the streak', () => {
    const today = day(2026, 10, 6)
    const yest = new Date(today); yest.setDate(5)
    const st = { ...S, supTaken: [{ d: isoOf(yest), sid: 'crea', time: '09:00' }] }   // prot missing
    expect(supplementStreak(st, today)).toBe(0)
  })
  it('plans only future, untaken doses and gives each a unique stable id', () => {
    const now = day(2026, 10, 6, 10)     // 09:00 already gone
    const r = supplementReminders(S, now)
    expect(r.filter(x => isoOf(x.at) === '2026-10-06').map(x => x.time)).toEqual(['17:00', '22:00'])
    expect(new Set(r.map(x => x.id)).size).toBe(r.length)
    expect(Math.min(...r.map(x => x.id))).toBeGreaterThanOrEqual(400)
    expect(Math.max(...r.map(x => x.id))).toBeLessThan(490)
    const taken = { ...S, supTaken: [{ d: '2026-10-06', sid: 'prot', time: '17:00' }] }
    expect(supplementReminders(taken, now).filter(x => isoOf(x.at) === '2026-10-06').map(x => x.time)).toEqual(['22:00'])
  })
  it('ignores malformed entries instead of crashing', () => {
    expect(dosesOn({ supplements: [null, { name: 'no id' }, { id: 'x' }] }, day(2026, 10, 6))).toEqual([])
    expect(supplementReminders({}, day(2026, 10, 6))).toEqual([])
  })
})
