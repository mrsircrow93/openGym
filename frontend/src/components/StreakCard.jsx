// "Hitos" strip for a section: current streak with a big flame, best streak, badges earned in
// the category, and the category's badges in a row (earned in colour, the rest grey). Tapping
// a badge or "All" opens the achievements page.
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Badge from './Badge.jsx'

export default function StreakCard({ title, unitWord, streak, badges, color = 'var(--orange)', icon = 'flame' }) {
  const nav = useNavigate()
  const earned = badges.filter(b => b.earned).length
  const next = badges.filter(b => !b.earned).sort((a, b) => b.pct - a.pct)[0]
  return <div className="card streak-card">
    <div className="row between" style={{ marginBottom: 10 }}>
      <div className="eyebrow">{title}</div>
      <button className="linkbtn small" onClick={() => nav('/badges')}>{t('All')}</button>
    </div>
    <div className="streak-top">
      <div className="streak-flame" style={{ '--c': color }}>
        <Icon name={icon} />
        <b>{streak.current}</b>
      </div>
      <div className="streak-facts">
        <div><b>{t(unitWord, streak.current)}</b><span>{t('current streak')}</span></div>
        <div><b>{t(unitWord, streak.best)}</b><span>{t('best streak')}</span></div>
        <div><b>{earned}/{badges.length}</b><span>{t('badges')}</span><i className="streak-bar"><i style={{ width: (badges.length ? earned / badges.length * 100 : 0) + '%' }} /></i></div>
      </div>
    </div>
    <div className="streak-badges">
      {badges.map(b => <button key={b.id} className="streak-badge" onClick={() => nav('/badges')} title={b.desc}>
        <Badge badge={b} size={54} locked={!b.earned} />
        <span className={b.earned ? '' : 'dim'}>{b.name}</span>
      </button>)}
    </div>
    {next && <div className="small dim" style={{ marginTop: 6 }}>{t('Next: {0} — {1}', next.name, next.desc)}</div>}
  </div>
}
