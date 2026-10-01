// Feature gating for the paid tier. Nothing is gated yet — every check returns true — but every
// premium surface should already ask here instead of assuming, so flipping billing on later is a
// server-side change, not a hunt through the UI. See docs/BILLING.md for the plan.
import { api } from './api.js'
import { hasUserKey } from './ai.js'

export const TIERS = ['free', 'pro']

// What each tier includes. 'ai' means server-paid AI calls; a user with their own key always
// has AI regardless of tier (they're paying Anthropic directly).
export const FEATURES = {
  free: { ai: false, aiMonthlyUsd: 0, progressPhotos: false, trainer: false, mealPhotos: false, exportPdf: true },
  pro: { ai: true, aiMonthlyUsd: 3, progressPhotos: true, trainer: true, mealPhotos: true, exportPdf: true }
}

let status = { enabled: false, tier: 'free', renewsAt: null, aiCapUsd: null }
export const billingStatus = () => status

// Called once at boot when signed in; harmless offline (keeps the last answer / free).
export async function refreshBilling() {
  try { status = { ...status, ...(await api('/api/billing/status')) } } catch { /* offline or no backend */ }
  return status
}

// The one question the UI asks. Until billing is enabled on the instance, everything is on.
export function can(feature) {
  if (!status.enabled) return true
  if (feature === 'ai' && hasUserKey()) return true
  return status.active !== false
}
// True when the signed-in account has neither an active trial nor a subscription: the app
// shows the paywall instead of the tabs. Admins and self-hosted (billing off) are never locked.
export const locked = user => !!(user && user.billing && user.billing.enabled && !user.billing.active)
export const daysLeft = iso => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400000)) : 0)

// Where a gated feature sends people. Stub until checkout exists — see docs/BILLING.md.
export async function startCheckout(tier = 'pro') {
  const r = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ tier }) })
  if (r.url) window.location.href = r.url
  return r
}
