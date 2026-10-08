// "Continue with Google". Two front doors, one back door:
//   web   -> Google Identity Services button (script from accounts.google.com, allowed in CSP)
//   mobile-> the native account picker via @capgo/capacitor-social-login
// Both end with a Google ID token that goes to POST /api/auth/google, which verifies it against
// Google's keys and answers with our own session. No Google secret lives in the client.
import { MOBILE } from './mobile.js'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
let gisLoading = null
export function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (!gisLoading) gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC; s.async = true; s.defer = true
    s.onload = () => resolve(window.google.accounts.id)
    s.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in')) }
    document.head.appendChild(s)
  })
  return gisLoading
}

// Web: render Google's own button into `el` and resolve the credential when the person picks an account.
export async function renderGoogleButton(el, clientId, onCredential, { lang = 'es', width = 320 } = {}) {
  const id = await loadGis()
  id.initialize({ client_id: clientId, callback: r => r && r.credential && onCredential(r.credential), ux_mode: 'popup', auto_select: false, itp_support: true, use_fedcm_for_prompt: true })
  el.innerHTML = ''
  id.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'left', width, locale: lang })
}

// Mobile: native picker. iOS additionally needs its own client id (VITE_GOOGLE_IOS_CLIENT_ID at
// build time) and the reversed id as a URL scheme in Info.plist — see docs/ACCOUNTS.md §10.
let nativeReady = null
export async function nativeGoogleSignIn(webClientId) {
  if (!MOBILE) throw new Error('native sign-in only in the app')
  const { SocialLogin } = await import('@capgo/capacitor-social-login')
  if (!nativeReady) nativeReady = SocialLogin.initialize({ google: { webClientId, iOSClientId: import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID || undefined, iOSServerClientId: webClientId, mode: 'online' } })
  await nativeReady
  // No `scopes` here on purpose: the plugin already asks for openid, email and profile, and on
  // Android passing *any* scopes array makes it refuse unless MainActivity implements the
  // plugin's own interface ("You CANNOT use scopes without modifying the main activity").
  const r = await SocialLogin.login({ provider: 'google', options: {} })
  const tok = r && r.result && r.result.idToken
  if (!tok) throw new Error('Google did not return a sign-in token')
  return tok
}
