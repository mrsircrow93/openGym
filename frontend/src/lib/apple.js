// "Continue with Apple". Web: Apple's JS SDK in popup mode gives us the identity token straight
// away (no redirect, no server secret). iOS app: the native sheet through the same social-login
// plugin as Google. Both post the token to /api/auth/apple, which verifies it against Apple's keys.
import { MOBILE } from './mobile.js'

const IOS_APP = MOBILE && /iPhone|iPad|iPod/i.test(navigator.userAgent)
const SDK = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/es_MX/appleid.auth.js'
let loading = null
function loadSdk() {
  if (window.AppleID?.auth) return Promise.resolve(window.AppleID.auth)
  if (!loading) loading = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = SDK; s.async = true
    s.onload = () => resolve(window.AppleID.auth)
    s.onerror = () => { loading = null; reject(new Error('Could not load Apple sign-in')) }
    document.head.appendChild(s)
  })
  return loading
}

// Where the Apple button makes sense: the web app and the iOS app. (Android needs a redirect
// flow through our server; not wired yet, and Apple only requires the button on iOS.)
export const appleAvailable = () => !MOBILE || IOS_APP

// Resolves { identityToken, name } — name only on the very first sign-in with that Apple ID.
export async function appleSignIn(clientId) {
  if (IOS_APP) {
    const { SocialLogin } = await import('@capgo/capacitor-social-login')
    await SocialLogin.initialize({ apple: { clientId, redirectUrl: '' } })
    const r = await SocialLogin.login({ provider: 'apple', options: { scopes: ['email', 'name'] } })
    const tok = r?.result?.idToken
    if (!tok) throw new Error('Apple did not return a sign-in token')
    const p = r.result.profile || {}
    return { identityToken: tok, name: [p.givenName, p.familyName].filter(Boolean).join(' ') }
  }
  const auth = await loadSdk()
  auth.init({ clientId, scope: 'name email', redirectURI: window.location.origin + '/', usePopup: true })
  const r = await auth.signIn()
  const tok = r?.authorization?.id_token
  if (!tok) throw new Error('Apple did not return a sign-in token')
  const u = r.user?.name || {}
  return { identityToken: tok, name: [u.firstName, u.lastName].filter(Boolean).join(' ') }
}
