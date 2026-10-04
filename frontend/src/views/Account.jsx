// Account screens that live outside the signed-in app: the email verification and password
// reset links from the mails (#/verify?token=, #/reset?token=) and the paywall shown when a
// trial has ended and there is no subscription. All plain and short — these are the screens
// people reach from an email on their phone.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import { authVerify, authReset, billingPlans, billingCheckout, billingPortal, authResendVerify } from '../lib/api.js'
import { daysLeft } from '../lib/entitlements.js'
import { storePurchases, storePlans, storeBuy, storeRestore, STORE } from '../lib/purchases.js'
import Icon from '../components/Icon.jsx'
import { Mark } from '../components/Logo.jsx'
import { Button, TextField } from '../components/ui.jsx'

const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }
const Head = ({ icon = 'dumbbell', title, sub }) => <>
  <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}>{icon === 'dumbbell' ? <Mark size={64} /> : <Icon name={icon} />}</div>
  <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 6px' }}>{title}</h1>
  {sub && <div className="muted" style={{ marginBottom: 24, lineHeight: 1.5 }}>{sub}</div>}
</>

export function Verify() {
  const token = new URLSearchParams(useLocation().search).get('token') || ''
  const [state, setState] = useState('busy')   // busy | ok | bad
  const refreshMe = useStore(s => s.refreshMe)
  useEffect(() => {
    if (!token) { setState('bad'); return }
    authVerify(token).then(async () => { await refreshMe(); setState('ok') }).catch(() => setState('bad'))
  }, [])
  return <div className="narrow" style={wrap}>
    {state === 'busy' && <Head title={t('Confirming your email…')} />}
    {state === 'ok' && <><Head icon="checkCircle" title={t('Email confirmed')} sub={t('Your account is fully active. Welcome aboard.')} />
      <Button variant="primary" onClick={() => nav('/home')}>{t('Continue')}</Button></>}
    {state === 'bad' && <><Head icon="xmark" title={t('This link no longer works')} sub={t('Links expire after 24 hours and work once. Sign in and request a new one from Settings.')} />
      <Button variant="primary" onClick={() => nav('/home')}>{t('Go to the app')}</Button></>}
  </div>
}

export function Reset() {
  const token = new URLSearchParams(useLocation().search).get('token') || ''
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const toast = useUI(s => s.toast)
  const { setUser, pullState } = useStore()
  const go = async e => {
    e.preventDefault()
    if (pw.length < 8) return toast(t('Use at least 8 characters'))
    if (pw !== pw2) return toast(t('The two passwords don’t match'))
    setBusy(true)
    try { const r = await authReset(token, pw); setUser(r.user); await pullState(); setDone(true) }
    catch (err) { toast(err.message || t('Something went wrong — try again')) }
    setBusy(false)
  }
  if (done) return <div className="narrow" style={wrap}>
    <Head icon="checkCircle" title={t('Password updated')} sub={t('You are signed in here; every other device was signed out.')} />
    <Button variant="primary" onClick={() => nav('/home')}>{t('Continue')}</Button>
  </div>
  return <div className="narrow" style={wrap}>
    <Head icon="key" title={t('Choose a new password')} sub={t('At least 8 characters. A short sentence you will remember works best.')} />
    <form onSubmit={go} style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
      <TextField type="password" autoComplete="new-password" placeholder={t('New password')} value={pw} onChange={e => setPw(e.target.value)} autoFocus />
      <TextField type="password" autoComplete="new-password" placeholder={t('Repeat it')} value={pw2} onChange={e => setPw2(e.target.value)} />
      <Button type="submit" variant="primary" disabled={busy}>{busy ? t('Saving…') : t('Save password')}</Button>
    </form>
  </div>
}

// Plans list shared by the paywall and Settings → Subscription.
export function Plans({ compact }) {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState('')
  const [pick, setPick] = useState(null)
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const refreshMe = useStore(s => s.refreshMe)
  const store = storePurchases()
  // Store builds: the plans come from the server, the prices and the purchase from the store.
  useEffect(() => {
    billingPlans().then(async d => {
      if (!store) return setData(d)
      try {
        const sp = await storePlans(user?.id)
        const monthly = sp.monthly?.amount
        const plans = d.plans.filter(p => sp[p.id]).map(p => { const s = sp[p.id]; const base = monthly ? monthly * p.months : 0
          return { ...p, amount: s.amount, perMonth: Math.floor(s.amount / p.months), available: true, savings: Math.max(0, base - s.amount), savingsPct: base ? Math.max(0, Math.round((1 - s.amount / base) * 100)) : 0 } })
        setData({ ...d, plans: plans.length ? plans : d.plans, currency: Object.values(sp)[0]?.currency || d.currency, payments: plans.length > 0, store: true, firstChargeAt: null, rescueUntil: null })
      } catch (e) { console.warn('store plans', e.message); setData({ ...d, payments: false, store: true, storeError: e.message || true }) }
    }).catch(() => setData({ plans: [] }))
  }, [])
  const buy = async id => {
    setBusy(id)
    try {
      if (store) {
        const plan = (await storePlans(user?.id))[id]
        if (!plan) throw new Error(t('The store did not answer — check your connection and try again.'))
        const ok = await storeBuy(plan)
        if (ok === null) { /* sheet dismissed */ }
        else { await refreshMe(); toast(ok ? t('Thank you! Your plan is active.') : t('Purchase received — your plan will show as active in a moment.')) }
      } else { const r = await billingCheckout(id); if (r.url) window.location.href = r.url }
    } catch (e) { toast(e.message || t('Something went wrong — try again')) }
    setBusy('')
  }
  const restore = async () => {
    setBusy('restore')
    try { const ok = await storeRestore(); await refreshMe(); toast(ok ? t('Purchases restored.') : t('No active subscription found for this store account.')) }
    catch (e) { toast(e.message || t('Something went wrong — try again')) }
    setBusy('')
  }
  if (!data) return <div className="small dim">{t('Loading plans…')}</div>
  const fmt = n => new Intl.NumberFormat(data.currency === 'MXN' ? 'es-MX' : dateLocale(), { style: 'currency', currency: data.currency || 'MXN', maximumFractionDigits: 0 }).format(n)
  const monthly = data.plans.find(p => p.months === 1)
  // Yearly first and preselected: the cheapest month is the default answer, not a discovery.
  const ordered = [...data.plans].sort((a, b) => b.months - a.months)
  const best = ordered[0]
  const sel = data.plans.find(p => p.id === pick) || best
  const b = user?.billing || {}
  const inTrial = b.status === 'trial'
  const fc = data.firstChargeAt ? new Date(data.firstChargeAt) : null
  const fcLabel = fc ? fc.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }) : null
  const rescue = data.rescueUntil && Date.parse(data.rescueUntil) > Date.now()
  const periodWord = p => p.months === 1 ? t('every month') : p.months === 12 ? t('every year') : t('every {0} months', p.months)
  return <div className="pw">
    {inTrial && data.bonusDays > 0 && fcLabel && <div className="pw-bonus"><Icon name="sparkles" /><span>{t('Activate during your trial and we add {0} more days: nothing is charged until {1}.', data.bonusDays, fcLabel)}</span></div>}
    {rescue && <div className="pw-bonus" style={{ borderColor: 'var(--orange)' }}><Icon name="flame" style={{ color: 'var(--orange)' }} /><span>{t('Welcome-back price on the 6-month plan for the next 48 hours.')}</span></div>}
    <div className="pw-plans">
      {ordered.map(p => { const on = p === sel; const perMo = p.months === 1 ? p.amount : p.perMonth
        return <button key={p.id} className={'pw-plan' + (on ? ' on' : '') + (!p.available ? ' off' : '')} disabled={!!busy || !data.payments} onClick={() => setPick(p.id)} aria-pressed={on}>
          {p === best && <span className="plan-tag">{t('Best value')}</span>}
          {p.months === 6 && <span className="plan-tag alt">{t('Popular')}</span>}
          <span className="pw-check"><Icon name={on ? 'checkCircle' : 'dot'} /></span>
          <div className="pw-main">
            <div className="pw-name">{p.months === 1 ? t('Monthly') : p.months === 12 ? t('Yearly') : t('{0} months', p.months)}</div>
            <div className="pw-sub">{p.months === 1 ? t('{0} every month', fmt(p.amount)) : t('{0} {1} · one payment', fmt(p.amount), periodWord(p))}</div>
            {p.savings > 0 && <div className="pw-save">{t('You save {0} ({1}%) vs monthly', fmt(p.savings), p.savingsPct)}</div>}
          </div>
          <div className="pw-price">
            {monthly && p.months > 1 && <s>{fmt(monthly.amount)}</s>}
            <b>{fmt(perMo)}</b><span>{t('per month')}</span>
          </div>
        </button> })}
    </div>
    {!data.payments && <div className="small dim" style={{ marginTop: 10 }}>{data.storeError ? <>{t('The store did not answer — check your connection and try again.')}{typeof data.storeError === 'string' && <div className="dim" style={{ marginTop: 4, fontSize: 11 }}>{data.storeError}</div>}</> : t('Payments are not open yet — we will email you when they are.')}</div>}
    {data.payments && sel && <>
      <div style={{ height: 12 }} />
      <Button variant="primary" icon="crown" disabled={!!busy || !sel.available} onClick={() => buy(sel.id)}>
        {busy ? t('One moment…') : inTrial && fcLabel ? t('Activate my plan · {0} today', fmt(0)) : b.status === 'expired' ? t('Continue with {0}', sel.months === 1 ? t('Monthly') : sel.months === 12 ? t('Yearly') : t('{0} months', sel.months)) : t('Choose {0}', sel.months === 1 ? t('Monthly') : sel.months === 12 ? t('Yearly') : t('{0} months', sel.months))}
      </Button>
      <div className="small muted" style={{ marginTop: 8, textAlign: 'center', lineHeight: 1.5 }}>
        {inTrial && fcLabel ? t('First charge on {0}: {1} {2}. Cancel any time before from Settings.', fcLabel, fmt(sel.amount), periodWord(sel)) : t('{0} {1}, renews automatically. Cancel any time from Settings.', fmt(sel.amount), periodWord(sel))}
      </div>
      <div className="small dim" style={{ marginTop: 6, textAlign: 'center' }}>{data.store ? (STORE === 'apple' ? t('Billed through your Apple ID · manage or cancel in App Store settings') : t('Billed through Google Play · manage or cancel in Play Store settings')) : t('Secure payment with Stripe · automatic receipt · no lock-in')}</div>
    </>}
    {data.store && <div style={{ textAlign: 'center', marginTop: 10 }}><button className="linkbtn small" disabled={!!busy} onClick={restore}>{busy === 'restore' ? t('One moment…') : t('Restore purchases')}</button></div>}
    {!compact && <div className="small dim" style={{ marginTop: 12, lineHeight: 1.5, textAlign: 'center' }}>{t('Prices include tax. Access runs to the end of the period you paid for.')} <a href="#/terms">{t('terms of service')}</a> · <a href="#/privacy">{t('privacy')}</a></div>}
  </div>
}

export function Paywall() {
  const user = useStore(s => s.user)
  const signOut = useStore(s => s.signOut)
  const refreshMe = useStore(s => s.refreshMe)
  const toast = useUI(s => s.toast)
  const b = user?.billing || {}
  const resend = async () => { try { await authResendVerify(); toast(t('Sent — check your inbox')) } catch (e) { toast(e.message) } }
  return <div className="narrow" style={{ ...wrap, justifyContent: 'flex-start', paddingTop: 48 }}>
    <Head icon="crown" title={b.status === 'expired' && b.trialEnds ? t('Your free trial has ended') : b.status === 'trial' ? t('Keep everything after your trial') : t('Choose your plan')}
      sub={b.status === 'trial' ? t('Coach, trainer, meal photos, your nutritionist’s plan and monthly progress photos. Pick a plan now and the trial gets longer.') : t('Keep your coach, your plans and all your progress. Your data is safe either way.')} />
    {user && !user.emailVerified && <div className="card small" style={{ textAlign: 'left', marginBottom: 14 }}>
      {t('Confirm your email first — we sent a link to {0}.', user.email)} <button className="linkbtn" onClick={resend}>{t('Send it again')}</button>
    </div>}
    <Plans />
    <div style={{ height: 18 }} />
    <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
      {b.provider && <Button size="sm" onClick={() => billingPortal().then(r => { if (r.url) (r.store ? window.open(r.url, '_blank', 'noopener') : window.location.href = r.url) }).catch(e => toast(e.message))}>{t('Manage subscription')}</Button>}
      <Button size="sm" onClick={() => refreshMe()}>{t('I already paid')}</Button>
      {b.active ? <Button size="sm" variant="ghost" className="dim" onClick={() => nav('/home')}>{t('Not now')}</Button>
        : <Button size="sm" variant="ghost" className="dim" onClick={() => signOut()}>{t('Sign out')}</Button>}
    </div>
  </div>
}

// Short status line used in Settings and the Home banner.
export function subscriptionLabel(b) {
  if (!b || !b.enabled) return ''
  if (b.status === 'pro') return b.cancelAtPeriodEnd ? t('Active until {0}', new Date(b.tierUntil).toLocaleDateString()) : t('Active · renews {0}', new Date(b.tierUntil).toLocaleDateString())
  if (b.status === 'trial') { const d = daysLeft(b.trialEnds); return d <= 1 ? t('Free trial · ends today') : t('Free trial · {0} days left', d) }
  if (b.status === 'expired') return t('No active plan')
  return ''
}
