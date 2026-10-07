// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per
// planned weekday — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t } from './i18n.js'
import { macroGoalOf, totalsOf } from './nutrition.js'
import { supplementReminders, SUPPLEMENT_IDS } from './supplements.js'

export const MOBILE = import.meta.env.VITE_MOBILE === '1'
// Where the store app talks to. Baked in at build time (package.json build:mobile).
export const API_BASE = (MOBILE && import.meta.env.VITE_API_BASE) ? String(import.meta.env.VITE_API_BASE).replace(/\/$/, '') : ''

// Session token for the store app (the browser version uses a cookie). Kept in the app's own
// sandboxed storage; loaded once at boot into memory so api() can attach it synchronously.
let token = null
const TOKEN_KEY = 'vx_session'
export const getToken = () => token
export async function loadToken() {
  if (!MOBILE) return null
  try { const { Preferences } = await import('@capacitor/preferences'); token = (await Preferences.get({ key: TOKEN_KEY })).value || null } catch { token = null }
  return token
}
export async function setToken(t) {
  token = t || null
  if (!MOBILE) return
  try { const { Preferences } = await import('@capacitor/preferences'); if (t) await Preferences.set({ key: TOKEN_KEY, value: t }); else await Preferences.remove({ key: TOKEN_KEY }) } catch { /* memory copy still works this session */ }
}

const FILE = 'opengym-state.json'

export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
  } catch (e) { /* keep the localStorage copy */ }
}

/* ---------------- nutrition nudges (docs/BACKLOG.md v2 #3) ---------------- */
// Gentle, opt-outable reminders around eating: one per meal slot you have not logged, water and
// an evening protein check. Local notifications cannot evaluate a condition when they fire, so
// we re-plan them on every state change: today's slots are skipped when already satisfied or
// already past, and the next two days are scheduled generically.
export const NUDGE_DEF = { meals: true, water: false, protein: true, supplements: true, quietFrom: '22:00', quietTo: '07:00' }
export const nudgesOf = S => ({ ...NUDGE_DEF, ...(S.nudges || {}) })
const SLOTS = [
  { key: 'breakfast', kind: 'meals', at: '09:30' },
  { key: 'lunch', kind: 'meals', at: '14:30' },
  { key: 'dinner', kind: 'meals', at: '20:30' },
  { key: 'water', kind: 'water', at: '16:00' },
  { key: 'protein', kind: 'protein', at: '19:30' }
]
const hhmm = v => { const [h, m] = String(v || '0:0').split(':').map(Number); return h * 60 + (m || 0) }
// Quiet hours wrap past midnight (22:00 → 07:00), so "inside" is two ranges when from > to.
const inQuiet = (mins, from, to) => (hhmm(from) <= hhmm(to) ? mins >= hhmm(from) && mins < hhmm(to) : mins >= hhmm(from) || mins < hhmm(to))
const isoOfDate = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

export function nutritionNudges(S, now = new Date()) {
  const n = nudgesOf(S)
  if (!n.meals && !n.water && !n.protein) return []
  const goal = macroGoalOf(S)
  const out = []
  for (let day = 0; day < 3; day++) {
    const d = new Date(now); d.setDate(now.getDate() + day)
    const iso = isoOfDate(d)
    const meals = (S.meals || []).filter(m => m.d === iso)
    const totals = meals.reduce((a, m) => { const x = totalsOf(m.items); return { kcal: a.kcal + x.kcal, protein: a.protein + x.protein } }, { kcal: 0, protein: 0 })
    const waterMl = ((S.water || []).find(w => w.d === iso) || {}).ml || 0
    const waterGoal = S.waterGoal || 2000
    for (let i = 0; i < SLOTS.length; i++) {
      const slot = SLOTS[i]
      if (!n[slot.kind]) continue
      const mins = hhmm(slot.at)
      if (inQuiet(mins, n.quietFrom, n.quietTo)) continue
      const at = new Date(d); at.setHours(Math.floor(mins / 60), mins % 60, 0, 0)
      if (at <= now) continue
      const today = day === 0
      let title, body
      if (slot.kind === 'meals') {
        if (today && meals.some(m => m.type === slot.key)) continue
        title = slot.key === 'breakfast' ? t('Breakfast') : slot.key === 'lunch' ? t('Lunch') : t('Dinner')
        body = slot.key === 'breakfast' ? t('Log your breakfast — a photo is enough.')
          : slot.key === 'lunch' ? t('Log your lunch and keep today’s numbers honest.')
            : t('Close the day: log your dinner.')
      } else if (slot.kind === 'water') {
        if (today && waterMl >= waterGoal) continue
        title = t('Water')
        body = today && waterMl ? t('{0} of {1} so far today.', (waterMl / 1000) + ' L', (waterGoal / 1000) + ' L') : t('Keep your water going today.')
      } else {
        if (today && totals.protein >= goal.protein) continue
        const left = Math.max(0, Math.round(goal.protein - totals.protein))
        title = t('Protein')
        body = today && meals.length ? t('{0} g of protein to go today.', left) : t('Check your protein before the day closes.')
      }
      out.push({ id: 300 + i * 5 + day, title, body, schedule: { at, allowWhileIdle: true } })
    }
  }
  return out
}

// Supplement reminders use the times the person set, so quiet hours are the only filter: if you
// asked for 22:30 creatine, that is your call, but the default window still protects the night.
export function supplementNudges(S, now = new Date()) {
  const n = nudgesOf(S)
  if (!n.supplements) return []
  return supplementReminders(S, now).filter(r => !inQuiet(r.at.getHours() * 60 + r.at.getMinutes(), n.quietFrom, n.quietTo))
    .map(r => ({
      id: r.id,
      title: r.sup.name,
      body: (r.sup.dose ? t('Time for {0} {1} of {2}.', r.sup.dose, r.sup.unit, r.sup.name) : t('Time for your {0}.', r.sup.name)) + (r.sup.withFood ? ' ' + t('Take it with food.') : ''),
      schedule: { at: r.at, allowWhileIdle: true }
    }))
}

// (Re)schedule the workout-day reminder: one repeating notification per weekday that has a
// routine in the weekly plan. Cheap enough to run after any state change — the plan or the
// reminder time may just have been edited. `interactive` gates the OS permission prompt to
// the Settings toggle; a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const nudgeIds = []
    for (let i = 0; i < 25; i++) nudgeIds.push({ id: 300 + i })
    for (const id of SUPPLEMENT_IDS) nudgeIds.push({ id })
    await LocalNotifications.cancel({ notifications: [...[0, 1, 2, 3, 4, 5, 6, 100].map(d => ({ id: 100 + d })), ...nudgeIds] }).catch(() => {})
    const r = S.reminder
    const photoAt = photoReminderAt(S)
    const nudges = [...nutritionNudges(S), ...supplementNudges(S)]
    if (!r?.on && !photoAt && !nudges.length) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const notifications = []
    // Monthly photos: one shot, 28 days after the last check-in at 10:00 (id 200).
    if (photoAt) notifications.push({ id: 200, title: t('Monthly photos'), body: t('Four weeks since your last check-in — take today’s front, side and back photos and see what changed.'), schedule: { at: photoAt, allowWhileIdle: true } })
    notifications.push(...nudges)
    if (!r?.on) { if (notifications.length) await LocalNotifications.schedule({ notifications }); return true }
    const [hour, minute] = (r.time || '08:00').split(':').map(Number)
    notifications.push(...Object.entries(S.week || {})
      .filter(([, rid]) => rid && (S.routines || []).some(x => x.id === rid))
      .map(([day, rid]) => ({
        id: 100 + Number(day),
        title: t('Workout day'),
        body: t('{0} is on the plan today — let’s go!', S.routines.find(x => x.id === rid).name),
        // Capacitor weekdays are 1 (Sunday) … 7 (Saturday); S.week uses getDay() 0…6.
        schedule: { on: { weekday: Number(day) + 1, hour, minute }, allowWhileIdle: true },
      })))
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}
// When the next "monthly photos" nudge should fire, or null (switched off, or no check-in yet
// — the first set is invited from the Home card, not by a notification). Mirrors the server
// rule for web push (api/server.js photo nudge).
export function photoReminderAt(S) {
  if (S.photoReminder === false) return null
  const list = (S.checkins || []).map(c => c.d).sort()
  if (!list.length) return null
  const d = new Date(list[list.length - 1] + 'T10:00:00')
  d.setDate(d.getDate() + 28)
  if (d.getTime() < Date.now()) { const t2 = new Date(); t2.setDate(t2.getDate() + 1); t2.setHours(10, 0, 0, 0); return t2 }
  return d
}

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
}
