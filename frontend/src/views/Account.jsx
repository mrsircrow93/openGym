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
  const toast = useUI(s => s.toast)
  useEffect(() => { billingPlans().then(setData).catch(() => setData({ plans: [] })) }, [])
  const buy = async id => {
    setBusy(id)
    try { const r = await billingCheckout(id); if (r.url) window.location.href = r.url }
    catch (e) { toast(e.message || t('Something went wrong — try again')) }
    setBusy('')
  }
  if (!data) return <div className="small dim">{t('Loading plans…')}</div>
  const fmt = n => new Intl.NumberFormat(data.currency === 'MXN' ? 'es-MX' : dateLocale(), { style: 'currency', currency: data.currency || 'MXN', maximumFractionDigits: 0 }).format(n)
  // cheapest per month wins; on a tie the longer plan (fewer charges, fewer fees)
  const best = data.plans.reduce((a, p) => (!a || p.perMonth < a.perMonth || (p.perMonth === a.perMonth && p.months > a.months) ? p : a), null)
  return <div className="plans">
    {data.plans.map(p => <button key={p.id} className={'plan-card tappable' + (p === best ? ' best' : '')} disabled={!!busy || !data.payments} onClick={() => buy(p.id)}>
      {p === best && <span className="plan-tag">{t('Best value')}</span>}
      <div className="plan-name">{p.months === 1 ? t('Monthly') : p.months === 12 ? t('Yearly') : t('{0} months', p.months)}</div>
      <div className="plan-price">{fmt(p.amount)}</div>
      <div className="dim small">{p.months === 1 ? t('per month') : t('{0} per month', fmt(p.perMonth))}</div>
    </button>)}
    {!data.payments && <div className="small dim" style={{ gridColumn: '1 / -1' }}>{t('Payments are not open yet — we will email you when they are.')}</div>}
    {!compact && <div className="small dim" style={{ gridColumn: '1 / -1', lineHeight: 1.5 }}>{t('Prices include tax. Cancel any time from Settings; access runs to the end of the period you paid for.')}</div>}
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
    <Head icon="crown" title={b.status === 'expired' && b.trialEnds ? t('Your free trial has ended') : t('Choose your plan')}
      sub={t('Keep your coach, your plans and all your progress. Your data is safe either way.')} />
    {user && !user.emailVerified && <div className="card small" style={{ textAlign: 'left', marginBottom: 14 }}>
      {t('Confirm your email first — we sent a link to {0}.', user.email)} <button className="linkbtn" onClick={resend}>{t('Send it again')}</button>
    </div>}
    <Plans />
    <div style={{ height: 18 }} />
    <div className="row" style={{ gap: 8, justifyContent: 'center' }}>
      {b.provider && <Button size="sm" onClick={() => billingPortal().then(r => { if (r.url) window.location.href = r.url }).catch(e => toast(e.message))}>{t('Manage subscription')}</Button>}
      <Button size="sm" onClick={() => refreshMe()}>{t('I already paid')}</Button>
      <Button size="sm" variant="ghost" className="dim" onClick={() => signOut()}>{t('Sign out')}</Button>
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
