// In-app purchases for the store builds (RevenueCat). The web keeps Stripe; inside the iOS and
// Android apps the same three plans are bought through the store, as Apple and Google require.
// The server learns about the purchase from RevenueCat's webhook and, when configured, from
// POST /api/billing/sync right after the purchase (see docs/BILLING.md §Stores).
//
// The keys below are RevenueCat *public* app keys (one per store app) — safe to ship.
import { MOBILE } from './mobile.js'
import { api } from './api.js'

const APPLE_KEY = import.meta.env.VITE_RC_APPLE_KEY || 'appl_nmMQgvALvDgBGabnJSGqOEEmciz'
const GOOGLE_KEY = import.meta.env.VITE_RC_GOOGLE_KEY || ''
const IOS = MOBILE && /iPhone|iPad|iPod/i.test(navigator.userAgent)
const ANDROID = MOBILE && /Android/i.test(navigator.userAgent)
const KEY = IOS ? APPLE_KEY : ANDROID ? GOOGLE_KEY : ''

// True when this build buys through a store instead of Stripe.
export const STORE = IOS ? 'apple' : ANDROID ? 'google' : null
export const storePurchases = () => !!(KEY && STORE)

let mod = null, configuredFor = null
async function sdk() { if (!mod) mod = (await import('@revenuecat/purchases-capacitor')).Purchases; return mod }

// Called whenever the signed-in account changes. RevenueCat's app user id = our user id, so the
// webhook can find the account; signing out returns the SDK to an anonymous id.
export async function purchasesIdentify(userId) {
  if (!storePurchases()) return
  try {
    const P = await sdk()
    if (!configuredFor) { await P.configure({ apiKey: KEY, appUserID: userId || undefined }); configuredFor = userId || 'anon'; return }
    if (userId && configuredFor !== userId) { await P.logIn({ appUserID: userId }); configuredFor = userId }
    else if (!userId && configuredFor !== 'anon') { await P.logOut(); configuredFor = 'anon' }
  } catch (e) { console.warn('purchases', e.message) }
}

// The three plans as the store prices them. Packages are matched to our plan ids by the
// product identifier (…mobile.monthly / .semester / .yearly) so the offering can be renamed.
const PLAN_RE = { monthly: /monthly/i, semester: /semester|six/i, yearly: /yearly|annual/i }
export async function storePlans() {
  const P = await sdk()
  const { current } = await P.getOfferings()
  const out = {}
  for (const pk of current?.availablePackages || []) {
    const pid = pk.product?.identifier || pk.identifier
    const id = Object.keys(PLAN_RE).find(k => PLAN_RE[k].test(pid)) || Object.keys(PLAN_RE).find(k => PLAN_RE[k].test(pk.identifier))
    if (id && !out[id]) out[id] = { id, amount: pk.product.price, currency: pk.product.currencyCode, priceString: pk.product.priceString, pkg: pk }
  }
  return out
}

// Buy, then make the server notice. Resolves true when the account is now active.
export async function storeBuy(plan) {
  const P = await sdk()
  try { await P.purchasePackage({ aPackage: plan.pkg }) }
  catch (e) { if (e?.userCancelled || /cancel/i.test(e?.message || '')) return null; throw e }
  return settle()
}
export async function storeRestore() {
  const P = await sdk()
  await P.restorePurchases()
  return settle()
}
// Ask the server to pull the subscriber; if that isn't configured, give the webhook a moment.
async function settle() {
  for (let i = 0; i < 8; i++) {
    try { const r = await api('/api/billing/sync', { method: 'POST', body: '{}' }); if (r.billing?.active) return true } catch { /* not configured or transient: the webhook will land */ }
    await new Promise(r => setTimeout(r, 1500))
    try { const me = await api('/api/me'); if (me.user?.billing?.active && me.user.billing.status === 'pro') return true } catch { /* keep trying */ }
  }
  return false
}
