import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF, hasData, safeParse } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, todayISO, localTZ, fmtNum } from '../lib/format.js'
import { effortOf } from '../lib/history.js'
import { api, webauthnOK, passkeyLogin, passkeyRegister, IS_ANDROID, BIO, authResendVerify, authChangePassword, authChangeEmail, passkeyAdd, deleteAccount, billingPortal, fetchReferral } from '../lib/api.js'
import { Plans, subscriptionLabel } from './Account.jsx'
import { nav as goto } from '../lib/nav.js'
import { useLocation } from 'react-router-dom'
import { pushSupported, enablePush, disablePush, sendTestPush } from '../lib/push.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { t, LANGS, INSTR_LANGS } from '../lib/i18n.js'
import { DEMO, STATIC, REPO } from '../lib/demo.js'
import { COACHES } from '../lib/coach.js'
import { convertProfile } from '../lib/units.js'
import { getAIKey, setAIKey, getAIModel, setAIModel, hasUserKey, AI_MODELS, testAIKey } from '../lib/ai.js'
import { MOBILE, shareExport, syncReminder, nudgesOf, NUDGE_DEF } from '../lib/mobile.js'
import { healthSupported, healthAvailable, installHealthConnect, requestHealth, syncHealth, IS_IOS_SHELL } from '../lib/health.js'
import { loadStarterPlan, confirmSheet, importFromApp } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField } from '../components/ui.jsx'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update, replaceState, setUser, pullState, pushState, signOut, signOutAll, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const refreshMe = useStore(s => s.refreshMe)
  const loc = useLocation()
  // back from Stripe: re-read the account so the subscription row is current
  useEffect(() => { const q = new URLSearchParams(loc.search).get('checkout'); if (q) { refreshMe(); if (q === 'success') toast(t('Thank you! Your plan is active.')) } }, [loc.search])
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const wakeOK = wakeLockSupported()

  const doExport = async () => {
    const json = JSON.stringify(S, null, 2)
    const name = 'opengym-backup-' + todayISO() + '.json'
    // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = safeParse(rd.result)
        if (!data.workouts || !data.routines) throw new Error('not an openGym backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceState(Object.assign(JSON.parse(JSON.stringify(DEF)), data), true); toast(t('Backup imported')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  const signInHere = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
  }
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} />)
  // Ends the profile's sessions on every device — this one included, so on success it lands in
  // the same place as the plain sign-out above (home, local data cleared). On failure nothing
  // local is touched: still signed in here, and say so rather than leaving a half-signed-out app.
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Your passkeys keep working — sign in with them again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) }
      catch (e) { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Settings')}</h1></div>
    </div>

    {/* ---------- account (demo and mobile builds have nothing to sign in to) ---------- */}
    <Section title={user ? t('Account') : MOBILE || STATIC ? t('Your data') : DEMO ? t('Demo') : t('Account')}>
      {user ? <>
        <Row icon="personCircle" iconTint="var(--grey)" title={user.name} subtitle={user.email ? user.email + (user.emailVerified ? '' : ' · ' + t('not confirmed')) : t('Signed in with passkey — data syncs to this profile.')} />
        {user.email && !user.emailVerified && <Row icon="bell" iconTint="var(--orange)" title={t('Confirm your email')} subtitle={t('Tap to send the link again.')} accessory="chevron"
          onClick={() => authResendVerify().then(() => toast(t('Sent — check your inbox'))).catch(e => toast(e.message))} />}
        {user.billing?.enabled && <Row icon="crown" iconTint="var(--yellow)" title={t('Subscription')} subtitle={subscriptionLabel(user.billing)} accessory="chevron"
          onClick={() => user.billing.status === 'pro' ? useUI.getState().openSheet(close => <SubscriptionSheet user={user} close={close} />) : nav('/plans')} />}
        {!STATIC && <Row icon="star" iconTint="var(--acc)" title={t('Invite & earn')} subtitle={t('Share your code: your friend gets a longer trial, you get free days.')} accessory="chevron"
          onClick={() => useUI.getState().openSheet(close => <ReferralSheet close={close} />)} />}
        <Row icon="key" iconTint="var(--blue)" title={user.hasPassword ? t('Change password') : t('Add email and password')} accessory="chevron"
          onClick={() => useUI.getState().openSheet(close => <PasswordSheet user={user} close={close} />)} />
        {webauthnOK() && !MOBILE && !user.hasPasskey && <Row icon="person" iconTint="var(--acc)" title={t('Sign in with {0} next time', BIO)} subtitle={t('Adds a passkey to this account.')} accessory="chevron"
          onClick={() => passkeyAdd().then(() => refreshMe()).then(() => toast(t('Passkey added'))).catch(e => { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message) })} />}
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
        <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
        <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
        {!user.admin && <Row icon="trash" iconTint="var(--red)" title={t('Delete account')} subtitle={t('Everything is erased after 30 days.')} danger
          onClick={() => useUI.getState().openSheet(close => <DeleteSheet user={user} close={close} />)} />}
      </> : MOBILE || STATIC ? <>
        <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this device')} subtitle={t('No account, no cloud — back it up anytime with Export below.')} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Sync across devices')} subtitle={t('Passkey sign-in and cross-device sync need the openGym backend.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : DEMO ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
        <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
          onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : webauthnOK() ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Create passkey profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere} />
        <Row icon="person" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={signInHere} />
      </> : (
        <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')} />
      )}
    </Section>
    {!user && !DEMO && !MOBILE && !STATIC && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

    {/* ---------- general ---------- */}
    <Section title={t('Preferences')} footer={t('Switching units converts everything you logged, so 100 kg becomes 220 lb.')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={S.lang || 'en'} onChange={v => update(s => { s.lang = v })}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      <SelectRow icon="sparkles" iconTint="var(--acc)" title={t('Coach')} sheetTitle={t('Choose your coach')}
        value={S.coach || ''} onChange={v => update(s => { s.coach = v })}
        options={[{ value: '', label: t('Not chosen') }, ...COACHES.map(c => ({ value: c.id, label: c.name }))]} />
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={S.unit} onChange={v => { if (v === S.unit) return
            const has = S.workouts.length || S.bodyweight.length || S.routines.some(r => r.ex.some(e => e.weight))
            if (!has) return update(s => { s.unit = v })
            confirmSheet({ title: t('Switch to {0}?', v), message: t('Your logged weights, routines and body weight will be converted from {0} to {1} so the numbers keep meaning the same thing.', S.unit, v),
              confirmText: t('Convert to {0}', v), onConfirm: () => { update(s => { convertProfile(s, s.unit, v) }); toast(t('Converted to {0}', v)) } }) }} />
      </Row>
    </Section>

    {/* ---------- during a workout ---------- */}
    <Section title={t('Workouts')} footer={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : null}>
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest between sets')}
        value={S.restSec} onChange={v => update(s => { s.restSec = v })}
        options={[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))} />
      <SelectRow icon="clock" iconTint="var(--orange)" title={t('Rest between exercises')}
        value={S.restExerciseSec ?? 120} onChange={v => update(s => { s.restExerciseSec = v })}
        options={[0, 60, 90, 120, 150, 180, 240, 300].map(v => ({ value: v, label: v === 0 ? t('Off') : (v >= 60 ? Math.floor(v / 60) + (v % 60 ? ':' + String(v % 60).padStart(2, '0') : ':00') + ' min' : v + 's') }))} />
      {(wakeOK || !MOBILE) && (
        <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')}
          subtitle={wakeOK ? null : t('Not supported in this browser.')}>
          <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
            onChange={v => update(s => { s.keepAwake = v })} />
        </Row>
      )}
      <Row icon="bell" iconTint="var(--pink)" title={t('Sounds')}>
        <Switch checked={!!S.sound} onChange={v => update(s => { s.sound = v })} />
      </Row>
      <Row icon="trophy" iconTint="var(--yellow)" title={t('Celebrations')} subtitle={t('Confetti when you reach a goal or earn an achievement')}>
        <Switch checked={S.celebrations !== false} onChange={v => update(s => { s.celebrations = v })} />
      </Row>
      {/* Two names for the same judgement, so the column asks in the scale you already think in.
          The (i) sits before the control — you read it on the way to the choice, not after it. */}
      <Row icon="target" iconTint="var(--purple)" title={t('Effort per set')}>
        <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>
    </Section>

    {(user || MOBILE) && <NotificationsCard S={S} update={update} toast={toast} />}
    {healthSupported() && <HealthCard S={S} update={update} toast={toast} />}

    {/* ---------- appearance ---------- */}
    <Section title={t('Appearance')} footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={S.theme === 'light' ? 'light' : 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Section>

    {/* ---------- data: fill it, bring things over, back it up, wipe it ---------- */}
    <details className="adv settings-adv">
      <summary className="small muted">{t('Advanced: backups, import, data')}</summary>
    <Section title={t('Data')}>
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} accessory="chevron" onClick={doExport} />
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { replaceState(JSON.parse(JSON.stringify(DEF)), true); nav('/home'); toast(t('All data reset')) } })} />
    </Section>
    <AICard toast={toast} user={user} />
    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />
    {/* Reset after reading so picking the same file twice still fires onChange. */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    {/* "Add to Home screen" makes no sense inside the native app */}
    {!MOBILE && <Section title={t('Tip')}>
      <Row icon="lightbulb" iconTint="var(--yellow)"
        title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')}
        subtitle={t('to install VantixGym as a full-screen app.') + ' ' + (user ? t('Your data syncs with your profile — sign in anywhere to see it.') : t('Guest data stays on this device — export a backup now and then!'))} />
    </Section>}

    </details>

    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      VantixGym · {t('built on openGym, open source (AGPL v3)')}<br />
      <a href="#/terms">{t('terms of service')}</a> · <a href="#/privacy">{t('privacy policy')}</a> · <a href={REPO} target="_blank" rel="noopener">{t('source code')}</a> · exercise data: hasaneyldrm/exercises-dataset (CC)
    </div>
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left — went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy — warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2

function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left; RPE reads the same effort off a 10-point scale — so RPE ≈ 10 − RIR. Pick the one you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value — progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

// Bring-your-own AI key (see lib/ai.js). Lives in localStorage on this device only — never
// synced, never sent to the server. When set, the AI features call Anthropic directly.
// Server-paid AI: what this profile has used this month. Read-only, from /api/ai/usage.
function AIUsageRow() {
  const [u, setU] = useState(null)
  useEffect(() => { api('/api/ai/usage').then(setU).catch(() => setU(null)) }, [])
  if (!u || !u.calls) return null
  const usd = u.usd < 0.01 ? '< $0.01' : '$' + u.usd.toFixed(2)
  return <Row icon="sparkles" iconTint="var(--violet)" title={t('AI used this month')}
    subtitle={t('{0} calls · {1} tokens', u.calls, fmtNum((u.in + u.out) / 1000) + 'k') + (u.cap ? ' · ' + t('cap {0}', '$' + u.cap) : '')}
    value={usd} />
}

function AICard({ toast, user }) {
  const [key, setKey] = useState(getAIKey())
  const [model, setModel] = useState(getAIModel())
  const [busy, setBusy] = useState(false)
  // Does this server pay for AI itself? Then the whole section is operator business: customers
  // just get the features, with nothing to configure or read. null = not known yet, so the
  // section doesn't flash in and out while /api/config loads.
  const [serverAi, setServerAi] = useState(STATIC ? false : null)
  const [showKey, setShowKey] = useState(false)
  useEffect(() => { if (!STATIC) api('/api/config').then(c => setServerAi(!!c.ai)).catch(() => setServerAi(false)) }, [])
  const saved = getAIKey()
  const has = hasUserKey()
  const dirty = key.trim() !== saved
  const save = () => { setAIKey(key.trim()); toast(key.trim() ? t('API key saved on this device') : t('API key cleared')); setKey(getAIKey()) }
  const clear = () => { setAIKey(''); setKey(''); toast(t('API key cleared')) }
  const changeModel = m => { setModel(m); setAIModel(m) }
  const test = async () => {
    setBusy(true)
    try { await testAIKey(); toast(t('Key works — AI is ready')) }
    catch (e) { toast(e.message || t('Test failed')) }
    setBusy(false)
  }
  const keyField = !serverAi || has || showKey
  if (serverAi === null) return null
  if (serverAi && !user?.admin) return null
  return <Section title={t('AI features')}
    footer={has
      ? t('AI runs on your own Anthropic key, straight from this device — the server never sees it, and it works even with no backend.')
      : serverAi
        ? t('AI is included here: set parsing, the coach, exercise swaps, photo ID, meal photos and diet-plan import all work out of the box. Adding your own key is optional — it moves the cost to your Anthropic account.')
        : t('Add your own Anthropic API key to power set parsing, the coach, exercise swaps, photo ID and meal photos. Stored only on this device.')}>
    {serverAi && !has && <Row icon="sparkles" iconTint="var(--violet)" title={t('AI features')} subtitle={t('Included on this server')} value={t('On')} />}
    {serverAi && !has && !showKey && <Row icon="key" iconTint="var(--violet)" title={t('Use my own Anthropic key')} subtitle={t('Optional — bills your own account instead')} accessory="chevron" onClick={() => setShowKey(true)} />}
    {keyField && <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingTop: 13, paddingBottom: 14 }}>
      <span className="lrow-t row" style={{ gap: 7 }}><Icon name="key" style={{ color: 'var(--violet)' }} />{t('Anthropic API key')}</span>
      <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…"
        value={key} onChange={e => setKey(e.target.value)} />
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" variant="primary" disabled={!dirty} onClick={save}>{t('Save')}</Button>
        <Button size="sm" disabled={!has || busy} onClick={test}>{busy ? t('Testing…') : t('Test')}</Button>
        <Button size="sm" variant="danger" disabled={!has} onClick={clear}>{t('Clear')}</Button>
      </div>
      <a className="small" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style={{ color: 'var(--acc)' }}>{t('Get a key from the Anthropic Console →')}</a>
    </div>}
    {has && <SelectRow icon="sparkles" iconTint="var(--violet)" title={t('AI model')}
      value={model} onChange={changeModel} options={AI_MODELS} />}
    {!has && !STATIC && <AIUsageRow />}
  </Section>
}

function NotificationsCard({ S, update, toast }) {
  if (MOBILE) return <MobileReminderCard S={S} update={update} toast={toast} />
  return <PushCard S={S} update={update} toast={toast} />
}

// Mobile build: the reminder is a native local notification scheduled on planned weekdays —
// no push server involved. The schedule itself is (re)synced by the store on every persist;
// this card only owns the OS permission prompt when the switch turns on.
function MobileReminderCard({ S, update, toast }) {
  const setReminder = patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })
  const toggle = async () => {
    const on = !S.reminder?.on
    if (on) {
      const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    setReminder({ on })
  }
  return (
    <Section title={t('Notifications')}
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
      <Row icon="camera" iconTint="var(--acc)" title={t('Monthly photo reminder')} subtitle={t('Four weeks after each check-in, at 10:00')}>
        <Switch checked={S.photoReminder !== false} onChange={async () => {
          const on = S.photoReminder === false
          if (on) { const ok = await syncReminder({ ...S, photoReminder: true }, true); if (!ok) { toast(t('Could not change notification settings')); return } }
          update(s => { s.photoReminder = on })
        }} />
      </Row>
      <NutritionNudges S={S} update={update} toast={toast} />
    </Section>
  )
}

// Eating reminders. Each one only fires for something you have not done yet today, and quiet
// hours silence the whole set — the point is to help, not to nag.
function NutritionNudges({ S, update, toast }) {
  const n = nudgesOf(S)
  const set = async patch => {
    const next = { ...n, ...patch }
    const turningOn = Object.entries(patch).some(([k, v]) => v === true && n[k] !== true)
    if (turningOn) { const ok = await syncReminder({ ...S, nudges: next }, true); if (!ok) { toast(t('Could not change notification settings')); return } }
    update(s => { s.nudges = { ...NUDGE_DEF, ...(s.nudges || {}), ...patch } })
  }
  const any = n.meals || n.water || n.protein || n.supplements
  return <>
    <Row icon="utensils" iconTint="var(--orange)" title={t('Meal reminders')} subtitle={t('Breakfast, lunch and dinner you have not logged')}>
      <Switch checked={n.meals} onChange={v => set({ meals: v })} />
    </Row>
    <Row icon="droplet" iconTint="var(--blue)" title={t('Water reminder')} subtitle={t('Mid-afternoon, only if you are behind')}>
      <Switch checked={n.water} onChange={v => set({ water: v })} />
    </Row>
    <Row icon="flame" iconTint="var(--red)" title={t('Evening protein check')} subtitle={t('At 19:30, if you are short on protein')}>
      <Switch checked={n.protein} onChange={v => set({ protein: v })} />
    </Row>
    <Row icon="sparkles" iconTint="var(--purple)" title={t('Supplement reminders')} subtitle={t('At the times you set for each one')}>
      <Switch checked={n.supplements} onChange={v => set({ supplements: v })} />
    </Row>
    {any && <Row icon="moon" iconTint="var(--purple)" title={t('Quiet hours')} subtitle={t('Nothing is sent inside this window')}>
      <span className="row" style={{ gap: 6 }}>
        <input type="time" className="timef" value={n.quietFrom} onChange={e => set({ quietFrom: e.target.value })} />
        <input type="time" className="timef" value={n.quietTo} onChange={e => set({ quietTo: e.target.value })} />
      </span>
    </Row>}
  </>
}

function PushCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setOn(!!sub)).catch(() => {})
  }, [supported])

  const toggle = async v => {
    setBusy(true)
    try {
      if (!v) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { toast(e.message || t('Test failed')) }
  }

  if (!supported) return (
    <Section title={t('Notifications')}>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')} />
    </Section>
  )

  return <>
    <Section
      title={t('Notifications')}
      footer={on && S.reminder?.on
        ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '')
        : null}
    >
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} subtitle={t('Rest-timer alerts, even if VantixGym is closed.')}>
        <Switch checked={on} disabled={busy} onChange={toggle} />
      </Row>
      {on && (
        <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
          <Switch checked={!!S.reminder?.on} onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </Row>
      )}
      {on && (
        <Row icon="camera" iconTint="var(--acc)" title={t('Monthly photo reminder')} subtitle={t('Four weeks after each check-in, at 10:00')}>
          <Switch checked={S.photoReminder !== false} onChange={() => update(s => { s.photoReminder = s.photoReminder === false })} />
        </Row>
      )}
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>
}

// The same registration as the sign-in screen's, reached from Settings instead. It asks for
// the invite code on the same terms: an invite-only instance rejects a registration without
// one, so a form that cannot collect it is a form that cannot succeed.
function RegisterInline({ close, setUser, pushState, pullState, toast }) {
  const nameRef = useRef(null)
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = (nameRef.current.value || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim()); setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

/* ---------- account sheets ---------- */
function SubscriptionSheet({ user, close }) {
  const toast = useUI(s => s.toast)
  const b = user.billing || {}
  const portal = () => billingPortal().then(r => { if (r.url) (r.store ? window.open(r.url, '_blank', 'noopener') : window.location.href = r.url) }).catch(e => toast(e.message))
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="crown" style={{ color: 'var(--yellow)' }} />{t('Subscription')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{subscriptionLabel(b)}</div>
    {b.status === 'pro' ? <>
      <div className="small muted" style={{ marginBottom: 12 }}>{b.provider === 'apple' ? t('This plan is billed through your Apple ID. Change or cancel it in App Store → Subscriptions. Access always runs to the end of the period you paid for.') : b.provider === 'google' ? t('This plan is billed through Google Play. Change or cancel it in Play Store → Subscriptions. Access always runs to the end of the period you paid for.') : t('Change your card, switch plan or cancel from the billing portal. Access always runs to the end of the period you paid for.')}</div>
      <Button variant="primary" icon="crown" onClick={() => { close(); goto('/plans') }}>{t('Change plan')}</Button>
      <div style={{ height: 8 }} />
      {/* cancelling always happens where the money is taken — the store or the Stripe portal */}
      <Button variant="danger" icon="xmark" onClick={portal}>{b.provider === 'apple' ? t('Cancel in App Store') : b.provider === 'google' ? t('Cancel in Google Play') : t('Cancel subscription')}</Button>
      {b.cancelAtPeriodEnd && <div className="small muted" style={{ marginTop: 10 }}>{t('Already cancelled — you keep access until {0}.', new Date(b.tierUntil).toLocaleDateString())}</div>}
    </> : <>
      {!user.emailVerified && <div className="card small" style={{ marginBottom: 12 }}>{t('Confirm your email before paying — the link is in your inbox.')}</div>}
      <Plans compact />
    </>}
  </>
}

function PasswordSheet({ user, close }) {
  const toast = useUI(s => s.toast)
  const refreshMe = useStore(s => s.refreshMe)
  const [email, setEmail] = useState(user.email || '')
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const linking = !user.hasPassword
  const go = async e => {
    e.preventDefault()
    if (next.length < 8) return toast(t('Use at least 8 characters'))
    setBusy(true)
    try {
      if (linking) await authChangeEmail(email.trim(), next)
      else await authChangePassword(cur, next)
      await refreshMe(); toast(linking ? t('Saved — confirm the email we just sent you') : t('Password updated — other devices were signed out')); close()
    } catch (err) { toast(err.message || t('Something went wrong — try again')) }
    setBusy(false)
  }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="key" style={{ color: 'var(--blue)' }} />{linking ? t('Add email and password') : t('Change password')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{linking ? t('So you can sign in on any device and recover the account.') : t('At least 8 characters. Every other device is signed out afterwards.')}</div>
    <form onSubmit={go} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {linking && <TextField type="email" autoComplete="email" placeholder={t('Email')} value={email} onChange={e => setEmail(e.target.value)} />}
      {!linking && <TextField type="password" autoComplete="current-password" placeholder={t('Current password')} value={cur} onChange={e => setCur(e.target.value)} />}
      <TextField type="password" autoComplete="new-password" placeholder={t('New password')} value={next} onChange={e => setNext(e.target.value)} />
      <Button type="submit" variant="primary" disabled={busy}>{busy ? t('Saving…') : t('Save')}</Button>
    </form>
  </>
}

function DeleteSheet({ user, close }) {
  const toast = useUI(s => s.toast)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async e => {
    e.preventDefault(); setBusy(true)
    try { await deleteAccount(pw); close(); clearLocalAfterDelete() }
    catch (err) { toast(err.message || t('Something went wrong — try again')) }
    setBusy(false)
  }
  const clearLocalAfterDelete = () => { useStore.getState().setUser(null); try { localStorage.removeItem('gym_state_v1'); localStorage.removeItem('gym_dirty') } catch {} ; window.location.hash = '#/'; window.location.reload() }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="trash" style={{ color: 'var(--red)' }} />{t('Delete account')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.5 }}>{t('Your account is signed out everywhere and hidden right away, and erased for good after 30 days. Any subscription is cancelled. If you change your mind, just sign in again within those 30 days.')}</div>
    <form onSubmit={go} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {user.hasPassword && <TextField type="password" autoComplete="current-password" placeholder={t('Your password')} value={pw} onChange={e => setPw(e.target.value)} />}
      <Button type="submit" variant="danger" disabled={busy || (user.hasPassword && !pw)}>{busy ? t('Deleting…') : t('Delete my account')}</Button>
    </form>
  </>
}

/* ---------- Apple Health / Health Connect (store builds) ---------- */
function HealthCard({ S, update, toast }) {
  const [busy, setBusy] = useState(false)
  const [avail, setAvail] = useState(null)
  useEffect(() => { healthAvailable().then(setAvail) }, [])
  const name = IS_IOS_SHELL ? t('Apple Health') : t('Health Connect')
  const on = !!S.health?.on
  const connect = async () => {
    setBusy(true)
    try {
      if (avail === false && !IS_IOS_SHELL) { await installHealthConnect(); setBusy(false); return }
      await requestHealth()
      const r = await syncHealth(update)
      toast(r ? t('Connected — {0} days of steps and {1} weigh-ins imported', r.days, r.weights) : t('Connected'))
    } catch (e) { toast(e.message || t('Could not connect')) }
    setBusy(false)
  }
  const sync = async () => {
    setBusy(true)
    try { const r = await syncHealth(update); toast(t('Synced — {0} days of steps and {1} weigh-ins', r.days, r.weights)) }
    catch (e) { toast(e.message || t('Something went wrong — try again')) }
    setBusy(false)
  }
  const off = () => update(s => { s.health = { ...(s.health || {}), on: false } })
  return <Section title={t('Health')} footer={on
    ? t('Steps and body weight come in from {0} every time you open the app. Days from your phone replace manual entries; weights you typed are kept.', name)
    : t('Bring your steps and body weight in from {0} — the phone, your watch and your scale already count them.', name)}>
    {!on && <Row icon="heart" iconTint="var(--red)" title={t('Connect {0}', name)} subtitle={avail === false && !IS_IOS_SHELL ? t('Health Connect is not installed — tap to get it') : t('Steps and weight, read-only')} accessory="chevron" onClick={busy ? undefined : connect} />}
    {on && <>
      <Row icon="heart" iconTint="var(--red)" title={t('{0} connected', name)} subtitle={S.health?.at ? t('Last sync {0}', new Date(S.health.at).toLocaleString()) : ''} value={t('On')} />
      <Row icon="reset" iconTint="var(--blue)" title={busy ? t('Syncing…') : t('Sync now')} accessory="chevron" onClick={busy ? undefined : sync} />
      <Row icon="xmark" iconTint="var(--grey)" title={t('Disconnect')} onClick={off} />
    </>}
  </Section>
}

/* ---------- referrals ---------- */
function ReferralSheet({ close }) {
  const toast = useUI(s => s.toast)
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { fetchReferral().then(setD).catch(e => setErr(e.message || t('Something went wrong — try again'))) }, [])
  const msg = d ? t('Join me on VantixGym — with my code {0} you get {1} days free instead of {2}: {3}', d.code, d.trialDays + d.refereeBonusDays, d.trialDays, d.link) : ''
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'VantixGym', text: msg })
      else { await navigator.clipboard.writeText(msg); toast(t('Copied')) }
    } catch (e) { if (e.name !== 'AbortError') { try { await navigator.clipboard.writeText(msg); toast(t('Copied')) } catch { toast(msg) } } }
  }
  const copyCode = async () => { try { await navigator.clipboard.writeText(d.code); toast(t('Code copied')) } catch { toast(d.code) } }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="star" style={{ color: 'var(--acc)' }} />{t('Invite & earn')}</h3>
    {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}
    {!d && !err && <div className="small dim">{t('Loading…')}</div>}
    {d && <>
      <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>{t('Your friend signs up with your code and gets {0} days free instead of {1}. When they pick a plan, you get {2} days added to your access. No limit.', d.trialDays + d.refereeBonusDays, d.trialDays, d.referrerDays)}</div>
      <button className="ref-code tappable" onClick={copyCode} aria-label={t('Code copied')}><span>{d.code}</span><Icon name="clipboard" /></button>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <Button variant="primary" icon="upload" style={{ flex: 1 }} onClick={share}>{t('Share')}</Button>
        <Button icon="link" style={{ flex: 1 }} onClick={async () => { try { await navigator.clipboard.writeText(d.link); toast(t('Link copied')) } catch { toast(d.link) } }}>{t('Copy link')}</Button>
      </div>
      <div className="tiles" style={{ marginTop: 16 }}>
        <div className="tile"><div className="l">{t('Friends joined')}</div><div className="v">{d.invited}</div></div>
        <div className="tile"><div className="l">{t('Subscribed')}</div><div className="v">{d.converted}</div></div>
        <div className="tile" style={{ gridColumn: '1 / -1' }}><div className="l">{t('Days earned')}</div><div className="v">{d.earnedDays}</div></div>
      </div>
    </>}
  </>
}
