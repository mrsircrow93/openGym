// Android's hardware / gesture Back.
//
// Capacitor's default when nothing listens is to walk the WebView's history and, at the first
// entry, finish the activity — i.e. quit the app. In a single-page app with global modals that is
// wrong twice over: Back from inside a sheet changed the route underneath while the sheet stayed
// up, and Back on Home closed the app outright. A tester got stuck on the finish-workout summary
// with no way off it, which is what prompted this.
//
// The order here is what Android users expect: close the top sheet, else go back a screen, else
// drop to Home, else minimise. The app is never quit from under them.
import { useUI } from '../store/useUI.js'
import { MOBILE } from './mobile.js'

let started = false

export async function initBackButton() {
  if (started || !MOBILE) return
  started = true
  let App, Capacitor
  try {
    ({ Capacitor } = await import('@capacitor/core'));
    ({ App } = await import('@capacitor/app'))
  } catch { return }                                   // web build, or the plugin is absent
  if (Capacitor.getPlatform() !== 'android') return    // iOS has no Back button

  await App.addListener('backButton', () => {
    const { sheets, closeSheet } = useUI.getState()
    // A locked sheet is mid-flow (a purchase, a step we must not abandon half-done), so Back
    // leaves it alone rather than tearing it down.
    const top = sheets[sheets.length - 1]
    if (top) { if (!top.locked) closeSheet(top.id); return }
    if (window.location.hash && window.location.hash !== '#/home' && window.location.hash !== '#/') {
      window.history.length > 1 ? window.history.back() : (window.location.hash = '#/home')
      return
    }
    App.minimizeApp()
  })
}
