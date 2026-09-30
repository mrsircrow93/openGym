import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet, deleteRoutine, startFlow } from '../sheets.jsx'
import { trainerSheet } from '../sheets-trainer.jsx'
import SwipeRow from '../components/SwipeRow.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { DEFAULT_GLYPH } from '../lib/glyphs.js'
import { exOr } from '../lib/exercises.js'

// Layout follows design/sleek/03-plan.png: the AI builder as the hero, then one card per
// routine (letter, day, last done, first exercises), then the week grid to move days around.
export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }
  const daysPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const dayOf = r => { const d = Object.keys(S.week).find(k => S.week[k] === r.id); return d == null ? null : t(DAYN[+d]) }
  const lastDone = r => { const w = [...S.workouts].reverse().find(w => w.routineId === r.id || w.name === r.name); return w ? w.d : null }

  return <>
    <div className="hdr">
      <div><h1>{t('My routines')}</h1><div className="sub">{S.routines.length ? t('{0} routines · {1} days a week', S.routines.length, daysPerWeek) : t('Your weekly routine')}</div></div>
      <div className="row" style={{ gap: 6 }}>
        <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
        <button className="iconbtn on-ss" onClick={addRoutine} aria-label={t('New')} title={t('New')}><Icon name="plus" /></button>
      </div>
    </div>

    <div className="card hero">
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <span className="pill acc"><Icon name="sparkles" />{S.trainer ? t('Personal trainer') : t('New')}</span>
        <span className="small" style={{ color: 'var(--acc)', fontWeight: 600 }}>{S.trainer ? (S.trainer.split || t('Your plan')) : t('Personalised routines')}</span>
      </div>
      <div className="big" style={{ fontSize: 24 }}>{S.trainer ? t('Adjust my plan') : t('Build my routine for me')}</div>
      <div className="muted small" style={{ margin: '4px 0 14px', lineHeight: 1.45 }}>{S.trainer ? t('Change your days, equipment or goal and the trainer rebuilds the week.') : t('Answer four quick questions and we build a plan around your equipment and goal.')}</div>
      <Button variant="primary" size="sm" trailingIcon="chevronRight" onClick={trainerSheet}>{S.trainer ? t('Rebuild or tweak') : t('Start questionnaire')}</Button>
    </div>

    <div className="cols"><div>
      <div className="row between" style={{ marginTop: 18, marginBottom: 10 }}>
        <div className="eyebrow">{t('Your routines')}</div>
        {S.routines.length > 0 && <span className="dim small">{t('Swipe for options')}</span>}
      </div>
      {S.routines.length ? <div className="list">{S.routines.map((r, i) => {
        const day = dayOf(r), last = lastDone(r)
        const names = r.ex.slice(0, 3).map(e => exOr(e.id).n)
        return <SwipeRow key={r.id} actions={[
          { icon: 'pencil', label: t('Edit'), onClick: () => nav('/plan/r/' + r.id) },
          { icon: 'trash', label: t('Delete'), danger: true, onClick: () => deleteRoutine(r.id) }
        ]}>
          <div className="item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: 14 }} onClick={() => nav('/plan/r/' + r.id)}>
            <div className="row" style={{ gap: 12 }}>
              <span className="avatar-l">{String.fromCharCode(65 + (i % 26))}</span>
              <div className="grow">
                <div className="tt" style={{ fontWeight: 700, fontSize: 17, textTransform: 'capitalize' }}>{r.name}</div>
                <div className="ss">{exCount(r.ex.length)}</div>
                {last && <div className="small" style={{ color: 'var(--acc)', marginTop: 2 }}>{t('Last time: {0}', fmtDate(last, true))}</div>}
              </div>
              <div className="row" style={{ gap: 8, flex: 'none' }}>
                {day && <span className="pill">{day}</span>}
                {r.ex.length > 0 && <button className="iconbtn on-ss" aria-label={t('Start')} onClick={e => { e.stopPropagation(); startFlow(r.id) }}><Icon name="play" /></button>}
              </div>
            </div>
            {names.length > 0 && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {names.map((n, k) => <span key={k} className="tag">{n}</span>)}
              {r.ex.length > 3 && <span className="tag nocap">+{r.ex.length - 3} {t('more')}</span>}
            </div>}
          </div>
        </SwipeRow>
      })}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
        <div style={{ height: 8 }} /><Button variant="tinted" icon="plus" onClick={addRoutine}>{t('Build my own')}</Button>
      </>}
    </div><div>
      <div className="eyebrow" style={{ margin: '22px 0 10px' }}>{t('Week schedule')}</div>
      <div className="list" style={{ display: 'flex', flexDirection: 'column', gap: 0, background: 'var(--surface)', borderRadius: 'var(--r-card)', overflow: 'hidden' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          return <button key={d} className="lrow tap" onClick={() => dayAssignSheet(d)}>
            <span className="lrow-m"><span className="lrow-t">{t(DAYN[d])}</span></span>
            {r ? <span className="pill acc" style={{ textTransform: 'capitalize' }}>{r.name}</span> : <span className="dim small">{t('Rest')}</span>}
            <Icon name="chevronRight" className="lrow-c" />
          </button>
        })}
      </div>
    </div></div>
  </>
}
