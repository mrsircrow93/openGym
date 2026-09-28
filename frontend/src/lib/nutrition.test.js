import { describe, it, expect } from 'vitest'
import { scaleItem, totalsOf, dayTotals, mealsOn, kcalByDay, guessMealType, macroSplit, cleanItem, avgLogged, pctOf } from './nutrition.js'

const egg = { name: 'egg', portion: '2 large', grams: 100, kcal: 155, protein: 13, carbs: 1.1, fat: 11 }
const rice = { name: 'rice', portion: '1 cup', grams: 200, kcal: 260, protein: 5.4, carbs: 56, fat: 0.6 }

describe('scaleItem', () => {
  it('scales every macro linearly with grams', () => {
    const s = scaleItem(egg, 150)
    expect(s.grams).toBe(150)
    expect(s.kcal).toBe(233)
    expect(s.protein).toBe(19.5)
    expect(s.fat).toBe(16.5)
  })
  it('leaves macros alone when the source has no weight to scale from', () => {
    const s = scaleItem({ ...egg, grams: 0 }, 80)
    expect(s.grams).toBe(80)
    expect(s.kcal).toBe(155)
  })
  it('scales micros too, and tolerates items logged before they existed', () => {
    expect(scaleItem({ ...egg, sugar: 1, fiber: 0.4, sodium: 124 }, 200)).toMatchObject({ sugar: 2, fiber: 0.8, sodium: 248 })
    expect(scaleItem(egg, 200)).toMatchObject({ sugar: 0, fiber: 0, sodium: 0 })
  })
  it('never goes negative', () => {
    expect(scaleItem(egg, -20).grams).toBe(0)
  })
})

describe('totals', () => {
  it('sums items and rounds', () => {
    expect(totalsOf([egg, rice])).toEqual({ kcal: 415, protein: 18.4, carbs: 57.1, fat: 11.6, sugar: 0, fiber: 0, sodium: 0 })
    expect(totalsOf([{ sugar: 4.2, fiber: 1.3, sodium: 120 }, { sugar: 1, fiber: 2, sodium: 380.4 }])).toMatchObject({ sugar: 5.2, fiber: 3.3, sodium: 500 })
  })
  it('handles empty / missing', () => {
    expect(totalsOf([])).toMatchObject({ kcal: 0, protein: 0, fat: 0, sodium: 0 })
    expect(totalsOf(undefined).kcal).toBe(0)
  })
  it('day totals only count that day, ordered by time', () => {
    const S = { meals: [
      { id: 'a', d: '2026-09-28', t: '13:00', items: [rice] },
      { id: 'b', d: '2026-09-28', t: '08:00', items: [egg] },
      { id: 'c', d: '2026-09-27', t: '08:00', items: [egg] }
    ] }
    expect(dayTotals(S, '2026-09-28').kcal).toBe(415)
    expect(mealsOn(S, '2026-09-28').map(m => m.id)).toEqual(['b', 'a'])
    expect(kcalByDay(S)).toEqual({ '2026-09-28': 415, '2026-09-27': 155 })
  })
})

describe('helpers', () => {
  it('guesses the meal slot from the clock', () => {
    expect(guessMealType('07:30')).toBe('breakfast')
    expect(guessMealType('13:10')).toBe('lunch')
    expect(guessMealType('16:00')).toBe('snack')
    expect(guessMealType('20:45')).toBe('dinner')
  })
  it('macro split adds to 100', () => {
    const s = macroSplit(totalsOf([egg, rice]))
    expect(s.protein + s.carbs + s.fat).toBe(100)
    expect(macroSplit({ protein: 0, carbs: 0, fat: 0 })).toEqual({ protein: 0, carbs: 0, fat: 0 })
  })
  it('cleanItem coerces model output defensively', () => {
    const c = cleanItem({ name: '  Pollo ', grams: '120.6', kcal: '198.4', protein: -3, carbs: null })
    expect(c).toEqual({ name: 'Pollo', portion: '', grams: 121, kcal: 198, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, sodium: 0 })
    expect(cleanItem({}).name).toBe('Food')
  })
  it('average ignores days with no log', () => {
    const S = { meals: [{ d: '2026-09-20', items: [egg] }, { d: '2026-09-28', items: [rice] }] }
    expect(avgLogged(S)).toMatchObject({ days: 2, kcal: 208 })
    expect(avgLogged({ meals: [] })).toBeNull()
  })
  it('pct caps at 100', () => { expect(pctOf(300, 200)).toBe(100); expect(pctOf(50, 0)).toBe(0) })
})
