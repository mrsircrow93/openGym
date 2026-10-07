// Supplements the person takes (creatine, protein, vitamins…): what they scheduled, what they
// already took today, and when to remind them. Pure helpers, no store and no plugins, so the
// scheduler, the UI and the tests all read the same rules.
//
// Shape: S.supplements = [{ id, name, dose, unit, times: ['08:00'], days: [0..6]|null, withFood }]
//        S.supTaken     = [{ d: 'YYYY-MM-DD', sid, time }]   one row per dose actually taken
//
// The app never recommends a substance or a dose: it only reminds you of what you entered.
export const UNITS = ['g', 'mg', 'ml', 'cap', 'scoop', 'IU']

// Common starting points, so adding one is a tap instead of a form. Doses are the amounts the
// person most often enters themselves, not advice — they stay fully editable.
export const PRESETS = [
  { name: 'Creatine', dose: 5, unit: 'g', times: ['09:00'] },
  { name: 'Protein', dose: 30, unit: 'g', times: ['17:00'], withFood: false },
  { name: 'Vitamin D', dose: 1000, unit: 'IU', times: ['09:00'], withFood: true },
  { name: 'Omega 3', dose: 1, unit: 'cap', times: ['14:00'], withFood: true },
  { name: 'Magnesium', dose: 300, unit: 'mg', times: ['22:00'] },
  { name: 'Multivitamin', dose: 1, unit: 'cap', times: ['09:00'], withFood: true },
  { name: 'Caffeine', dose: 200, unit: 'mg', times: ['16:00'] }
]

export const isoOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const list = S => (S.supplements || []).filter(s => s && s.id && s.name)
export const onDay = (sup, date) => !sup.days || !sup.days.length || sup.days.includes(date.getDay())

// Every dose due on `date`, in clock order: one entry per supplement × scheduled time.
export function dosesOn(S, date = new Date()) {
  const iso = isoOf(date)
  const taken = new Set((S.supTaken || []).filter(t => t.d === iso).map(t => t.sid + '|' + t.time))
  const out = []
  for (const sup of list(S)) {
    if (!onDay(sup, date)) continue
    for (const time of (sup.times || []).slice(0, 3)) out.push({ sup, time, taken: taken.has(sup.id + '|' + time) })
  }
  return out.sort((a, b) => a.time.localeCompare(b.time))
}
export const takenCount = (S, date = new Date()) => dosesOn(S, date).filter(d => d.taken).length

// A day counts as kept when every scheduled dose was ticked; days with nothing scheduled are
// skipped rather than breaking the run.
export function supplementStreak(S, today = new Date()) {
  if (!list(S).length) return 0
  let streak = 0
  for (let i = 0; i < 400; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i)
    const doses = dosesOn(S, d)
    if (!doses.length) continue
    const all = doses.every(x => x.taken)
    if (!all) { if (i === 0) continue; break }   // today still in progress doesn't break it
    streak++
  }
  return streak
}

// Doses still to come, for the next `days` days, skipping what is already taken or already past.
// Ids are deterministic so the scheduler can cancel and re-plan the same slots.
export function supplementReminders(S, now = new Date(), days = 3) {
  const sups = list(S).slice(0, 10)
  const out = []
  for (let day = 0; day < days; day++) {
    const d = new Date(now); d.setDate(now.getDate() + day)
    const iso = isoOf(d)
    const taken = new Set((S.supTaken || []).filter(t => t.d === iso).map(t => t.sid + '|' + t.time))
    sups.forEach((sup, si) => {
      if (!onDay(sup, d)) return
      ;(sup.times || []).slice(0, 3).forEach((time, ti) => {
        const [h, m] = time.split(':').map(Number)
        const at = new Date(d); at.setHours(h, m || 0, 0, 0)
        if (at <= now) return
        if (taken.has(sup.id + '|' + time)) return
        out.push({ id: 400 + si * 9 + ti * 3 + day, at, sup, time })
      })
    })
  }
  return out
}
export const SUPPLEMENT_IDS = Array.from({ length: 90 }, (_, i) => 400 + i)
