import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { computeBadges, CATS, CAT_NAME, latestInCat, nextInCat } from '../lib/badges.js'
import Badge from '../components/Badge.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Achievements: one card per category with the latest badge earned (or the next one to get),
// and a sheet per category listing every badge, locked ones with progress.
function CategorySheet({ cat, badges, close }) {
  const list = badges.filter(b => b.cat === cat)
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="trophy" style={{ color: 'var(--acc)' }} />{t(CAT_NAME[cat])}</h3>
    <div className="badge-list">
      {list.map(b => <div key={b.id} className={'badge-row' + (b.earned ? '' : ' locked')}>
        <Badge badge={b} size={56} locked={!b.earned} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{b.name}</div>
          <div className="small dim">{b.desc}</div>
          {b.earned ? <div className="small" style={{ color: 'var(--acc)', marginTop: 2 }}>{t('Earned {0}', fmtDate(b.earned, true))}</div>
            : <div className="badge-prog"><i style={{ width: Math.round(b.pct * 100) + '%' }} /></div>}
        </div>
      </div>)}
    </div>
    <Button onClick={close} style={{ marginTop: 14 }}>{t('Close')}</Button>
  </>
}
export const badgeCatSheet = (cat, badges) => useUI.getState().openSheet(close => <CategorySheet cat={cat} badges={badges} close={close} />)

export default function Badges() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const badges = computeBadges(S)
  const earned = badges.filter(b => b.earned)
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('Achievements')}</h1><div className="sub">{t('{0} of {1} earned', earned.length, badges.length)}</div></div>
    </div>
    <div className="badge-grid">
      {CATS.map(cat => {
        const latest = latestInCat(badges, cat), next = nextInCat(badges, cat)
        const show = latest || next
        const catEarned = badges.filter(b => b.cat === cat && b.earned)
        return <button key={cat} className="card badge-card" onClick={() => badgeCatSheet(cat, badges)}>
          <div className="badge-card-t">{t(CAT_NAME[cat])}</div>
          {show && <Badge badge={show} size={104} locked={!latest} />}
          {latest ? <>
            <div className="badge-card-n">{latest.name}</div>
            <div className="small dim">{fmtDate(latest.earned, true)}</div>
          </> : next ? <>
            <div className="badge-card-n dim">{t('Next: {0}', next.name)}</div>
            <div className="badge-prog" style={{ width: '70%' }}><i style={{ width: Math.round(next.pct * 100) + '%' }} /></div>
          </> : null}
          <div className="row between" style={{ width: '100%', marginTop: 'auto', paddingTop: 10 }}>
            <div className="row" style={{ gap: 2 }}>{catEarned.slice(-3).map(b => <Badge key={b.id} badge={b} size={22} />)}{catEarned.length > 3 && <span className="small dim" style={{ marginLeft: 4 }}>+{catEarned.length - 3}</span>}</div>
            <span className="small" style={{ color: 'var(--acc)', fontWeight: 600 }}>{t('See all')}</span>
          </div>
        </button>
      })}
    </div>
  </div>
}

// Celebration sheet for badges just earned (opened from the app shell).
export function NewBadgesSheet({ ids, close }) {
  // Recomputed at render so names come out in the current language.
  const S = useStore(s => s.S)
  const list = computeBadges(S).filter(b => ids.includes(b.id))
  return <div style={{ textAlign: 'center' }}>
    <div className="eyebrow acc" style={{ marginBottom: 8 }}>{t(list.length === 1 ? 'New achievement' : 'New achievements')}</div>
    <div className="row" style={{ justifyContent: 'center', gap: 14, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {list.slice(0, 3).map(b => <div key={b.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, maxWidth: 120 }}>
        <Badge badge={b} size={96} />
        <div style={{ fontWeight: 700, lineHeight: 1.2 }}>{b.name}</div>
      </div>)}
    </div>
    {list.length > 3 && <div className="small dim" style={{ marginBottom: 10 }}>{t('and {0} more', list.length - 3)}</div>}
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Keep it up — every workout counts.')}</div>
    <Button variant="primary" onClick={close}>{t('Nice!')}</Button>
  </div>
}
