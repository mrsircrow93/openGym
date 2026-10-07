// Supplements: the card on the Nutrition screen and the add/edit sheet behind it.
// The app only reminds you of what you entered — it never suggests a substance or a dose, and
// says so where it matters (guideline 1.4.1 territory, same as the calorie targets).
import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { t } from './lib/i18n.js'
import { uid, DAYS } from './lib/format.js'
import { syncReminder } from './lib/mobile.js'
import { PRESETS, UNITS, dosesOn, takenCount, supplementStreak, isoOf } from './lib/supplements.js'
import Icon from './components/Icon.jsx'
import { Button, TextField, Segmented, Switch } from './components/ui.jsx'
import { confirmSheet } from './sheets.jsx'

const ui = () => useUI.getState()
const blank = () => ({ id: uid(), name: '', dose: 1, unit: 'g', times: ['09:00'], days: null, withFood: false })

function SupplementForm({ id, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const existing = (S.supplements || []).find(x => x.id === id)
  const [f, setF] = useState(existing ? { ...existing } : blank())
  const set = patch => setF(v => ({ ...v, ...patch }))
  const err = !f.name.trim() ? t('Give it a name') : !f.times.length ? t('Add at least one time') : null
  const save = () => {
    if (err) return
    update(s => {
      const list = s.supplements || []
      const clean = { ...f, name: f.name.trim().slice(0, 40), dose: Math.max(0, +f.dose || 0) }
      s.supplements = existing ? list.map(x => (x.id === f.id ? clean : x)) : [...list, clean]
    })
    syncReminder(useStore.getState().S).catch(() => {})
    close()
  }
  const remove = () => confirmSheet({
    title: t('Remove {0}?', f.name || t('this supplement')), message: t('The reminders stop and the history of what you took is kept.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: () => { update(s => { s.supplements = (s.supplements || []).filter(x => x.id !== f.id) }); syncReminder(useStore.getState().S).catch(() => {}); close() }
  })
  const setTime = (i, v) => set({ times: f.times.map((x, j) => (j === i ? v : x)) })
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="sparkles" style={{ color: 'var(--purple)' }} />{existing ? t('Edit supplement') : t('New supplement')}</h3>
    {!existing && <div className="chips" style={{ margin: '10px 0 4px' }}>
      {PRESETS.map(p => <button key={p.name} className="chip" onClick={() => set({ name: t(p.name), dose: p.dose, unit: p.unit, times: [...p.times], withFood: !!p.withFood })}>{t(p.name)}</button>)}
    </div>}
    <TextField placeholder={t('Name (creatine, protein…)')} value={f.name} onChange={e => set({ name: e.target.value })} autoFocus={!existing} />
    <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <input className="input" type="number" min="0" step="0.5" style={{ flex: 1 }} value={f.dose} onChange={e => set({ dose: e.target.value })} aria-label={t('Dose')} />
      <Segmented className="seg-inline" options={UNITS.map(u => ({ value: u, label: u }))} value={f.unit} onChange={v => set({ unit: v })} />
    </div>
    <h4 className="sec">{t('Times')}</h4>
    {f.times.map((time, i) => <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
      <input type="time" className="timef" value={time} onChange={e => setTime(i, e.target.value)} />
      {f.times.length > 1 && <button className="linkbtn small" style={{ color: 'var(--red)' }} onClick={() => set({ times: f.times.filter((_, j) => j !== i) })}>{t('Remove')}</button>}
    </div>)}
    {f.times.length < 3 && <button className="linkbtn small" onClick={() => set({ times: [...f.times, '21:00'] })}>{t('Add another time')}</button>}
    <h4 className="sec">{t('Days')}</h4>
    <Segmented options={[{ value: 'all', label: t('Every day') }, { value: 'some', label: t('Chosen days') }]}
      value={f.days && f.days.length ? 'some' : 'all'} onChange={v => set({ days: v === 'all' ? null : [1, 2, 3, 4, 5] })} />
    {f.days && f.days.length > 0 && <div className="chips" style={{ marginTop: 8 }}>
      {[1, 2, 3, 4, 5, 6, 0].map(d => <button key={d} className={'chip' + (f.days.includes(d) ? ' on' : '')}
        onClick={() => set({ days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d] })}>{t(DAYS[d])}</button>)}
    </div>}
    <div className="row between" style={{ marginTop: 14 }}>
      <span className="small">{t('Take it with food')}</span>
      <Switch checked={!!f.withFood} onChange={v => set({ withFood: v })} />
    </div>
    {err && <div className="small" style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
    <div className="row" style={{ gap: 8, marginTop: 14 }}>
      {existing && <Button variant="danger" icon="trash" onClick={remove} style={{ flex: 1 }}>{t('Remove')}</Button>}
      <Button variant="primary" icon="check" disabled={!!err} onClick={save} style={{ flex: 2 }}>{t('Save')}</Button>
    </div>
    <div className="card small muted" style={{ marginTop: 14, lineHeight: 1.5, borderLeft: '3px solid var(--yellow)' }}>
      <Icon name="shield" style={{ fontSize: 13, marginRight: 6, color: 'var(--yellow)' }} />
      {t('VantixGym only reminds you of what you set here. It does not recommend supplements or doses — ask a doctor or nutritionist, especially if you take medication or are pregnant.')}
    </div>
  </>
}
export const supplementSheet = id => ui().openSheet(close => <SupplementForm id={id} close={close} />)

// The card on Nutrition: today's doses, tap to tick, long list stays compact.
export function SupplementsCard() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const doses = dosesOn(S)
  const has = (S.supplements || []).length > 0
  const iso = isoOf(new Date())
  const toggle = (sid, time, taken) => {
    update(s => {
      const log = s.supTaken || []
      s.supTaken = taken ? log.filter(x => !(x.d === iso && x.sid === sid && x.time === time))
        : [...log, { d: iso, sid, time }].slice(-2000)
    })
    syncReminder(useStore.getState().S).catch(() => {})
  }
  const streak = supplementStreak(S)
  if (!has) return <div className="card">
    <div className="row" style={{ gap: 10, marginBottom: 6 }}>
      <span className="lrow-i" style={{ '--tint': 'var(--purple)' }}><Icon name="sparkles" /></span>
      <div style={{ flex: 1, minWidth: 0 }}><b>{t('Supplements')}</b>
        <div className="dim small">{t('Creatine, protein, vitamins… set your times and the app reminds you.')}</div></div>
    </div>
    <Button icon="plus" onClick={() => supplementSheet()}>{t('Add a supplement')}</Button>
  </div>
  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Supplements')}</h2>
      <span className="small dim">{doses.length ? t('{0} of {1} today', takenCount(S), doses.length) : t('nothing scheduled today')}{streak > 1 ? ' · ' + t('{0}-day streak', streak) : ''}</span>
    </div>
    {doses.map(({ sup, time, taken }) => <button key={sup.id + time} className="suprow" onClick={() => toggle(sup.id, time, taken)}>
      <span className={'supcheck' + (taken ? ' on' : '')}><Icon name={taken ? 'checkCircle' : 'dot'} /></span>
      <span className="grow">
        <b className={taken ? 'supdone' : ''}>{sup.name}</b>
        <span className="supmeta">{sup.dose ? sup.dose + ' ' + sup.unit : ''}{sup.withFood ? ' · ' + t('with food') : ''}</span>
      </span>
      <span className="small dim" style={{ flex: 'none' }}>{time}</span>
      <span className="supedit" onClick={e => { e.stopPropagation(); supplementSheet(sup.id) }} aria-label={t('Edit')}><Icon name="pencil" /></span>
    </button>)}
    <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <Button size="sm" icon="plus" onClick={() => supplementSheet()}>{t('Add a supplement')}</Button>
      {!doses.length && <span className="small dim">{t('Scheduled for other days.')}</span>}
    </div>
  </div>
}
