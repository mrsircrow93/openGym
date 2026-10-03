// "Well done" moment when a daily goal is reached: confetti, the goal's icon, one warm line.
import { t } from '../lib/i18n.js'
import { GOAL_META } from '../lib/goals.js'
import Confetti from './Confetti.jsx'
import Icon from './Icon.jsx'
import { Button } from '../components/ui.jsx'

export default function GoalCelebration({ goals, close }) {
  const main = goals[0], meta = GOAL_META[main.id]
  return <div style={{ textAlign: 'center', padding: '6px 4px 2px' }}>
    <Confetti />
    <div className="badge-glow" style={{ display: 'inline-flex', marginBottom: 10 }}>
      <span className="badge-pop" style={{ width: 92, height: 92, borderRadius: 28, background: 'color-mix(in srgb,' + meta.color + ' 18%,var(--surface))', color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44 }}><Icon name={meta.icon} /></span>
    </div>
    <div className="eyebrow" style={{ color: meta.color }}>{t('Well done')}</div>
    <h3 style={{ margin: '4px 0 8px' }}>{t(meta.title)}</h3>
    <div className="muted" style={{ lineHeight: 1.5, marginBottom: 8 }}>{t(meta.body, main.detail)}</div>
    {goals.length > 1 && <div className="small dim" style={{ marginBottom: 8 }}>{t('Also today:')} {goals.slice(1).map(g => t(GOAL_META[g.id].title).replace('!', '')).join(' · ')}</div>}
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={close}>{t('Keep it up!')}</Button>
  </div>
}
