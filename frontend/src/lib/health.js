// Apple Health / Health Connect (store builds only). Reads steps and body weight into the same
// rows the app already uses: steps rows get src 'health' (and win over manual entries for that
// day), weight entries get src 'health' and never overwrite one the person typed. Everything is
// behind MOBILE so the plugin never lands in a web bundle.
import { MOBILE } from './mobile.js'
import { setSteps } from './steps.js'
import { isoOf } from './format.js'

const PERMS = ['READ_STEPS', 'READ_WEIGHT']
const iso = d => new Date(d).toISOString()

export const healthSupported = () => MOBILE
export const IS_IOS_SHELL = MOBILE && /iPhone|iPad/.test(navigator.userAgent)

export async function healthAvailable() {
  if (!MOBILE) return false
  try { const { Health } = await import('capacitor-health'); return !!(await Health.isHealthAvailable()).available } catch { return false }
}
// Android without Health Connect installed: send them to the store listing.
export async function installHealthConnect() {
  const { Health } = await import('capacitor-health'); return Health.showHealthConnectInPlayStore()
}
export async function requestHealth() {
  const { Health } = await import('capacitor-health')
  await Health.requestHealthPermissions({ permissions: PERMS })
  return true
}

// Pull the last 30 days of steps and 90 days of weight. Returns what changed so the caller can
// toast. `update` is the store's producer-style updater.
export async function syncHealth(update) {
  if (!MOBILE) return null
  const { Health } = await import('capacitor-health')
  const now = new Date()
  const from30 = new Date(now); from30.setDate(now.getDate() - 30); from30.setHours(0, 0, 0, 0)
  const from90 = new Date(now); from90.setDate(now.getDate() - 90); from90.setHours(0, 0, 0, 0)
  let days = 0, weights = 0
  let agg = [], recs = []
  try { agg = (await Health.queryAggregated({ startDate: iso(from30), endDate: iso(now), dataType: 'steps', bucket: 'day' })).aggregatedData || [] } catch { /* permission not granted for steps */ }
  try { recs = (await Health.queryRecords({ startDate: iso(from90), endDate: iso(now), dataType: 'weight' })).records || [] } catch { /* permission not granted for weight */ }
  update(S => {
    for (const a of agg) {
      const d = isoOf(new Date(a.startDate)); const n = Math.round(+a.value || 0)
      if (n > 0) { setSteps(S, d, n, 'health'); days++ }
    }
    S.bodyweight = S.bodyweight || []
    const byDay = {}
    for (const r of recs) { const d = isoOf(new Date(r.startDate)); byDay[d] = r }   // last reading of the day wins
    for (const [d, r] of Object.entries(byDay)) {
      const w = Math.round((+r.value || 0) * 10) / 10
      if (!(w > 20 && w < 400)) continue
      const kg = S.unit === 'lb' ? Math.round(w * 2.20462 * 10) / 10 : w
      const ex = S.bodyweight.find(b => b.d === d)
      if (ex && ex.src !== 'health') continue        // typed by hand: theirs
      if (ex) { if (ex.w !== kg) { ex.w = kg; weights++ } }
      else { S.bodyweight.push({ d, w: kg, t: Date.parse(r.startDate) || Date.now(), src: 'health' }); weights++ }
    }
    S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    S.health = { ...(S.health || {}), on: true, at: Date.now() }
  })
  return { days, weights }
}
