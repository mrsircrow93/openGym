// Fails the mobile build when the bundle was not compiled with the mobile env (VITE_MOBILE=1
// and VITE_API_BASE). This happened once: an `eslint &&` prefix swallowed the env vars and the
// store build shipped as a web build (Stripe instead of in-app purchases, relative API URLs).
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve('dist/assets')
const files = fs.readdirSync(dir).filter(f => f.startsWith('index-') && f.endsWith('.js'))
const src = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
const problems = []
if (!/https:\/\/app\.vantixgym\.app/.test(src)) problems.push('VITE_API_BASE missing: the app would call relative /api URLs inside the WebView')
if (!/appl_[A-Za-z0-9]{20,}/.test(src)) problems.push('RevenueCat Apple key missing: storePurchases() would be false on iOS and the app would open Stripe')
// Android shipped once with no Google key at all: the paywall rendered, the plans were listed,
// and there was simply no button, because Play billing was not configured yet. Testers hit a
// dead end they could not report usefully. The bundle now has to carry both stores' keys.
if (!/goog_[A-Za-z0-9]{20,}/.test(src)) problems.push('RevenueCat Google key missing: storePurchases() would be false on Android and the paywall would dead-end')
if (problems.length) { console.error('✖ mobile bundle check failed:\n  - ' + problems.join('\n  - ')); process.exit(1) }
console.log('✓ mobile bundle: API base + store purchases present')
