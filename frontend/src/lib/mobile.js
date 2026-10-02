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

// (Re)schedule the workout-day reminder: one repeating notification per weekday that has a
// routine in the weekly plan. Cheap enough to run after any state change — the plan or the
// reminder time may just have been edited. `interactive` gates the OS permission prompt to
// the Settings toggle; a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [0, 1, 2, 3, 4, 5, 6, 100].map(d => ({ id: 100 + d })) }).catch(() => {})
    const r = S.reminder
    const photoAt = photoReminderAt(S)
    if (!r?.on && !photoAt) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const notifications = []
    // Monthly photos: one shot, 28 days after the last check-in at 10:00 (id 200).
    if (photoAt) notifications.push({ id: 200, title: t('Monthly photos'), body: t('Four weeks since your last check-in — take today’s front, side and back photos and see what changed.'), schedule: { at: photoAt, allowWhileIdle: true } })
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
