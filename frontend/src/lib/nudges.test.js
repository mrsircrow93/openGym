// Nutrition nudges are planned, not evaluated when they fire: the schedule has to skip what is
// already done today, what is in the past, and anything inside quiet hours.
import { describe, it, expect } from 'vitest'
import { nutritionNudges, nudgesOf, NUDGE_DEF } from './mobile.js'

const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const at = (h, m = 0) => { const d = new Date(2026, 9, 6, h, m, 0, 0); return d }
const meal = (type, protein = 0) => ({ d: iso(at(8)), type, items: [{ name: 'x', kcal: 300, protein, carbs: 0, fat: 0 }] })
const base = { macroGoal: { kcal: 2000, protein: 140, carbs: 220, fat: 65 }, waterGoal: 2000 }
const ids = list => list.map(n => n.id).sort((a, b) => a - b)

describe('nutritionNudges', () => {
  it('defaults: meals and protein on, water off', () => {
    expect(nudgesOf({})).toEqual(NUDGE_DEF)
    const n = nutritionNudges({ ...base }, at(7))
    const kinds = new Set(n.map(x => x.id % 5 === 0 ? 'day' : 'x'))
    expect(kinds.size).toBeGreaterThan(0)
    // 3 meal slots + protein, over 3 days, nothing for water
    expect(n).toHaveLength(12)
    expect(n.every(x => x.schedule.at > at(7))).toBe(true)
  })
  it('skips slots already past today but keeps the next days', () => {
    const n = nutritionNudges({ ...base }, at(15))
    const today = n.filter(x => iso(x.schedule.at) === iso(at(15)))
    expect(today.map(x => x.title)).toEqual(['Dinner', 'Protein'])   // breakfast 09:30 and lunch 14:30 are gone
  })
  it('skips a meal slot that is already logged', () => {
    const n = nutritionNudges({ ...base, meals: [meal('breakfast')] }, at(7))
    const today = n.filter(x => iso(x.schedule.at) === iso(at(7))).map(x => x.title)
    expect(today).not.toContain('Breakfast')
    expect(today).toContain('Lunch')
  })
  it('drops the protein check once the target is met, and counts what is missing otherwise', () => {
    const met = nutritionNudges({ ...base, meals: [meal('breakfast', 150)] }, at(7))
    expect(met.filter(x => iso(x.schedule.at) === iso(at(7))).map(x => x.title)).not.toContain('Protein')
    const short = nutritionNudges({ ...base, meals: [meal('breakfast', 40)] }, at(7))
    const p = short.find(x => x.title === 'Protein' && iso(x.schedule.at) === iso(at(7)))
    expect(p.body).toContain('100')
  })
  it('water only when switched on, and not once the goal is reached', () => {
    const on = { ...base, nudges: { water: true } }
    expect(nutritionNudges(on, at(7)).some(x => x.title === 'Water')).toBe(true)
    const done = nutritionNudges({ ...on, water: [{ d: iso(at(7)), ml: 2500 }] }, at(7))
    expect(done.filter(x => iso(x.schedule.at) === iso(at(7))).map(x => x.title)).not.toContain('Water')
  })
  it('quiet hours silence anything inside the window, including one that wraps midnight', () => {
    expect(nutritionNudges({ ...base, nudges: { quietFrom: '00:00', quietTo: '23:59' } }, at(1))).toHaveLength(0)
    const n = nutritionNudges({ ...base, nudges: { quietFrom: '20:00', quietTo: '07:00' } }, at(7))
    expect(n.map(x => x.title)).not.toContain('Dinner')   // 20:30 falls inside
    expect(n.map(x => x.title)).toContain('Lunch')
  })
  it('switching everything off schedules nothing, and ids never collide', () => {
    expect(nutritionNudges({ ...base, nudges: { meals: false, water: false, protein: false } }, at(7))).toHaveLength(0)
    const all = nutritionNudges({ ...base, nudges: { water: true } }, at(1))
    expect(new Set(ids(all)).size).toBe(all.length)
    expect(Math.min(...ids(all))).toBeGreaterThanOrEqual(300)
    expect(Math.max(...ids(all))).toBeLessThan(325)
  })
})
