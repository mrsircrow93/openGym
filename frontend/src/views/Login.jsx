import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, api, BIO, authLogin, authRegister, authForgot } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, STATIC, REPO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, TextField, Segmented } from '../components/ui.jsx'
import { getLang } from '../lib/i18n.js'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState } = useStore()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', BIO)}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
  }
  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Static build: no backend — start straight into a local, on-device profile (boot() usually
  // sets guest before this ever renders; this is the fallback if the app lands here).
  if (STATIC) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Your workouts. Your weights. On this device.')}</div>
      <Button variant="primary" icon="dumbbell" onClick={() => setGuest(true)}>{t('Get started')}</Button>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>{t('Data stays in this browser — export a backup from Settings now and then.')}</div>
    </div>
  )

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return <EmailLogin head={head} wrap={wrap} signInPasskey={signIn} />
}

// Hosted instance: accounts are email + password (what billing, receipts and recovery need),
// with a passkey as the fast way back in. Three modes in one card; no guest mode here.
function EmailLogin({ head, wrap, signInPasskey }) {
  const { setUser, pushState, pullState } = useStore()
  const toast = m => useUI.getState().toast(m)
  const [mode, setMode] = useState('login')   // login | register | forgot
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [cfg, setCfg] = useState({})
  useEffect(() => { api('/api/config').then(setCfg).catch(() => {}) }, [])
  const after = async u => {
    setUser(u)
    if (hasData(useStore.getState().S)) { await pushState(); toast(t('Welcome, {0} — the data on this device moved into your account', u.name)) }
    else { await pullState(); toast(t('Welcome, {0}', u.name)) }
  }
  const submit = async e => {
    e.preventDefault()
    if (busy) return
    const em = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(em)) return toast(t('Enter a valid email'))
    setBusy(true)
    try {
      if (mode === 'forgot') { await authForgot(em); setSent(true) }
      else if (mode === 'register') {
        if (!name.trim()) throw new Error(t('Enter a name'))
        if (pw.length < 8) throw new Error(t('Use at least 8 characters'))
        if (cfg.invite_only && !code.trim()) throw new Error(t('An invite code is required'))
        await after(await authRegister(em, pw, name.trim(), code.trim(), getLang()))
      } else {
        if (!pw) throw new Error(t('Enter your password'))
        await after(await authLogin(em, pw))
      }
    } catch (err) { toast(err.message || t('Something went wrong — try again')) }
    setBusy(false)
  }
  const field = { textAlign: 'left' }
  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 22 }}>{mode === 'register' && cfg.billing && cfg.trialDays > 0 ? t('{0} days free, then pick a plan. Cancel any time.', cfg.trialDays) : t('Your workouts. Your coach. Your progress.')}</div>

      <Segmented className="auth-seg" value={mode === 'forgot' ? 'login' : mode} onChange={v => { setMode(v); setSent(false) }}
        options={[{ value: 'login', label: t('Sign in') }, { value: 'register', label: cfg.billing && cfg.trialDays > 0 ? t('Try free') : t('Create account') }]} />

      {sent && mode === 'forgot' ? <div className="card small muted" style={{ textAlign: 'left' }}>
        {t('If there is an account for {0}, a link to choose a new password is on its way. Check spam too.', email.trim())}
        <div style={{ marginTop: 10 }}><button className="linkbtn" onClick={() => { setSent(false); setMode('login') }}>{t('Back to sign in')}</button></div>
      </div> : <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {mode === 'register' && <TextField style={field} placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} autoComplete="name" />}
        <TextField style={field} type="email" inputMode="email" autoComplete="email" placeholder={t('Email')} value={email} onChange={e => setEmail(e.target.value)} />
        {mode !== 'forgot' && <TextField style={field} type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={mode === 'register' ? t('Password (8+ characters)') : t('Password')} value={pw} onChange={e => setPw(e.target.value)} />}
        {mode === 'register' && cfg.invite_only && <TextField style={{ ...field, letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} placeholder={t('Invite code')} maxLength={40} value={code} onChange={e => setCode(e.target.value.toUpperCase())} />}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('One moment…') : mode === 'forgot' ? t('Send me a link') : mode === 'register' ? (cfg.billing && cfg.trialDays > 0 ? t('Start my free trial') : t('Create account')) : t('Sign in')}
        </Button>
        {mode === 'login' && <button type="button" className="linkbtn small" onClick={() => setMode('forgot')}>{t('Forgot your password?')}</button>}
        {mode === 'forgot' && <button type="button" className="linkbtn small" onClick={() => setMode('login')}>{t('Back to sign in')}</button>}
        {mode === 'register' && <div className="dim small" style={{ lineHeight: 1.5 }}>{t('By creating an account you accept the terms of service and privacy policy. No card needed for the trial.')}</div>}
      </form>}

      {webauthnOK() && mode === 'login' && <>
        <div className="dim small" style={{ margin: '18px 0 8px' }}>{t('or')}</div>
        <Button icon="person" onClick={signInPasskey}>{t('Sign in with {0}', BIO)}</Button>
      </>}
    </div>
  )
}
