import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import { trainerSheet } from '../sheets-trainer.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <div className="row" style={{ gap: 6 }}>
        <button className="iconbtn" onClick={trainerSheet} aria-label={t('AI trainer')} title={t('AI trainer')} style={{ color: 'var(--violet)' }}><Icon name="sparkles" /></button>
        <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
      </div>
    </div>
    {S.trainer && <div className="card tappable" style={{ cursor: 'pointer', padding: 12 }} onClick={trainerSheet}>
      <div className="row between"><div className="row" style={{ gap: 9 }}><span className="lrow-i" style={{ '--tint': 'var(--violet)' }}><Icon name="sparkles" /></span>
        <div><div className="lbl2" style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--label-3)', fontWeight: 500 }}>{t('AI trainer')}</div><div className="ttl" style={{ fontWeight: 500 }}>{S.trainer.split || t('Your plan')} · {t('rebuild or tweak')}</div></div></div>
        <Icon name="chevronRight" className="chev" /></div>
    </div>}
    <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={trainerSheet}>{t('Build my plan with the AI trainer')}</Button>
        <div style={{ height: 8 }} /><Button onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </div></div>
  </>
}
