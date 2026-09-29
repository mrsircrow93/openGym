// Step counter sheet + the Home card. Manual entry today; a native source on the store builds
// later writes through the same helpers (docs/STEPS.md). Maths in lib/steps.js.
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { fmtNum, fmtDate, todayISO, DAYS } from './lib/format.js'
import { t } from './lib/i18n.js'
import { lastBW } from './lib/history.js'
import { stepGoalOf, stepsOn, stepRow, stepPct, setSteps, addSteps, stepSeries, stepStreak, stepStats } from './lib/steps.js'
import Icon from './components/Icon.jsx'
import { Button, Stepper } from './components/ui.jsx'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

const QUICK = [500, 1000, 2500]

export function bumpSteps(delta) {
  let ok = true
  update(s => { ok = addSteps(s, todayISO(), delta) })
  if (!ok) toast(t('Today’s steps come from your phone — edit them there.'))
}

// Seven bars, today on the right, goal line implied by the bar height cap.
function WeekBars({ S }) {
  const goal = stepGoalOf(S)
  const series = stepSeries(S, todayISO(), 7)
  const max = Math.max(goal, ...series.map(x => x.n))
  return <div className="stepbars">
    {series.map(x => {
      const d = new Date(x.d + 'T12:00:00')
      const hit = x.n >= goal
      return <div key={x.d} className={'stepbar' + (x.d === todayISO() ? ' today' : '')}>
        <span className="v">{x.n ? fmtNum(Math.round(x.n / 100) / 10) + 'k' : ''}</span>
        <span className="b"><i style={{ height: Math.max(3, Math.round((x.n / max) * 100)) + '%', background: hit ? 'var(--acc)' : 'var(--teal)' }} /></span>
        <span className="l">{t(DAYS[d.getDay()])}</span>
      </div>
    })}
  </div>
}

function StepsSheet({ close }) {
  const S = useStore(s => s.S)
  const iso = todayISO()
  const n = stepsOn(S, iso)
  const goal = stepGoalOf(S)
  const row = stepRow(S, iso)
  const fromPhone = row && row.src === 'health'
  const streak = stepStreak(S, iso)
  const bw = lastBW(S)
  const stats = stepStats(n, { weightKg: bw ? (S.unit === 'lb' ? bw.w * 0.4536 : bw.w) : null })
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="footsteps" style={{ color: 'var(--teal)' }} />{t('Steps today')}</h3>
    <div className="muted small">{fmtDate(iso, true)}{fromPhone ? ' · ' + t('from your phone') : ''}</div>
    <div className="row" style={{ gap: 8, alignItems: 'baseline', margin: '10px 0 6px' }}>
      <div className="big">{fmtNum(n)}</div>
      <span className="dim small">/ {fmtNum(goal)}{n >= goal ? ' · ' + t('goal reached!') : ''}</span>
      <span className="dim small" style={{ marginLeft: 'auto' }}>{stats.km} km · {stats.kcal} kcal</span>
    </div>
    <div className="wprog" style={{ marginBottom: 14 }}><i style={{ width: stepPct(n, goal) + '%', background: n >= goal ? 'var(--acc)' : 'var(--teal)' }} /></div>
    {!fromPhone && <>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        {QUICK.map(q => <Button key={q} style={{ flex: 1 }} icon="plus" onClick={() => bumpSteps(q)}>{fmtNum(q)}</Button>)}
      </div>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Set today’s total')} value={n} step={100} decimal={false} onChange={v => update(s => setSteps(s, iso, v, 'manual'))} />
      </div>
      <div className="small dim" style={{ marginBottom: 14 }}>{t('Copy the number from your phone’s health app — it counts all day, the browser can’t.')}</div>
    </>}
    <h4 className="sec">{t('Last 7 days')}{streak > 1 ? ' · ' + t('{0}-day streak', streak) : ''}</h4>
    <WeekBars S={S} />
    <h4 className="sec">{t('Daily goal')}</h4>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      {/* Raw value while editing: clamping to 500 on every keystroke rewrote "1" → 500 before the
          user could finish typing 10000. stepGoalOf() applies the floor wherever the goal is read. */}
      <Stepper label={t('Steps')} value={S.stepGoal ?? goal} step={500} decimal={false} onChange={v => update(s => { s.stepGoal = Math.round(v) })} />
    </div>
    <div className="small dim" style={{ marginBottom: 12 }}>{t('7,000–10,000 a day is where the health benefits level off for most people. Pick one you’ll actually hit.')}</div>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const stepsSheet = () => ui().openSheet(close => <StepsSheet close={close} />)

// Home card: today vs goal + two quick adds. Mirrors the Water card so the two read alike.
export function StepsCard() {
  const S = useStore(s => s.S)
  const n = stepsOn(S, todayISO())
  const goal = stepGoalOf(S)
  const fromPhone = (stepRow(S, todayISO()) || {}).src === 'health'
  const hit = n >= goal
  return <div className="card">
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 className="row" style={{ margin: 0, gap: 7 }}><Icon name="footsteps" style={{ color: 'var(--teal)' }} />{t('Steps')}</h2>
      <Button size="sm" icon="list" onClick={stepsSheet}>{fmtNum(n)} / {fmtNum(goal)}</Button>
    </div>
    <div className="wprog" style={{ marginBottom: 10 }}><i style={{ width: stepPct(n, goal) + '%', background: hit ? 'var(--acc)' : 'var(--teal)' }} /></div>
    {fromPhone
      ? <div className="small dim">{t('Synced from your phone')}</div>
      : <div className="row" style={{ gap: 8 }}>
        <Button size="sm" icon="plus" style={{ flex: 1 }} onClick={() => bumpSteps(500)}>500</Button>
        <Button size="sm" icon="plus" style={{ flex: 1 }} onClick={() => bumpSteps(1000)}>1,000</Button>
        <Button size="sm" icon="pencil" style={{ flex: 1 }} onClick={stepsSheet}>{t('Set')}</Button>
      </div>}
  </div>
}
