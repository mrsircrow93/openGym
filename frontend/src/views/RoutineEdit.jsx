import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { supersetUnits, cleanupSg, exLine } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, deleteRoutine, startFlow } from '../sheets.jsx'
import { routineMinutes } from '../lib/routine.js'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, SelectRow } from '../components/ui.jsx'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import BodyMap from '../components/BodyMap.jsx'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  if (!r) return null

  const edit = fn => update(s => { fn(s.routines.find(x => x.id === id).ex) })
  const move = (i, dir) => edit(ex => { const j = i + dir; if (j < 0 || j >= ex.length) return;[ex[i], ex[j]] = [ex[j], ex[i]]; cleanupSg(ex) })
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })

  const units = supersetUnits(r.ex)
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())

  const minutes = routineMinutes(r)
  const addEx = () => exercisePicker(ex => exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) }), null, r))
  return <div className="narrow">
    <div className="hdr" style={{ marginBottom: 8 }}>
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1 style={{ fontSize: 22 }}>{t('Edit routine')}</h1></div>
    </div>

    {/* Name + icon in one card, so "what is this routine" is one glance. */}
    <div className="card" style={{ padding: 14 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button className="avatar-l tap" style={{ fontSize: 24, flex: 'none' }} aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, g => update(s => { s.routines.find(x => x.id === id).emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>{t('Routine name')}</div>
          <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 18, letterSpacing: '-.015em' }}
            onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || t('Routine') })} />
        </div>
      </div>
      <div className="small dim" style={{ marginTop: 10 }}>{t('Tap the icon to change it')} · {t(r.ex.length === 1 ? '{0} exercise' : '{0} exercises', r.ex.length)}{minutes ? ' · ~' + minutes + ' min' : ''}</div>
    </div>

    <div className="eyebrow" style={{ margin: '18px 0 8px' }}>{t('Exercises, in order')}</div>
    {r.ex.length ? <div className="list">{r.ex.map((e, i) => {
      // An unresolvable id is shown rather than skipped — hiding it left an entry you
      // could neither see nor delete, but that still turned up in the workout.
      const ex = exOr(e.id)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      return <div key={i}>
        {unitFirst.has(i) && <div className="ss-label"><Icon name="link" />{t('Superset')} · {t('done back to back')}</div>}
        <div className={'item re-item' + (inSS.has(i) ? ' in-ss' : '')} onClick={() => {
          exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => edit(x => { x.splice(i, 1); cleanupSg(x) }), r)
        }}>
          <span className="re-num">{i + 1}</span>
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{ex.n}</div><div className="ss">{exLine(e, S.unit)} · <span style={{ color: 'var(--acc)' }}>{t('Change')}</span></div></div>
          <div className="re-actions" onClick={ev => ev.stopPropagation()}>
            <button className="iconbtn" aria-label={t('Move up')} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevronUp" /></button>
            <button className="iconbtn" aria-label={t('Move down')} disabled={i === r.ex.length - 1} onClick={() => move(i, 1)}><Icon name="chevronDown" /></button>
          </div>
        </div>
        {i > 0 && <button className={'re-link' + (linkedPrev ? ' on' : '')} onClick={() => toggleLink(i)}>
          <Icon name="link" />{linkedPrev ? t('Linked with the one above · tap to separate') : t('Do it back to back with the one above')}
        </button>}
      </div>
    })}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}
    <button className="add-dashed" onClick={addEx}><Icon name="plus" />{t('Add exercise')}</button>

    <div className="eyebrow" style={{ margin: '20px 0 8px' }}>{t('How the weight goes up')}</div>
    <div className="sect-b" style={{ marginBottom: 6 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
    </div>
    <div className="small dim" style={{ margin: '0 2px 16px' }}>
      {t('The app suggests when to add weight. Applies to every exercise here unless one sets its own rule.')}
    </div>

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r)
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    })()}

    <div style={{ height: 8 }} />
    {r.ex.length > 0 && <Button variant="primary" icon="play" onClick={() => startFlow(r.id)}>{t('Start this routine')}</Button>}
    <div style={{ height: 8 }} />
    <Button onClick={() => nav('/plan')} icon="check">{t('Done')}</Button>
    <div style={{ height: 18 }} />
    <Button variant="ghost" className="dim" icon="trash" onClick={() => deleteRoutine(id, () => nav('/plan'))}>{t('Delete routine')}</Button>
  </div>
}
