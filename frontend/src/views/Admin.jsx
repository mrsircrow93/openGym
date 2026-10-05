import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, passkeyStepUp } from '../lib/api.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Switch } from '../components/ui.jsx'

// Operations console (docs/ADMIN_PANEL.md). Web only, English only — it is an internal tool,
// not part of the translated end-user surface. Every call is re-checked server-side: role,
// step-up (12 h, bound to this browser), rate limit, and an audit entry for each mutation.

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - (typeof ts === 'string' ? Date.parse(ts) : ts)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
}
const when = iso => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const money = (n, cur = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0)
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) })
const SECTIONS = [
  ['overview', 'Overview', 'chart', 'overview.read'], ['users', 'Users', 'person', 'users.read'], ['billing', 'Billing', 'crown', 'billing.read'],
  ['coupons', 'Coupons', 'sparkles', 'coupons.read'], ['ai', 'AI', 'sparkles', 'ai.read'], ['team', 'Team', 'heart', 'team.read'], ['audit', 'Audit', 'shield', 'audit.read'],
  ['logs', 'Logs', 'list', 'logs.read'], ['system', 'System', 'wrench', 'system.read']
]
const Pill = ({ children, tone }) => <span className={'adm-pill' + (tone ? ' ' + tone : '')}>{children}</span>
const Stat = ({ label, value, sub, tone }) => <div className="adm-stat"><div className="adm-stat-l">{label}</div><div className={'adm-stat-v' + (tone ? ' ' + tone : '')}>{value}</div>{sub && <div className="adm-stat-s">{sub}</div>}</div>
const statusTone = s => (s === 'pro' ? 'ok' : s === 'trial' ? 'info' : s === 'expired' ? 'warn' : '')

function useLoad(path, deps = []) {
  const [data, setData] = useState(null); const [err, setErr] = useState(null)
  const reload = () => { setErr(null); return api(path).then(setData).catch(e => setErr(e)) }
  useEffect(() => { reload() }, deps)
  return [data, reload, err]
}

/* ---------------- step-up gate ---------------- */
function StepUp({ me, onDone }) {
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const go = async e => {
    e?.preventDefault(); setBusy(true); setErr('')
    try { await post('/api/admin/stepup', { password: pw }); onDone() } catch (x) { setErr(x.message || 'Verification failed') }
    setBusy(false)
  }
  const pk = async () => { setBusy(true); setErr(''); try { await passkeyStepUp(); onDone() } catch (x) { setErr(x.message || 'Passkey check failed') } setBusy(false) }
  return <div className="adm-gate">
    <div className="adm-gate-card">
      <Icon name="shield" style={{ fontSize: 34, color: 'var(--acc)' }} />
      <h2>Confirm it’s you</h2>
      <p className="muted small">The console needs a fresh check every 12 hours, on each browser. Your role: <b>{me.role}</b>.</p>
      {me.hasPassword && <form onSubmit={go} className="adm-form">
        <input className="field" type="password" autoComplete="current-password" placeholder="Account password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        <Button type="submit" variant="primary" disabled={busy || !pw}>{busy ? 'Checking…' : 'Continue'}</Button>
      </form>}
      {me.hasPasskey && <Button onClick={pk} disabled={busy} icon="key">Use my passkey</Button>}
      {!me.hasPassword && !me.hasPasskey && <p className="small" style={{ color: 'var(--red)' }}>Add a password or a passkey to your account first (Settings).</p>}
      {err && <p className="small" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  </div>
}

/* ---------------- overview ---------------- */
function Overview({ go }) {
  const [d, reload, err] = useLoad('/api/admin/overview')
  useEffect(() => { const iv = setInterval(reload, 30000); return () => clearInterval(iv) }, [])
  if (err) return <ErrorBox err={err} />
  if (!d) return <Loading />
  const st = d.status || {}
  return <>
    <div className="adm-grid4">
      <Stat label="MRR (estimate)" value={money(d.mrr, d.currency)} sub={`${st.pro || 0} paying · ${d.cancelling} cancelling`} tone="ok" />
      <Stat label="Trials" value={st.trial || 0} sub={`${d.signups7d} sign-ups this week`} tone="info" />
      <Stat label="Trial → paid (7 d cohort)" value={d.conversion7d === null ? '—' : d.conversion7d + '%'} sub={`${d.cohort7d} accounts older than 7 d`} />
      <Stat label="Active" value={`${d.dau} / ${d.wau} / ${d.mau}`} sub="day / week / month" />
      <Stat label="Users" value={d.users} sub={`${d.verified} verified · ${d.staff} staff · ${d.live} training now`} />
      <Stat label="AI spend" value={'$' + d.ai.usd} sub={`${d.ai.calls} calls in ${d.ai.month}${d.ai.capGlobal ? ' · cap $' + d.ai.capGlobal : ''}`} tone={d.ai.capGlobal && d.ai.usd > d.ai.capGlobal * 0.8 ? 'warn' : ''} />
      <Stat label="Last backup" value={d.backup ? rel(d.backup.at) : 'none'} sub={d.backup ? (d.backup.s3 ? 'copied to S3' : 'local only') : 'see System'} tone={d.backup && Date.now() - Date.parse(d.backup.at) < 2 * 86400000 ? 'ok' : 'warn'} />
      <Stat label="By provider" value={Object.entries(d.provider).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'} sub={Object.entries(d.plan).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no paid plans yet'} />
    </div>
    <div className="adm-card">
      <div className="adm-card-h"><h3>Needs a human</h3><span className="muted small">{d.attention.length} items</span></div>
      {!d.attention.length && <div className="dim small">Nothing pending. Nice.</div>}
      {d.attention.map((a, i) => <div key={i} className="adm-row" onClick={() => a.id && go('users', a.id)} style={a.id ? { cursor: 'pointer' } : null}>
        <Pill tone={a.kind === 'past_due' || a.kind === 'webhook' ? 'warn' : ''}>{a.kind}</Pill>
        <div className="grow"><b>{a.name || 'System'}</b> <span className="muted">· {a.detail}</span></div>
        {a.id && <Icon name="chevronRight" />}
      </div>)}
    </div>
    {(d.flags.signups === false || d.flags.ai === false || d.flags.payments === false || d.flags.banner) && <div className="adm-card warn">
      <b>Kill switches active:</b> {['signups', 'ai', 'payments'].filter(k => d.flags[k] === false).join(', ') || 'none'}{d.flags.banner ? ` · banner “${d.flags.banner}”` : ''} — <button className="linkbtn" onClick={() => go('system')}>System</button>
    </div>}
  </>
}

/* ---------------- users ---------------- */
function Users({ perms, focusId }) {
  const [qText, setQ] = useState(''); const [status, setStatus] = useState(''); const [provider, setProvider] = useState('')
  const [sel, setSel] = useState(focusId || null)
  const path = `/api/admin/users?q=${encodeURIComponent(qText)}&status=${status}&provider=${provider}`
  const [d, reload, err] = useLoad(path, [qText, status, provider])
  useEffect(() => { if (focusId) setSel(focusId) }, [focusId])
  if (err) return <ErrorBox err={err} />
  return <div className="adm-split">
    <div className="adm-list-pane">
      <div className="adm-filters">
        <input className="field" placeholder="Search name, email or id" value={qText} onChange={e => setQ(e.target.value)} />
        <select className="field" value={status} onChange={e => setStatus(e.target.value)}><option value="">Any status</option><option value="trial">Trial</option><option value="pro">Paying</option><option value="expired">Expired</option><option value="free">Staff / free</option></select>
        <select className="field" value={provider} onChange={e => setProvider(e.target.value)}><option value="">Any provider</option><option value="stripe">Stripe</option><option value="apple">Apple</option><option value="google">Google</option><option value="comp">Comp</option></select>
      </div>
      {!d ? <Loading /> : <div className="adm-table">
        <div className="adm-tr adm-th"><span>User</span><span>Plan</span><span>Last seen</span><span>Data</span></div>
        {d.users.map(u => <div key={u.id} className={'adm-tr' + (sel === u.id ? ' sel' : '') + (u.disabled ? ' off' : '')} onClick={() => setSel(u.id)}>
          <span className="adm-user"><b>{u.live && <i className="adm-dot" />}{u.name}</b><small>{u.email || u.id}{u.role ? ' · ' + u.role : ''}</small></span>
          <span><Pill tone={statusTone(u.billing.status)}>{u.billing.status}{u.billing.plan ? ' · ' + u.billing.plan : ''}</Pill>{u.billing.provider && <small className="dim"> {u.billing.provider}{u.storeSandbox ? ' (sandbox)' : ''}</small>}</span>
          <span className="small">{rel(u.lastSync)}</span>
          <span className="small dim">{u.workouts} wo{u.hasPush ? ' · push' : ''}{!u.emailVerified && u.email ? ' · unverified' : ''}</span>
        </div>)}
        {!d.users.length && <div className="empty small">No matches.</div>}
      </div>}
    </div>
    <div className="adm-detail-pane">{sel ? <UserDetail id={sel} perms={perms} onChanged={reload} /> : <div className="dim small" style={{ padding: 24 }}>Select a user.</div>}</div>
  </div>
}

function UserDetail({ id, perms, onChanged }) {
  const toast = useUI(s => s.toast)
  const [d, reload, err] = useLoad('/api/admin/user?id=' + encodeURIComponent(id), [id])
  const [days, setDays] = useState(7); const [note, setNote] = useState('')
  if (err) return <ErrorBox err={err} />
  if (!d) return <Loading />
  const u = d.user, b = u.billing
  const act = (action, extra = {}, confirm) => {
    const run = () => post('/api/admin/user/action', { id: u.id, action, ...extra }).then(() => { toast('Done'); reload(); onChanged() }).catch(e => toast(e.message))
    if (confirm) confirmSheet({ title: confirm, message: 'This is recorded in the audit log.', confirmText: 'Confirm', danger: true, onConfirm: run }); else run()
  }
  const canW = perms['users.write'], canD = perms['users.delete']
  return <div className="adm-detail">
    <div className="adm-card-h"><h3>{u.name} {u.role && <Pill tone="info">{u.role}</Pill>}{u.disabled && <Pill tone="warn">disabled</Pill>}{u.deletedAt && <Pill tone="warn">deleting</Pill>}</h3><span className="muted small">{u.id}</span></div>
    <div className="adm-kv">
      <div><span>Email</span><b>{u.email || '—'} {u.email && (u.emailVerified ? <Pill tone="ok">verified</Pill> : <Pill tone="warn">unverified</Pill>)}</b></div>
      <div><span>Joined</span><b>{when(u.created)}</b></div>
      <div><span>Sign-in</span><b>{[u.hasPassword && 'password', u.hasPasskey && 'passkey', u.hasGoogle && 'Google', u.hasApple && 'Apple'].filter(Boolean).join(', ') || '—'}</b></div>
      <div><span>Status</span><b><Pill tone={statusTone(b.status)}>{b.status}</Pill> {u.plan || ''} {u.provider ? 'via ' + u.provider : ''}{u.cancelAtPeriodEnd ? ' · cancels at period end' : ''}{u.subscriptionStatus ? ' · ' + u.subscriptionStatus : ''}</b></div>
      <div><span>Trial ends</span><b>{when(u.trialEnds)}</b></div>
      <div><span>Access until</span><b>{when(u.tierUntil)}</b></div>
      <div><span>Stripe</span><b>{u.stripeCustomer || '—'} {u.stripeSubscription ? '· ' + u.stripeSubscription : ''}</b></div>
      <div><span>Referrals</span><b>{u.referrals} invited{u.referralEarnedDays ? ' · earned ' + u.referralEarnedDays + ' d' : ''}{u.referredBy ? ' · was referred' : ''}</b></div>
      <div><span>Data</span><b>{d.counts.workouts} workouts · {d.counts.meals} meals · {d.counts.bodyweight} weigh-ins · {d.counts.photos} photos · synced {rel(d.lastSync)}</b></div>
      <div><span>AI this month</span><b>{d.ai.calls || 0} calls · ${(d.ai.usd || 0).toFixed(2)}</b></div>
    </div>
    {canW && <div className="adm-actions">
      {u.email && !u.emailVerified && <Button size="sm" onClick={() => act('resend_verify')}>Resend verification</Button>}
      <span className="adm-inline"><input className="field" type="number" min="1" max="366" value={days} onChange={e => setDays(e.target.value)} style={{ width: 70 }} />
        <Button size="sm" onClick={() => act('extend_trial', { days: +days })}>Extend trial</Button>
        <Button size="sm" onClick={() => act('comp_days', { days: +days })}>Comp days</Button></span>
      {u.provider === 'stripe' && <Button size="sm" onClick={() => act('stripe_pull')}>Re-pull Stripe</Button>}
      {(u.provider === 'apple' || u.provider === 'google') && <Button size="sm" onClick={() => act('rc_sync')}>Re-sync store</Button>}
      <Button size="sm" onClick={() => act('signout_all', {}, 'Sign ' + u.name + ' out everywhere?')}>Sign out everywhere</Button>
      {!u.disabled ? <Button size="sm" variant="danger" onClick={() => act('disable', {}, 'Disable ' + u.name + '?')}>Disable</Button> : <Button size="sm" variant="primary" onClick={() => act('enable')}>Enable</Button>}
      {canD && !u.deletedAt && !u.role && <Button size="sm" variant="danger" onClick={() => act('delete', {}, 'Delete ' + u.name + ' (30-day grace)?')}>Delete</Button>}
      {canD && u.deletedAt && <Button size="sm" onClick={() => act('undelete')}>Restore</Button>}
      {canD && <a className="btn sm" href={'/api/admin/user/export?id=' + encodeURIComponent(u.id)} target="_blank" rel="noopener">Export JSON</a>}
    </div>}
    <h4 className="sec">Notes</h4>
    {(d.notes || []).map((n, i) => <div key={i} className="adm-note"><span className="dim small">{when(n.t)} · {n.by}</span><div>{n.text}</div></div>)}
    {canW && <form className="adm-inline" onSubmit={e => { e.preventDefault(); if (note.trim()) { act('note', { text: note }); setNote('') } }}>
      <input className="field grow" placeholder="Internal note (visible to staff only)" value={note} onChange={e => setNote(e.target.value)} /><Button size="sm" type="submit">Add</Button></form>}
    <h4 className="sec">Recent workouts</h4>
    {d.workouts.length ? d.workouts.slice(0, 15).map(w => <div key={w.id} className="adm-row small"><span className="grow"><b>{w.name}</b> · {fmtDate(w.d, true)}</span><span className="dim">{w.sets} sets{w.prs ? ' · ' + w.prs + ' PR' : ''}</span></div>) : <div className="dim small">None yet.</div>}
    {d.audit?.length > 0 && <><h4 className="sec">Audit trail</h4>{d.audit.slice(0, 20).map(e => <AuditRow key={e.id} e={e} />)}</>}
  </div>
}

/* ---------------- billing ---------------- */
function Billing({ perms }) {
  const toast = useUI(s => s.toast)
  const [d, reload, err] = useLoad('/api/admin/billing')
  if (err) return <ErrorBox err={err} />
  if (!d) return <Loading />
  const refund = inv => confirmSheet({ title: `Refund ${money(inv.total, inv.currency.toUpperCase())} to ${inv.userName || inv.customer}?`, message: 'Full refund through Stripe. Access is not revoked automatically — disable or adjust the user afterwards if needed. Audited.', confirmText: 'Refund', danger: true,
    onConfirm: () => post('/api/admin/billing/refund', { charge: inv.charge }).then(() => { toast('Refunded'); reload() }).catch(e => toast(e.message)) })
  const s = d.stripe
  return <>
    <div className="adm-grid4">
      <Stat label="Stripe" value={s.configured ? 'connected' : 'not configured'} sub={s.health ? `last event ${rel(s.health.lastEventAt)} · ${s.health.lastType || ''}` : 'no webhook event yet'} tone={s.health?.lastError ? 'warn' : s.configured ? 'ok' : ''} />
      <Stat label="RevenueCat" value={d.revenuecat.configured ? 'connected' : 'webhook only'} sub={d.revenuecat.health ? `last event ${rel(d.revenuecat.health.lastEventAt)} · ${d.revenuecat.health.lastType || ''}` : 'no webhook event yet'} tone={d.revenuecat.health?.lastError ? 'warn' : 'ok'} />
      <Stat label="Stripe balance" value={s.balance ? s.balance.available.map(b => money(b.amount, b.currency.toUpperCase())).join(' · ') || money(0) : '—'} sub={s.balance ? 'pending ' + (s.balance.pending.map(b => money(b.amount, b.currency.toUpperCase())).join(' · ') || money(0)) : ''} />
      <Stat label="Failed payments" value={d.pastDue.length} sub="past_due, Stripe retrying" tone={d.pastDue.length ? 'warn' : 'ok'} />
    </div>
    {(s.health?.lastError || d.revenuecat.health?.lastError) && <div className="adm-card warn"><b>Webhook errors:</b> {s.health?.lastError || ''} {d.revenuecat.health?.lastError || ''}</div>}
    {s.error && <div className="adm-card warn">Stripe API: {s.error}</div>}
    {s.subscriptions && <div className="adm-card"><div className="adm-card-h"><h3>Stripe subscriptions</h3><span className="muted small">{s.subscriptions.length}</span></div>
      <div className="adm-table"><div className="adm-tr adm-th c5"><span>User</span><span>Status</span><span>Plan</span><span>Period end</span><span>Created</span></div>
        {s.subscriptions.map(x => <div key={x.id} className="adm-tr c5"><span><b>{x.userName || '—'}</b><small>{x.id}</small></span><span><Pill tone={x.status === 'active' ? 'ok' : x.status === 'trialing' ? 'info' : 'warn'}>{x.status}{x.cancelAtPeriodEnd ? ' · cancels' : ''}</Pill></span><span>{x.plan || '—'}</span><span className="small">{x.periodEnd ? fmtDate(new Date(x.periodEnd).toISOString().slice(0, 10)) : '—'}</span><span className="small dim">{fmtDate(new Date(x.created).toISOString().slice(0, 10))}</span></div>)}
      </div></div>}
    {s.invoices && <div className="adm-card"><div className="adm-card-h"><h3>Recent invoices</h3></div>
      <div className="adm-table"><div className="adm-tr adm-th c5"><span>User</span><span>Status</span><span>Total</span><span>Date</span><span></span></div>
        {s.invoices.map(i => <div key={i.id} className="adm-tr c5"><span><b>{i.userName || '—'}</b><small>{i.number || i.id}</small></span><span><Pill tone={i.status === 'paid' ? 'ok' : i.status === 'open' ? 'warn' : ''}>{i.status}</Pill></span><span>{money(i.total, i.currency.toUpperCase())}</span><span className="small">{fmtDate(new Date(i.created).toISOString().slice(0, 10))}</span>
          <span className="adm-inline">{i.hostedUrl && <a className="linkbtn small" href={i.hostedUrl} target="_blank" rel="noopener">view</a>}{perms['billing.write'] && i.status === 'paid' && i.charge && <button className="linkbtn small" style={{ color: 'var(--red)' }} onClick={() => refund(i)}>refund</button>}</span></div>)}
      </div></div>}
    <div className="adm-card"><div className="adm-card-h"><h3>Store subscriptions (Apple / Google)</h3><span className="muted small">{d.store.length}</span></div>
      {d.store.length ? d.store.map(x => <div key={x.id} className="adm-row small"><span className="grow"><b>{x.name}</b> · {x.provider} · {x.plan}{x.sandbox ? ' · sandbox' : ''}{x.cancel ? ' · cancels' : ''}</span><span className="dim">until {when(x.tierUntil)}</span></div>) : <div className="dim small">None yet. Refunds for store purchases happen in App Store Connect / Play Console.</div>}
    </div>
  </>
}

/* ---------------- coupons ---------------- */
function Coupons({ perms }) {
  const toast = useUI(s => s.toast)
  const [d, reload, err] = useLoad('/api/admin/coupons')
  const [f, setF] = useState({ name: '', code: '', percent: 20, amount: '', duration: 'once', months: 3, max: '', redeemBy: '', firstTime: true })
  if (err) return <ErrorBox err={err} />
  if (!d) return <Loading />
  const create = e => { e.preventDefault(); post('/api/admin/coupons', f).then(r => { toast('Created' + (r.promo ? ' · code ' + r.promo.code : '')); setF({ ...f, name: '', code: '' }); reload() }).catch(x => toast(x.message)) }
  const off = id => confirmSheet({ title: 'Deactivate ' + id + '?', message: 'Existing redemptions keep their discount.', confirmText: 'Deactivate', danger: true, onConfirm: () => post('/api/admin/coupons/deactivate', { id }).then(() => { toast('Deactivated'); reload() }).catch(x => toast(x.message)) })
  if (!d.configured) return <div className="adm-card">Stripe is not configured on this server, so there is nothing to manage here.</div>
  return <>
    {perms['coupons.write'] && <div className="adm-card"><div className="adm-card-h"><h3>New coupon</h3><span className="muted small">Stripe coupon + optional promo code · over 50 % needs an owner</span></div>
      <form onSubmit={create} className="adm-formgrid">
        <label>Name<input className="field" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Lanzamiento octubre" /></label>
        <label>Promo code (optional)<input className="field" value={f.code} onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="VANTIX20" /></label>
        <label>Percent off<input className="field" type="number" min="1" max="100" value={f.percent} onChange={e => setF({ ...f, percent: e.target.value, amount: '' })} /></label>
        <label>or amount off ({'MXN'})<input className="field" type="number" min="1" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value, percent: '' })} /></label>
        <label>Duration<select className="field" value={f.duration} onChange={e => setF({ ...f, duration: e.target.value })}><option value="once">First payment only</option><option value="repeating">For N months</option><option value="forever">Forever</option></select></label>
        {f.duration === 'repeating' && <label>Months<input className="field" type="number" min="1" max="12" value={f.months} onChange={e => setF({ ...f, months: e.target.value })} /></label>}
        <label>Max redemptions<input className="field" type="number" min="1" value={f.max} onChange={e => setF({ ...f, max: e.target.value })} placeholder="unlimited" /></label>
        <label>Expires<input className="field" type="date" value={f.redeemBy} onChange={e => setF({ ...f, redeemBy: e.target.value })} /></label>
        <label className="adm-check"><input type="checkbox" checked={f.firstTime} onChange={e => setF({ ...f, firstTime: e.target.checked })} /> First purchase only</label>
        <Button type="submit" variant="primary">Create</Button>
      </form></div>}
    <div className="adm-card"><div className="adm-card-h"><h3>Promo codes</h3><span className="muted small">{d.promos.length}</span></div>
      {d.promos.map(p => <div key={p.id} className="adm-row"><span className="grow"><b className="mono">{p.code}</b> <span className="dim small">coupon {p.coupon}{p.firstTime ? ' · first purchase' : ''}</span></span><span className="small">{p.redeemed}{p.max ? '/' + p.max : ''} used{p.expires ? ' · until ' + fmtDate(new Date(p.expires).toISOString().slice(0, 10)) : ''}</span><Pill tone={p.active ? 'ok' : ''}>{p.active ? 'active' : 'off'}</Pill>{perms['coupons.write'] && p.active && <button className="linkbtn small" onClick={() => off(p.id)}>deactivate</button>}</div>)}
      {!d.promos.length && <div className="dim small">No promo codes yet.</div>}
    </div>
    <div className="adm-card"><div className="adm-card-h"><h3>Coupons</h3><span className="muted small">{d.referralCoupon ? 'referral: ' + d.referralCoupon + ' · ' : ''}{d.rescueCoupon ? 'rescue: ' + d.rescueCoupon : 'no rescue coupon set'}</span></div>
      {d.coupons.map(c => <div key={c.id} className="adm-row"><span className="grow"><b>{c.name || c.id}</b> <span className="dim small">{c.id}</span></span><span className="small">{c.percent ? c.percent + '% off' : money(c.amount, (c.currency || 'mxn').toUpperCase()) + ' off'} · {c.duration}{c.months ? ' ' + c.months + ' mo' : ''}</span><span className="small dim">{c.redeemed}{c.max ? '/' + c.max : ''} used</span><Pill tone={c.valid ? 'ok' : ''}>{c.valid ? 'valid' : 'expired'}</Pill>{perms['coupons.write'] && c.valid && <button className="linkbtn small" onClick={() => off(c.id)}>delete</button>}</div>)}
    </div>
  </>
}

/* ---------------- AI usage & cost ---------------- */
function AI({ perms }) {
  const toast = useUI(s => s.toast)
  const [d, reload, err] = useLoad('/api/admin/ai')
  const [caps, setCaps] = useState(null)
  if (err) return <ErrorBox err={err} />
  if (!d) return <Loading />
  const usd = v => (v > 0 && v < 0.01 ? '< $0.01' : '$' + (+v || 0).toFixed(2))
  const cur = d.months[0]; const A = d.anthropic
  const c = caps ?? { user: d.caps.overrides.user ?? '', trial: d.caps.overrides.trial ?? '', global: d.caps.overrides.global ?? '' }
  const save = () => post('/api/admin/ai/caps', { user: c.user === '' ? null : +c.user, trial: c.trial === '' ? null : +c.trial, global: c.global === '' ? null : +c.global }).then(() => { toast('Caps saved'); setCaps(null); reload() }).catch(e => toast(e.message))
  const feats = Object.entries(d.features).sort((a, b) => b[1] - a[1])
  return <>
    <div className="adm-grid4">
      <Stat label={'Our estimate · ' + cur.month} value={usd(cur.usd)} sub={`${cur.calls} calls · ${cur.users} users · ${fmtNum(Math.round((cur.in + cur.out) / 1000))}k tokens`} />
      <Stat label="Anthropic billed (month to date)" value={A.available ? usd(A.usd) : '—'} sub={A.available ? (A.delta === 0 ? 'matches our estimate' : (A.delta > 0 ? '+' : '') + usd(Math.abs(A.delta)).replace('$', A.delta < 0 ? '-$' : '$') + ' vs estimate') : (A.error ? A.error : 'admin key not configured')} tone={A.available ? 'ok' : 'warn'} />
      <Stat label="Global cap" value={d.caps.global ? '$' + d.caps.global : 'none'} sub={d.caps.global && cur.usd >= d.caps.global * 0.8 ? 'close to the cap' : 'per month, whole instance'} tone={d.caps.global && cur.usd >= d.caps.global * 0.8 ? 'warn' : ''} />
      <Stat label="Per-user caps" value={`${d.caps.trial ? '$' + d.caps.trial : '—'} trial · ${d.caps.user ? '$' + d.caps.user : '∞'} paid`} sub={`models ${d.models.text} / ${d.models.vision}`} />
    </div>
    <div className="adm-split">
      <div>
        <div className="adm-card"><div className="adm-card-h"><h3>Last 3 months (our meter)</h3><span className="muted small">list prices</span></div>
          <div className="adm-table"><div className="adm-tr adm-th c5"><span>Month</span><span>Calls</span><span>Users</span><span>Tokens</span><span>USD</span></div>
            {d.months.map(m => <div key={m.month} className="adm-tr c5"><span><b>{m.month}</b></span><span>{m.calls}</span><span>{m.users}</span><span className="small">{fmtNum(Math.round(m.in / 1000))}k in · {fmtNum(Math.round(m.out / 1000))}k out</span><span><b>{usd(m.usd)}</b></span></div>)}
          </div></div>
        <div className="adm-card"><div className="adm-card-h"><h3>By feature · {cur.month}</h3></div>
          {feats.length ? feats.map(([f, n]) => <div key={f} className="adm-row small"><span className="mono grow">{f}</span><span>{n} calls</span><span className="dim" style={{ width: 90, textAlign: 'right' }}>{Math.round(100 * n / Math.max(1, cur.calls))}%</span></div>) : <div className="dim small">No calls yet this month.</div>}
        </div>
        {A.available && <div className="adm-card"><div className="adm-card-h"><h3>Anthropic · by model</h3><span className="muted small">from the Usage API</span></div>
          {Object.entries(A.byModel).map(([m, t]) => <div key={m} className="adm-row small"><span className="mono grow">{m}</span><span className="dim">{fmtNum(Math.round(t.in / 1000))}k in · {fmtNum(Math.round(t.cached / 1000))}k cached · {fmtNum(Math.round(t.out / 1000))}k out</span></div>)}
          {!Object.keys(A.byModel).length && <div className="dim small">No usage reported yet.</div>}
        </div>}
      </div>
      <div>
        <div className="adm-card"><div className="adm-card-h"><h3>Top users · {cur.month}</h3><span className="muted small">{d.users.length}</span></div>
          <div className="adm-table"><div className="adm-tr adm-th c4"><span>User</span><span>Calls</span><span>Top features</span><span>USD</span></div>
            {d.users.map(u => <div key={u.id} className="adm-tr c4"><span><b>{u.name}</b><small>{u.status || ''}</small></span><span>{u.calls}</span><span className="small dim">{Object.entries(u.features || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + ' ' + v).join(', ')}</span><span><b style={{ color: u.cap && u.usd >= u.cap ? 'var(--red)' : undefined }}>{usd(u.usd)}</b>{u.cap ? <small>cap ${u.cap}</small> : null}</span></div>)}
            {!d.users.length && <div className="dim small" style={{ padding: 12 }}>No usage yet.</div>}
          </div></div>
        <div className="adm-card"><div className="adm-card-h"><h3>Spend caps (USD / month)</h3><span className="muted small">{perms['system.write'] ? 'owner · empty = server default' : 'read-only for your role'}</span></div>
          <div className="adm-formgrid" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
            {[['trial', 'Trial user', d.caps.env.trial], ['user', 'Paid user', d.caps.env.user], ['global', 'Whole instance', d.caps.env.global]].map(([k, l, envv]) => <label key={k}>{l}<input className="field" type="number" min="0" step="0.5" placeholder={envv ? 'default $' + envv : 'default: none'} value={c[k]} disabled={!perms['system.write']} onChange={e => setCaps({ ...c, [k]: e.target.value })} /></label>)}
          </div>
          {perms['system.write'] && caps && <div className="adm-inline" style={{ marginTop: 10 }}><Button size="sm" variant="primary" onClick={save}>Save caps</Button><Button size="sm" onClick={() => setCaps(null)}>Cancel</Button></div>}
          <div className="dim small" style={{ marginTop: 8 }}>When a cap is reached the coach answers with a friendly “limit reached” message until next month. Rule of thumb: global ≈ $1.5 × paying users.</div>
        </div>
        <div className="adm-card"><div className="adm-card-h"><h3>Anthropic connection</h3></div>
          <div className="small">Server key: <span className="mono">{d.keyPrefix}…</span> (matches the console’s “Claves de API” list). {A.available ? <Pill tone="ok">billed cost connected</Pill> : <Pill tone="warn">billed cost not connected</Pill>}</div>
          {!A.available && <div className="dim small" style={{ marginTop: 6 }}>{A.reason || A.error}</div>}
        </div>
      </div>
    </div>
  </>
}

/* ---------------- team ---------------- */
function Team({ perms, meId }) {
  const toast = useUI(s => s.toast)
  const [d, reload, err] = useLoad('/api/admin/team')
  const [email, setEmail] = useState(''); const [role, setRole] = useState('support')
  if (err) return <ErrorBox err={err} />
  if (!d) return <Loading />
  const setR = (id, r) => post('/api/admin/team/role', { id, role: r }).then(() => { toast('Updated'); reload() }).catch(e => toast(e.message))
  const add = e => { e.preventDefault(); post('/api/admin/team/role', { email, role }).then(() => { toast('Role granted'); setEmail(''); reload() }).catch(x => toast(x.message)) }
  return <>
    <div className="adm-card"><div className="adm-card-h"><h3>Members</h3><span className="muted small">{d.members.length}</span></div>
      <div className="adm-table"><div className="adm-tr adm-th c4"><span>Person</span><span>Role</span><span>Console</span><span></span></div>
        {d.members.map(m => <div key={m.id} className="adm-tr c4"><span><b>{m.name}</b><small>{m.email}</small></span>
          <span>{perms['team.write'] && m.id !== meId ? <select className="field" value={m.role} onChange={e => setR(m.id, e.target.value)}>{d.roles.map(r => <option key={r} value={r}>{r}</option>)}</select> : <Pill tone="info">{m.role}</Pill>}</span>
          <span className="small">{m.stepUpActive ? 'open · ' + rel(m.stepUpAt) : m.stepUpAt ? 'last ' + rel(m.stepUpAt) : 'never'}</span>
          <span>{perms['team.write'] && m.id !== meId && <button className="linkbtn small" style={{ color: 'var(--red)' }} onClick={() => confirmSheet({ title: 'Remove ' + m.name + ' from the team?', message: 'Their account stays; only the console access goes.', confirmText: 'Remove', danger: true, onConfirm: () => setR(m.id, null) })}>remove</button>}</span>
        </div>)}
      </div></div>
    {perms['team.write'] && <div className="adm-card"><div className="adm-card-h"><h3>Grant a role</h3><span className="muted small">The person needs an existing, verified VantixGym account.</span></div>
      <form onSubmit={add} className="adm-inline">
        <input className="field grow" type="email" required placeholder="their@email.com" value={email} onChange={e => setEmail(e.target.value)} />
        <select className="field" value={role} onChange={e => setRole(e.target.value)}>{d.roles.map(r => <option key={r} value={r}>{r}</option>)}</select>
        <Button type="submit" variant="primary">Grant</Button>
      </form></div>}
    <div className="adm-card"><div className="adm-card-h"><h3>What each role can do</h3></div>
      <div className="adm-perms">{Object.entries(d.perms).map(([p, roles]) => <div key={p} className="adm-row small"><span className="mono grow">{p}</span><span className="dim">{roles.join(', ')}</span></div>)}</div>
    </div>
  </>
}

/* ---------------- audit + logs ---------------- */
function AuditRow({ e }) {
  const diff = e.before && e.after ? Object.keys({ ...e.before, ...e.after }).filter(k => JSON.stringify(e.before[k]) !== JSON.stringify(e.after[k])).map(k => `${k}: ${fmtV(e.before[k])} → ${fmtV(e.after[k])}`).join(' · ') : ''
  return <div className="adm-row small adm-audit">
    <span className="dim mono" style={{ width: 150, flex: 'none' }}>{when(e.t)}</span>
    <span style={{ width: 130, flex: 'none' }}><b>{e.actorName || 'system'}</b>{e.actorRole && <small className="dim"> {e.actorRole}</small>}</span>
    <Pill tone={/denied|failed/.test(e.action) ? 'warn' : /delete|refund|flags|role/.test(e.action) ? 'info' : ''}>{e.action}</Pill>
    <span className="grow">{e.targetName || e.target || ''}{e.days ? ' · ' + e.days + ' d' : ''}{e.perm ? ' · ' + e.perm : ''}{e.code ? ' · ' + e.code : ''}{diff ? ' · ' + diff : ''}</span>
    <span className="dim mono">{e.ip}</span>
  </div>
}
const fmtV = v => (v === null || v === undefined ? '—' : typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : String(v))
function Audit() {
  const [qText, setQ] = useState(''); const [action, setAction] = useState('')
  const [d, reload, err] = useLoad(`/api/admin/audit?q=${encodeURIComponent(qText)}&action=${encodeURIComponent(action)}&limit=300`, [qText, action])
  const [v] = useLoad('/api/admin/audit/verify')
  const actions = useMemo(() => [...new Set((d?.entries || []).map(e => e.action))].sort(), [d])
  if (err) return <ErrorBox err={err} />
  return <>
    <div className="adm-filters">
      <input className="field" placeholder="Search (actor, target, action, ip…)" value={qText} onChange={e => setQ(e.target.value)} />
      <select className="field" value={action} onChange={e => setAction(e.target.value)}><option value="">All actions</option>{actions.map(a => <option key={a}>{a}</option>)}</select>
      <span className="small">{v ? (v.ok ? <Pill tone="ok">chain intact · {v.entries} entries</Pill> : <Pill tone="warn">chain BROKEN: {v.error}</Pill>) : ''}</span>
      <a className="btn sm" href="/api/admin/audit/export" target="_blank" rel="noopener">Export</a>
      <Button size="sm" onClick={reload}>Refresh</Button>
    </div>
    <div className="adm-card">{!d ? <Loading /> : d.entries.length ? d.entries.map(e => <AuditRow key={e.id} e={e} />) : <div className="dim small">No entries.</div>}</div>
  </>
}
function Logs() {
  const [status, setStatus] = useState(''); const [qText, setQ] = useState('')
  const [d, reload, err] = useLoad(`/api/admin/logs?status=${status}&q=${encodeURIComponent(qText)}`, [status, qText])
  useEffect(() => { const iv = setInterval(reload, 10000); return () => clearInterval(iv) }, [status, qText])
  if (err) return <ErrorBox err={err} />
  return <>
    <div className="adm-filters">
      <select className="field" value={status} onChange={e => setStatus(e.target.value)}><option value="">All requests</option><option value="5xx">Server errors (5xx)</option><option value="4xx">Client errors (4xx)</option><option value="slow">Slow (&gt; 1 s)</option></select>
      <input className="field" placeholder="Path or status" value={qText} onChange={e => setQ(e.target.value)} />
      {d && <span className="small dim">{d.summary.last5m} req / 5 min · {d.summary.err5m} errors · p95 {d.summary.p95ms} ms · buffer {d.summary.total}</span>}
    </div>
    <div className="adm-card adm-logs">{!d ? <Loading /> : d.entries.map((r, i) => <div key={i} className={'adm-log' + (r.s >= 500 ? ' err' : r.s >= 400 ? ' warn' : '')}><span className="dim">{new Date(r.t).toLocaleTimeString()}</span><span className="mono">{r.m}</span><span className="mono grow">{r.p}</span><span>{r.s}</span><span className="dim">{r.ms} ms</span><span className="dim mono">{r.ip}</span></div>)}</div>
    <div className="dim small" style={{ marginTop: 8 }}>In-memory ring of the last 3,000 requests (paths and status only, no bodies or identities). Full JSON lines go to the container log.</div>
  </>
}

/* ---------------- system ---------------- */
function System({ perms }) {
  const toast = useUI(s => s.toast)
  const [d, reload, err] = useLoad('/api/admin/system')
  const [banner, setBanner] = useState(null)
  if (err) return <ErrorBox err={err} />
  if (!d) return <Loading />
  const flags = d.flags || {}
  const setFlag = (k, v) => confirmSheet({ title: `${v ? 'Resume' : 'Pause'} ${k}?`, message: v ? 'Users get the feature back immediately.' : 'Users see a “paused for maintenance” message until you resume. Owners are emailed.', confirmText: v ? 'Resume' : 'Pause', danger: !v, onConfirm: () => post('/api/admin/flags', { [k]: v }).then(() => { toast('Saved'); reload() }).catch(e => toast(e.message)) })
  const saveBanner = () => post('/api/admin/flags', { banner }).then(() => { toast('Banner saved'); setBanner(null); reload() }).catch(e => toast(e.message))
  const I = d.integrations
  return <>
    <div className="adm-grid4">
      <Stat label="API uptime" value={Math.floor(d.uptimeSec / 3600) + 'h ' + Math.floor(d.uptimeSec % 3600 / 60) + 'm'} sub={`node ${d.node} · ${d.memMb} MB`} />
      <Stat label="Disk (data volume)" value={d.disk ? d.disk.freeGb + ' GB free' : '—'} sub={d.disk ? 'of ' + d.disk.totalGb + ' GB' : ''} tone={d.disk && d.disk.freeGb < 2 ? 'warn' : 'ok'} />
      <Stat label="Database" value={fmtNum(Math.round(d.dbBytes / 1024)) + ' KB'} sub={d.users + ' accounts (incl. deleted)'} />
      <Stat label="Audit log" value={d.audit.ok ? 'intact' : 'BROKEN'} sub={d.audit.entries + ' entries'} tone={d.audit.ok ? 'ok' : 'warn'} />
    </div>
    <div className="adm-card"><div className="adm-card-h"><h3>Kill switches</h3><span className="muted small">{perms['system.write'] ? 'Owner only · every change is audited and emailed' : 'Read-only for your role'}</span></div>
      {[['signups', 'Sign-ups', 'New accounts can be created'], ['ai', 'AI features', 'Coach, trainer, meal photos, imports'], ['payments', 'Web payments', 'Stripe checkout (store purchases are unaffected)']].map(([k, l, s]) => <div key={k} className="adm-row"><span className="grow"><b>{l}</b><div className="dim small">{s}</div></span><Switch checked={flags[k] !== false} disabled={!perms['system.write']} onChange={v => setFlag(k, v)} /></div>)}
      <div className="adm-row"><span className="grow"><b>Maintenance banner</b><div className="dim small">Shown at the top of the app while set (max 160 chars).</div>
        <div className="adm-inline" style={{ marginTop: 6 }}><input className="field grow" maxLength={160} value={banner ?? flags.banner ?? ''} onChange={e => setBanner(e.target.value)} disabled={!perms['system.write']} placeholder="e.g. Mantenimiento hoy 22:00–22:30" />{perms['system.write'] && banner !== null && <Button size="sm" variant="primary" onClick={saveBanner}>Save</Button>}</div></span></div>
    </div>
    <div className="adm-card"><div className="adm-card-h"><h3>Integrations</h3><span className="muted small">prefixes only, never values</span></div>
      {[['Stripe', I.stripe.on, I.stripe.on ? `key ${I.stripe.key}… · webhook ${I.stripe.webhook ? 'set' : 'missing'} · ${I.stripe.prices}/3 prices` : 'not configured'],
        ['RevenueCat', I.revenuecat.on, `webhook ${I.revenuecat.on ? 'set' : 'missing'} · secret key ${I.revenuecat.secretKey ? 'set' : 'missing'}`],
        ['Anthropic', I.anthropic.on, I.anthropic.on ? `key ${I.anthropic.key}… · ${I.anthropic.models.text} / ${I.anthropic.models.vision}` : 'not configured'],
        ['Email (Resend)', I.email.on, I.email.on ? 'configured' : 'not configured'], ['Google sign-in', I.google.on, I.google.on ? 'configured' : 'off'], ['Apple sign-in', I.apple.on, I.apple.on ? 'configured' : 'off']
      ].map(([n, on, s]) => <div key={n} className="adm-row small"><span className="grow"><b>{n}</b> <span className="dim">{s}</span></span><Pill tone={on ? 'ok' : 'warn'}>{on ? 'on' : 'off'}</Pill></div>)}
    </div>
    <div className="adm-card"><div className="adm-card-h"><h3>Backups</h3></div>
      {d.backup ? <div className="small">Last: <b>{when(d.backup.at)}</b> · {d.backup.file} · {fmtNum(Math.round(d.backup.bytes / 1024))} KB · {d.backup.s3 ? <Pill tone="ok">copied to S3</Pill> : <Pill tone="warn">local only</Pill>}</div> : <div className="dim small">No marker yet. The nightly job writes one after the next run (see docs/BACKUPS.md).</div>}
      <div className="dim small" style={{ marginTop: 6 }}>Instance: {d.env.origin} · billing {d.env.billing ? 'on' : 'off'} · trial {d.env.trialDays} d · invite-only {d.env.inviteOnly ? 'yes' : 'no'}</div>
    </div>
  </>
}

const Loading = () => <div className="dim small" style={{ padding: 16 }}>Loading…</div>
const ErrorBox = ({ err }) => <div className="adm-card warn">{err.status === 403 ? 'Your role cannot see this.' : err.status === 428 ? 'Session check expired — reload the page.' : (err.message || 'Failed to load')}</div>

/* ---------------- shell ---------------- */
export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [me, setMe] = useState(null)
  const [section, setSection] = useState(() => (location.hash.split('?')[1] || '').replace(/^s=/, '') || 'overview')
  const [focusId, setFocusId] = useState(null)
  const loadMe = () => api('/api/admin/me').then(setMe).catch(e => { if (e.status === 403) nav('/home'); else toast(e.message) })
  useEffect(() => { if (user?.admin) loadMe() }, [user?.id])
  useEffect(() => { document.body.classList.add('console'); return () => document.body.classList.remove('console') }, [])
  if (!user?.admin) return null
  if (!me) return <Loading />
  if (!me.stepUp) return <StepUp me={me} onDone={loadMe} />
  const go = (s, id) => { setSection(s); setFocusId(id || null) }
  const visible = SECTIONS.filter(([, , , perm]) => me.perms[perm])
  const Section = { overview: Overview, users: Users, billing: Billing, coupons: Coupons, ai: AI, team: Team, audit: Audit, logs: Logs, system: System }[section] || Overview
  return <div className="adm">
    <aside className="adm-nav">
      <div className="adm-brand"><button className="iconbtn" onClick={() => nav('/settings')} aria-label="Back"><Icon name="chevronLeft" /></button><div><b>VantixGym</b><div className="dim small">console · {me.role}</div></div></div>
      {visible.map(([id, label, icon]) => <button key={id} className={'adm-navbtn' + (section === id ? ' on' : '')} onClick={() => go(id)}><Icon name={icon} />{label}</button>)}
      <div className="grow" />
      <button className="adm-navbtn" onClick={() => post('/api/admin/stepdown').then(() => loadMe())}><Icon name="lock" />Lock console</button>
    </aside>
    <main className="adm-main">
      <div className="adm-head"><h1>{SECTIONS.find(s => s[0] === section)?.[1]}</h1><span className="dim small">{user.name}</span></div>
      <Section perms={me.perms} go={go} focusId={focusId} meId={user.id} />
    </main>
  </div>
}
