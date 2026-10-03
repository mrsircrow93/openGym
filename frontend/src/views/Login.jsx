import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, api, BIO, authLogin, authRegister, authForgot, authGoogle, authApple } from '../lib/api.js'
import { appleSignIn, appleAvailable } from '../lib/apple.js'
import { renderGoogleButton, nativeGoogleSignIn } from '../lib/google.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, STATIC, REPO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import Logo from '../components/Logo.jsx'
import { Button, TextField, Segmented } from '../components/ui.jsx'
import { getLang } from '../lib/i18n.js'
import { fetchMe } from '../lib/api.js'

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
  const head = <Logo mark={72} word={36} style={{ margin: '0 0 12px' }} />
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Static build: no backend — start straight into a local, on-device profile (boot() usually
  // sets guest before this ever renders; this is the fallback if the app lands here).
  if (STATIC && !MOBILE) return (
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
  // ?ref=CODE on the app link (shared from Settings → Invite & earn) pre-fills the referral field
  const [ref, setRef] = useState(() => { try { return new URLSearchParams(window.location.search).get('ref') || localStorage.getItem('vx_ref') || '' } catch { return '' } })
  useEffect(() => { try { if (ref) localStorage.setItem('vx_ref', ref.toUpperCase()) } catch {} }, [ref])
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
        await after(await authRegister(em, pw, name.trim(), code.trim(), getLang(), ref.trim()))
        try { localStorage.removeItem('vx_ref') } catch {}
      } else {
        if (!pw) throw new Error(t('Enter your password'))
        await after(await authLogin(em, pw))
      }
    } catch (err) { toast(err.message || t('Something went wrong — try again')) }
    setBusy(false)
  }
  const field = { textAlign: 'left' }
  const { S, update } = useStore()
  const lang = S.lang || 'es'
  // Google: the web button is Google's own (rendered into gBox); the app uses the native picker.
  const gBox = useRef(null)
  const [gBusy, setGBusy] = useState(false)
  const withGoogle = async credential => {
    if (busy || gBusy) return
    setGBusy(true)
    try { await after(await authGoogle(credential, getLang(), ref.trim(), code.trim())); try { localStorage.removeItem('vx_ref') } catch {} }
    catch (err) { toast(err.message || t('Google sign-in failed — try again')) }
    setGBusy(false)
  }
  useEffect(() => {
    if (!cfg.googleClientId || MOBILE || !gBox.current || mode === 'forgot') return
    renderGoogleButton(gBox.current, cfg.googleClientId, withGoogle, { lang, width: Math.min(360, gBox.current.clientWidth || 320) }).catch(() => {})
  }, [cfg.googleClientId, mode, lang])
  const withApple = async () => {
    if (busy || gBusy) return
    setGBusy(true)
    try {
      const { identityToken, name } = await appleSignIn(cfg.appleClientId)
      await after(await authApple(identityToken, name, getLang(), ref.trim(), code.trim())); try { localStorage.removeItem('vx_ref') } catch {}
    } catch (err) { if (!/cancel|popup_closed|1001/i.test(String(err && (err.error || err.message)))) toast(err.message || t('Apple sign-in failed — try again')) }
    setGBusy(false)
  }
  const nativeGoogle = async () => {
    setGBusy(true)
    try { const tok = await nativeGoogleSignIn(cfg.googleClientId); setGBusy(false); await withGoogle(tok) }
    catch (err) { setGBusy(false); if (!/cancel/i.test(err.message || '')) toast(err.message || t('Google sign-in failed — try again')) }
  }
  const setLangPref = l => update(st => { st.lang = l }, false)
  return (
    <div className="narrow" style={wrap}>
      <div className="lang-pick" role="group" aria-label="Idioma / Language">
        <button type="button" className={lang === 'es' ? 'on' : ''} onClick={() => setLangPref('es')}>ES</button>
        <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLangPref('en')}>EN</button>
      </div>
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
        {mode === 'register' && <TextField style={{ ...field, letterSpacing: '.1em', fontWeight: 600 }} placeholder={t('Referral code (optional)')} maxLength={16} autoComplete="off" spellCheck={false} value={ref} onChange={e => setRef(e.target.value.toUpperCase())} />}
        {mode === 'register' && ref && <div className="small" style={{ color: 'var(--acc)' }}>{t('With a friend\'s code your free trial is longer.')}</div>}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('One moment…') : mode === 'forgot' ? t('Send me a link') : mode === 'register' ? (cfg.billing && cfg.trialDays > 0 ? t('Start my free trial') : t('Create account')) : t('Sign in')}
        </Button>
        {mode === 'login' && <button type="button" className="linkbtn small" onClick={() => setMode('forgot')}>{t('Forgot your password?')}</button>}
        {mode === 'forgot' && <button type="button" className="linkbtn small" onClick={() => setMode('login')}>{t('Back to sign in')}</button>}
        {mode === 'register' && <div className="dim small" style={{ lineHeight: 1.5 }}>{t('By creating an account you accept the')} <a href="#/terms">{t('terms of service')}</a> {t('and the')} <a href="#/privacy">{t('privacy policy')}</a>. {t('No card needed for the trial.')}</div>}
      </form>}

      {(cfg.googleClientId || (cfg.appleClientId && appleAvailable())) && mode !== 'forgot' && <>
        <div className="dim small" style={{ margin: '18px 0 10px' }}>{t('or')}</div>
        {cfg.appleClientId && appleAvailable() && <>
          <button type="button" className="social-btn" disabled={gBusy} onClick={withApple}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M16.37 12.73c-.03-2.6 2.13-3.86 2.23-3.92-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.95-3.94.95-.82 0-2.07-.93-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.15-.47 7.82 1.3 10.38.87 1.25 1.9 2.66 3.25 2.61 1.3-.05 1.8-.84 3.37-.84s2.02.84 3.4.81c1.4-.02 2.29-1.27 3.15-2.53 1-1.45 1.4-2.86 1.43-2.93-.03-.01-2.74-1.05-2.76-4.17zM13.78 5.07c.72-.87 1.2-2.08 1.07-3.28-1.03.04-2.29.69-3.03 1.56-.66.77-1.25 2-1.09 3.18 1.15.09 2.33-.59 3.05-1.46z"/></svg>
            <span>{gBusy ? t('One moment…') : t('Continue with Apple')}</span>
          </button>
          <div style={{ height: 8 }} />
        </>}
        {cfg.googleClientId && (MOBILE
          ? <button type="button" className="social-btn" disabled={gBusy} onClick={nativeGoogle}>
              <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              <span>{gBusy ? t('One moment…') : t('Continue with Google')}</span>
            </button>
          : <div ref={gBox} className="gsi-box" style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />)}
      </>}
      {webauthnOK() && !MOBILE && mode === 'login' && <>
        {!cfg.googleClientId && <div className="dim small" style={{ margin: '18px 0 8px' }}>{t('or')}</div>}
        <div style={{ height: 8 }} />
        <Button icon="person" onClick={signInPasskey}>{t('Sign in with {0}', BIO)}</Button>
      </>}
    </div>
  )
}
