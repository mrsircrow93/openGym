import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount, fmtDate, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, dayOverrideSheet, loadStarterPlan, planToolsSheet, startFlow } from '../sheets.jsx'
import { trainerSheet } from '../sheets-trainer.jsx'
import { effectiveRoutine } from '../lib/history.js'
import { routineMinutes, routineMuscles } from '../lib/routine.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { DEFAULT_GLYPH, glyphOf } from '../lib/glyphs.js'

// Plan, written for everyone: what's on today (one big button), the week in plain rows with a
// visible "Change" on each day, then the routines as cards with words instead of letters —
// which muscles, how long, when you last did it — and visible buttons instead of swipe
// gestures. The trainer sits at the bottom as help, not as the first thing you must decide.

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  const today = todayISO()
  const todayDow = new Date().getDay()
  const todayRoutine = effectiveRoutine(S, today)
  const doneToday = S.workouts.some(w => w.d === today)
  const daysPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const dayOf = r => { const d = Object.keys(S.week).find(k => S.week[k] === r.id); return d == null ? null : t(DAYN[+d]) }
  const lastDone = r => { const w = [...S.workouts].reverse().find(w => w.routineId === r.id || w.name === r.name); return w ? w.d : null }
  const onToday = () => { if (S.active) nav('/workout'); else if (todayRoutine) startFlow(todayRoutine.id); else dayOverrideSheet(today) }

  return <>
    <div className="hdr">
      <div><h1>{t('My plan')}</h1><div className="sub">{S.routines.length ? t('{0} workouts a week', daysPerWeek) : t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>

    {/* ---- today ---- */}
    {S.routines.length > 0 && <div className="card hero">
      <div className="eyebrow acc" style={{ marginBottom: 6 }}>{t('Today')} · {t(DAYN[todayDow])}</div>
      {todayRoutine ? <>
        <div className="big" style={{ fontSize: 26, textTransform: 'capitalize' }}>{todayRoutine.name}</div>
        <div className="muted small" style={{ margin: '4px 0 12px' }}>{[exCount(todayRoutine.ex.length), '~' + routineMinutes(todayRoutine) + ' min', routineMuscles(todayRoutine)].filter(Boolean).join(' · ')}</div>
        {doneToday && !S.active && <div className="small" style={{ color: 'var(--acc)', marginBottom: 10 }}><Icon name="checkCircle" /> {t('Done for today — well done!')}</div>}
        <Button variant="primary" icon={S.active ? 'play' : 'dumbbell'} onClick={onToday}>{S.active ? t('Continue workout') : doneToday ? t('Train again') : t('Start today’s workout')}</Button>
        <Button variant="ghost" className="dim" size="sm" style={{ marginTop: 6 }} onClick={() => dayOverrideSheet(today)}>{t('Do a different workout today')}</Button>
      </> : <>
        <div className="big" style={{ fontSize: 26 }}>{t('Rest day')}</div>
        <div className="muted small" style={{ margin: '4px 0 12px' }}>{t('Nothing planned. Recover well — or pick a workout if you feel like it.')}</div>
        <Button variant="tinted" icon="dumbbell" onClick={() => dayOverrideSheet(today)}>{t('Train anyway')}</Button>
      </>}
    </div>}

    {/* ---- the week ---- */}
    {S.routines.length > 0 && <>
      <div className="eyebrow" style={{ margin: '22px 0 10px' }}>{t('Your week')}</div>
      <div className="plan-week">
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          const isToday = d === todayDow
          return <div key={d} className={'plan-day' + (isToday ? ' today' : '')}>
            <div className="plan-day-n">{t(DAYN[d])}{isToday && <span className="plan-today">{t('Today')}</span>}</div>
            <div className="plan-day-r" style={r ? { textTransform: 'capitalize' } : undefined}>{r ? r.name : <span className="dim">{t('Rest')}</span>}</div>
            <button className="plan-day-btn" onClick={() => dayAssignSheet(d)}>{t('Change')}</button>
          </div>
        })}
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>{t('Tap “Change” to put a workout on a day or make it a rest day.')}</div>
    </>}

    {/* ---- routines ---- */}
    <div className="eyebrow" style={{ margin: '24px 0 10px' }}>{t('Your routines')}</div>
    {S.routines.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{S.routines.map(r => {
      const day = dayOf(r), last = lastDone(r)
      return <div key={r.id} className="card plan-routine">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="avatar-l"><Icon name={glyphOf(r.emoji)} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 18, textTransform: 'capitalize', letterSpacing: '-.015em' }}>{r.name}</div>
            <div className="muted small" style={{ marginTop: 2 }}>{[exCount(r.ex.length), r.ex.length ? '~' + routineMinutes(r) + ' min' : null].filter(Boolean).join(' · ')}</div>
            {routineMuscles(r) && <div className="small" style={{ marginTop: 2 }}>{routineMuscles(r)}</div>}
            <div className="small dim" style={{ marginTop: 4 }}>
              {day ? t('Every {0}', day) : t('Not on the week yet')}{last ? ' · ' + t('Last time: {0}', fmtDate(last, true)) : ''}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <Button size="sm" variant="tinted" icon="list" style={{ flex: 1 }} onClick={() => nav('/plan/r/' + r.id)}>{t('See exercises')}</Button>
          {r.ex.length > 0 && <Button size="sm" variant="primary" icon="play" style={{ flex: 1 }} onClick={() => startFlow(r.id)}>{t('Start')}</Button>}
        </div>
      </div>
    })}</div> : <>
      <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Let the trainer build your week, load a ready-made plan, or create one by hand.')}</div>
    </>}
    <div className="row" style={{ gap: 8, marginTop: 10 }}>
      <Button size="sm" icon="plus" style={{ flex: 1 }} onClick={addRoutine}>{t('Create a routine by hand')}</Button>
      {!S.routines.length && <Button size="sm" style={{ flex: 1 }} onClick={loadStarterPlan}>{t('Example gym plan (barbell)')}</Button>}
    </div>

    {/* ---- trainer ---- */}
    <div className="card" style={{ marginTop: 22 }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <span className="lrow-i" style={{ '--tint': 'var(--acc)', color: 'var(--on-acc)', width: 40, height: 40, borderRadius: 12 }}><Icon name="sparkles" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{S.trainer ? t('Change my plan') : t('Want us to build your plan?')}</div>
          <div className="dim small">{S.trainer ? t('Different days, equipment or goal: answer again and the week is rebuilt.') : t('Five quick questions and your week is ready.')}</div>
        </div>
        <Button size="sm" variant="tinted" onClick={trainerSheet}>{S.trainer ? t('Change') : t('Start')}</Button>
      </div>
    </div>
  </>
}
