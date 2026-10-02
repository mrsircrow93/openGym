// Monthly check-in: three photos (front, side, back) and today's weight, then a side-by-side
// with the previous set and a short coach's note on what changed. Storage + facts live in
// lib/progress-photos.js; the review itself is the server's progress-review route.
import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { fmtNum, fmtDate, todayISO } from './lib/format.js'
import { t } from './lib/i18n.js'
import { lastBW } from './lib/history.js'
import { aiProgressReview, aiErrorMessage } from './lib/api.js'
import { POSES, POSE_LABEL, uploadPhoto, deletePhoto, newCheckin, checkinsOf, previousCheckin, reviewFacts, daysSince } from './lib/progress-photos.js'
import Photo from './components/Photo.jsx'
import Icon from './components/Icon.jsx'
import { Button, Stepper } from './components/ui.jsx'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const POSE_HINT = { front: 'Arms relaxed at your sides, feet hip-width', side: 'Turn 90°, look straight ahead', back: 'Back to the camera, arms relaxed' }
const POSE_ICON = { front: 'person', side: 'figureStrength', back: 'arm' }

/* ---------- take / pick the three photos ---------- */
function Checkin({ close }) {
  const S = useStore.getState().S
  const [files, setFiles] = useState({ front: null, side: null, back: null })
  const [urls, setUrls] = useState({})
  const [w, setW] = useState((lastBW(S) || {}).w || 70)
  const [busy, setBusy] = useState('')
  const [pose, setPose] = useState('front')
  const camRef = useRef(null), galRef = useRef(null)
  useEffect(() => () => { Object.values(urls).forEach(u => u && URL.revokeObjectURL(u)) }, [])
  const take = (p, file) => {
    if (!file) return
    setFiles(f => ({ ...f, [p]: file }))
    setUrls(u => { if (u[p]) URL.revokeObjectURL(u[p]); return { ...u, [p]: URL.createObjectURL(file) } })
    const next = POSES.find(x => x !== p && !files[x] && POSES.indexOf(x) > POSES.indexOf(p)) || POSES.find(x => x !== p && !files[x])
    if (next) setPose(next)
  }
  const onPick = e => { const f = e.target.files?.[0]; e.target.value = ''; take(pose, f) }
  const count = POSES.filter(p => files[p]).length
  const save = async () => {
    if (!count) { toast(t('Take at least one photo')); return }
    setBusy(t('Saving photos…'))
    try {
      const photos = {}
      for (const p of POSES) if (files[p]) photos[p] = await uploadPhoto(files[p])
      const n = Math.round((w || 0) * 10) / 10
      const c = newCheckin(todayISO(), n > 0 ? n : null, photos)
      update(s => {
        s.checkins = [...(s.checkins || []), c]
        if (n > 0) { const iso = todayISO(); const ex = s.bodyweight.find(b => b.d === iso); if (ex) { ex.w = n; ex.t = Date.now() } else { s.bodyweight.push({ d: iso, w: n, t: Date.now() }); s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1)) } }
      })
      close()
      reviewSheet(c.id, { auto: true })
    } catch (e) { toast(aiErrorMessage(e)); setBusy('') }
  }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="camera" style={{ color: 'var(--acc)' }} />{t('Monthly photos')}</h3>
    <div className="small muted" style={{ lineHeight: 1.5, marginBottom: 12 }}>{t('Three photos, same spot and light each month, fitted clothes, relaxed. Only you can see them.')}</div>
    <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onPick} />
    <input ref={galRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPick} />
    <div className="ph-grid">
      {POSES.map(p => <button key={p} className={'ph-slot' + (pose === p ? ' on' : '') + (files[p] ? ' has' : '')} onClick={() => setPose(p)}>
        {urls[p] ? <img src={urls[p]} alt="" /> : <Icon name={POSE_ICON[p]} />}
        <span className="ph-slot-l">{t(POSE_LABEL[p])}{files[p] && <Icon name="checkCircle" style={{ marginLeft: 4, color: 'var(--acc)' }} />}</span>
      </button>)}
    </div>
    <div className="small dim" style={{ margin: '8px 2px 10px' }}>{t(POSE_LABEL[pose])}: {t(POSE_HINT[pose])}</div>
    <div className="row" style={{ gap: 8 }}>
      <Button variant="tinted" icon="camera" style={{ flex: 1 }} onClick={() => camRef.current?.click()}>{files[pose] ? t('Retake') : t('Take photo')}</Button>
      <Button icon="folder" style={{ flex: 1 }} onClick={() => galRef.current?.click()}>{t('From gallery')}</Button>
    </div>
    <h4 className="sec">{t('Today’s weight')}</h4>
    <div className="row cfgrow"><Stepper label={t('Body weight') + ' (' + S.unit + ')'} value={w} step={0.5} onChange={setW} /></div>
    <div style={{ height: 14 }} />
    {busy ? <div className="row small dim" style={{ gap: 8, padding: '8px 0' }}><span className="spin" />{busy}</div>
      : <Button variant="primary" icon="check" disabled={!count} onClick={save}>{count === 3 ? t('Save check-in') : t('Save with {0} of 3 photos', count)}</Button>}
    <div style={{ height: 6 }} /><Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const checkinSheet = () => ui().openSheet(close => <Checkin close={close} />)

/* ---------- before / now + the coach's note ---------- */
function Review({ id, auto, close }) {
  const S = useStore(s => s.S)
  const c = (S.checkins || []).find(x => x.id === id)
  const prev = c ? previousCheckin(S, c) : null
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [big, setBig] = useState(null)
  const started = useRef(false)
  const ask = async () => {
    if (!c || busy) return
    setBusy(true); setErr('')
    try {
      const r = await aiProgressReview(reviewFacts(S, c))
      update(s => { const x = (s.checkins || []).find(y => y.id === id); if (x) x.review = { headline: r.headline, summary: r.summary, observations: r.observations || [], tips: r.tips || [], comparable: !!r.comparable, mood: r.mood || 'steady', at: Date.now() } })
    } catch (e) { setErr(aiErrorMessage(e)) }
    setBusy(false)
  }
  useEffect(() => { if (auto && c && !c.review && !started.current) { started.current = true; ask() } }, [])
  if (!c) return <div className="small muted">{t('This check-in was deleted.')}</div>
  const remove = () => ui().openSheet(cl => <>
    <h3>{t('Delete this check-in?')}</h3>
    <div className="small muted" style={{ marginBottom: 14 }}>{t('The photos are deleted from your account for good.')}</div>
    <Button variant="primary" style={{ background: 'var(--red)', color: '#fff' }} icon="trash" onClick={async () => { for (const p of Object.values(c.photos || {})) await deletePhoto(p); update(s => { s.checkins = (s.checkins || []).filter(x => x.id !== id) }); cl(); close(); toast(t('Check-in deleted')) }}>{t('Delete')}</Button>
    <div style={{ height: 6 }} /><Button variant="ghost" onClick={cl}>{t('Cancel')}</Button>
  </>)
  const rv = c.review
  const moodIcon = rv ? (rv.mood === 'celebrate' ? 'trophy' : rv.mood === 'encourage' ? 'heart' : 'flag') : 'sparkles'
  const moodColor = rv ? (rv.mood === 'celebrate' ? 'var(--acc)' : rv.mood === 'encourage' ? 'var(--orange)' : 'var(--blue)') : 'var(--violet)'
  const delta = c.w && prev && prev.w ? Math.round((c.w - prev.w) * 10) / 10 : null
  return <>
    {big && <button className="ph-big" onClick={() => setBig(null)}><Photo id={big} /></button>}
    <h3 className="row" style={{ gap: 8 }}><Icon name="camera" style={{ color: 'var(--acc)' }} />{fmtDate(c.d, true)}</h3>
    <div className="small muted" style={{ marginBottom: 10 }}>
      {c.w ? fmtNum(c.w) + ' ' + S.unit : ''}{delta !== null ? ' · ' + (delta > 0 ? '+' : '') + fmtNum(delta) + ' ' + S.unit + ' ' + t('since last time') : ''}
      {prev ? ' · ' + t('vs {0}', fmtDate(prev.d, true)) : ' · ' + t('Your starting point')}
    </div>

    {prev && <div className="row small dim" style={{ gap: 0, marginBottom: 4 }}><span style={{ flex: 1, textAlign: 'center' }}>{t('Before')}</span><span style={{ flex: 1, textAlign: 'center' }}>{t('Now')}</span></div>}
    {POSES.filter(p => c.photos[p] || (prev && prev.photos[p])).map(p => <div key={p} style={{ marginBottom: 10 }}>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{t(POSE_LABEL[p])}</div>
      <div className={'cmp-row' + (prev ? '' : ' one')}>
        {prev && <Photo id={prev.photos[p]} onClick={() => setBig(prev.photos[p])} />}
        <Photo id={c.photos[p]} onClick={() => setBig(c.photos[p])} />
      </div>
    </div>)}

    <div className="card" style={{ marginTop: 6, borderLeft: '3px solid ' + moodColor }}>
      <div className="row" style={{ gap: 8, marginBottom: 6 }}><Icon name={moodIcon} style={{ color: moodColor }} /><b>{rv ? rv.headline : t('Your coach’s note')}</b></div>
      {busy && <div className="row small dim" style={{ gap: 8 }}><span className="spin" />{t('Looking at your photos — about 20 seconds…')}</div>}
      {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}
      {rv && <>
        <div className="small" style={{ lineHeight: 1.55, color: 'var(--text)' }}>{rv.summary}</div>
        {rv.observations.length > 0 && <div style={{ marginTop: 10 }}>{rv.observations.map((o, i) => <div key={i} className="row small" style={{ gap: 8, alignItems: 'flex-start', marginBottom: 5 }}><span className="pill" style={{ padding: '2px 8px', fontSize: 11, flex: 'none' }}>{t(o.pose === 'overall' ? 'Overall' : POSE_LABEL[o.pose] || 'Overall')}</span><span className="muted">{o.text}</span></div>)}</div>}
        {rv.tips.length > 0 && <div style={{ marginTop: 10 }}>{rv.tips.map((x, i) => <div key={i} className="row small muted" style={{ gap: 6, alignItems: 'flex-start', marginBottom: 4 }}><Icon name="lightbulb" style={{ fontSize: 13, color: 'var(--yellow)', flex: 'none', marginTop: 2 }} /><span>{x}</span></div>)}</div>}
      </>}
      {!rv && !busy && <Button size="sm" variant="tinted" icon="sparkles" onClick={ask}>{prev ? t('What changed since last time?') : t('Read my starting point')}</Button>}
    </div>
    <div style={{ height: 10 }} />
    <Button variant="ghost" className="dim" icon="trash" onClick={remove}>{t('Delete this check-in')}</Button>
  </>
}
export const reviewSheet = (id, opts = {}) => ui().openSheet(close => <Review id={id} auto={!!opts.auto} close={close} />)

/* ---------- all check-ins ---------- */
function Timeline({ close }) {
  const S = useStore(s => s.S)
  const list = checkinsOf(S).reverse()
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="camera" style={{ color: 'var(--acc)' }} />{t('Your photos')}</h3>
    <div className="small muted" style={{ marginBottom: 12 }}>{t('One set a month is enough to see the change you can’t see in the mirror.')}</div>
    <Button variant="primary" icon="camera" onClick={() => { close(); checkinSheet() }}>{t('New check-in')}</Button>
    <div style={{ height: 12 }} />
    {list.map(c => <button key={c.id} className="card tappable" style={{ width: '100%', textAlign: 'left', padding: 10 }} onClick={() => { close(); reviewSheet(c.id) }}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <div className="ph-strip">{POSES.map(p => <Photo key={p} id={c.photos[p]} />)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{fmtDate(c.d, true)}</div>
          <div className="dim small">{[c.w ? fmtNum(c.w) + ' ' + S.unit : '', c.review ? c.review.headline : t('No note yet')].filter(Boolean).join(' · ')}</div>
        </div>
        <Icon name="chevronRight" className="dim" />
      </div>
    </button>)}
    {!list.length && <div className="empty"><div className="ico"><Icon name="camera" /></div>{t('No check-ins yet.')}</div>}
  </>
}
export const checkinsSheet = () => ui().openSheet(close => <Timeline close={close} />)

// Small card for Progress / Home: last set + what to do next.
export function CheckinCard({ S, compact }) {
  const list = checkinsOf(S)
  const last = list[list.length - 1]
  const days = last ? daysSince(last.d) : null
  const due = !last || days >= 28
  if (compact && !due) return null
  return <div className="card">
    <div className="row between" style={{ marginBottom: last ? 8 : 4 }}>
      <div className="eyebrow">{t('Progress photos')}</div>
      {last && <Button size="xs" icon="list" onClick={checkinsSheet}>{t('All')}</Button>}
    </div>
    {last ? <button className="row tappable" style={{ gap: 12, width: '100%', textAlign: 'left', alignItems: 'center' }} onClick={() => reviewSheet(last.id)}>
      <div className="ph-strip">{POSES.map(p => <Photo key={p} id={last.photos[p]} />)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{last.review ? last.review.headline : fmtDate(last.d, true)}</div>
        <div className="dim small">{due ? t('It’s been {0} days — time for this month’s photos.', days) : t('{0} days ago · next in {1}', days, 28 - days)}</div>
      </div>
    </button> : <div className="small muted" style={{ lineHeight: 1.5, marginBottom: 10 }}>{t('Take front, side and back photos once a month and see what the mirror hides. Only you can see them.')}</div>}
    {(due || !last) && <><div style={{ height: 10 }} /><Button variant={last ? 'tinted' : 'primary'} icon="camera" onClick={checkinSheet}>{last ? t('Take this month’s photos') : t('Take my first photos')}</Button></>}
  </div>
}
