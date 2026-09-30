import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW } from '../lib/history.js'
import { fmtNum, fmtDate, fmtWater, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor, coachSheet, waterSheet, addWater, waterToday } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { exOr } from '../lib/exercises.js'
import { macroGoalOf, dayTotals, mealsOn, pctOf } from '../lib/nutrition.js'
import { analyzeMealSheet } from '../sheets-nutrition.jsx'
import { trainerSheet } from '../sheets-trainer.jsx'
import { stepsSheet } from '../sheets-steps.jsx'
import { stepsOn, stepGoalOf, stepPct } from '../lib/steps.js'

// A goal ring: the one shape the redesign uses for "how far along today" (steps, calories).
export function Ring({ pct, size = 64, stroke = 7, color = 'var(--acc)', children }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct || 0))
  return <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)} style={{ transition: 'stroke-dashoffset .4s var(--ease)' }} />
    </svg>
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>{children}</div>
  </div>
}

// Home = what to do now, then a glance at today. Deep charts & history live in Stats.
// Layout follows design/sleek/02-inicio.png: greeting, one hero card with the single primary
// action, the coach note, two goal tiles, body weight, then the week and the small stuff.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weekOffset, setWeekOffset] = useState(0)
  const mealPhoto = useRef(null)

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineId(S, iso), ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} onClick={() => dayOverrideSheet(iso)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d) === weekKey(todayISO())).length
  const plannedPerWeek = Object.keys(S.week).filter(k => S.week[k]).length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const water = waterToday(S)
  const waterGoal = S.waterGoal || 2000
  const waterPct = Math.min(100, Math.round((water / waterGoal) * 100))
  const macroGoal = macroGoalOf(S)
  const foodToday = dayTotals(S, todayISO())
  const mealsToday = mealsOn(S, todayISO()).length
  const steps = stepsOn(S, todayISO())
  const stepGoal = stepGoalOf(S)
  const streak = streakWeeks(S)
  const exNames = routine ? routine.ex.slice(0, 3).map(e => exOr(e.id).n).join(', ') + (routine.ex.length > 3 ? '…' : '') : ''

  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else dayOverrideSheet(todayISO()) }
  const firstName = user ? user.name.split(' ')[0] : ''

  return <div className="narrow">
    <div className="hdr" style={{ alignItems: 'center' }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>{firstName ? t('Hi {0}', firstName) + '! 👋' : 'openGym'}</h1>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {streak > 0 && <button className="pill" onClick={() => calendarSheet()}><Icon name="flame" style={{ color: 'var(--orange)' }} />{t('{0} wk', streak)}</button>}
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
      </div>
    </div>

    {/* the one thing to do now */}
    <div className={'card' + (routine || S.active ? ' hero' : '')}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className={'pill' + (S.active ? '' : ' acc')} style={S.active ? { background: 'color-mix(in srgb,var(--orange) 16%,transparent)', color: 'var(--orange)' } : undefined}>
          <Icon name={S.active ? 'timer' : routine ? 'play' : 'moon'} />
          {S.active ? t('In progress') : routine ? t('Next routine') : t('Today')}
        </span>
        <span className="dim small">{todayOvr && routine ? t('rescheduled') : t('Today')}</span>
      </div>
      <div className="big" style={{ textTransform: 'capitalize' }}>{S.active ? S.active.name : routine ? routine.name : t('Rest day')}</div>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 16 }}>
        {S.active ? t('Pick up where you left off') : routine ? t('{0} exercises', routine.ex.length) + (exNames ? ' · ' + exNames : '') : t('Recover well — or move a session here.')}
      </div>
      {S.active
        ? <Button variant="primary" icon="play" onClick={onToday} style={{ background: 'var(--orange)', color: '#000', boxShadow: 'none' }}>{t('Resume workout')}</Button>
        : routine
          ? <Button variant="primary" icon="play" onClick={onToday}>{t('Start workout')}</Button>
          : <Button variant="tinted" icon="calendar" onClick={onToday}>{t('Train anyway')}</Button>}
    </div>

    {!S.routines.length && !S.active && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i" style={{ '--tint': 'var(--purple)' }}><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Answer five quick questions and the AI trainer builds a week around your goal — or load a ready-made Push / Pull / Legs plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={trainerSheet}>{t('Build my plan with the AI trainer')}</Button>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Button style={{ flex: 1 }} onClick={loadStarterPlan}>{t('Starter plan (PPL)')}</Button>
          <Button style={{ flex: 1 }} onClick={() => nav('/plan')}>{t('Build my own')}</Button>
        </div>
      </div>
    )}

    {S.workouts.length > 0 && (
      <button className="card tappable" style={{ width: '100%', textAlign: 'left', display: 'block' }} onClick={coachSheet}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="lrow-i" style={{ '--tint': 'var(--teal)', color: '#0d211c', width: 36, height: 36, borderRadius: 12 }}><Icon name="sparkles" /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row between"><span className="eyebrow" style={{ color: 'var(--teal)' }}>{t('AI coach')}</span><span className="dim small">{t('{0} this week', wThisWeek + (plannedPerWeek ? '/' + plannedPerWeek : ''))}</span></div>
            <div className="small" style={{ marginTop: 4, lineHeight: 1.4 }}>{t('Get a read-out on your recent training')}</div>
          </div>
        </div>
      </button>
    )}

    <div className="tiles">
      <button className="tile tappable" style={{ textAlign: 'left' }} onClick={stepsSheet}>
        <div className="l"><Icon name="footsteps" style={{ color: 'var(--teal)' }} />{t('Steps')}</div>
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          <Ring pct={stepPct(steps, stepGoal)} color={steps >= stepGoal ? 'var(--acc)' : 'var(--teal)'}>{stepPct(steps, stepGoal)}%</Ring>
          <div style={{ minWidth: 0 }}>
            <div className="v" style={{ marginTop: 0, fontSize: 24 }}>{fmtNum(steps)}</div>
            <div className="dim small">{t('goal {0}', fmtNum(stepGoal))}</div>
          </div>
        </div>
        <div className="small" style={{ marginTop: 10, color: steps >= stepGoal ? 'var(--acc)' : 'var(--label-2)' }}>{steps >= stepGoal ? t('goal reached!') : t('{0} to go', fmtNum(stepGoal - steps))}</div>
      </button>
      <button className="tile tappable" style={{ textAlign: 'left' }} onClick={() => nav('/nutrition')}>
        <div className="l"><Icon name="flame" style={{ color: 'var(--orange)' }} />{t('Calories')}</div>
        <div className="v" style={{ fontSize: 24 }}>{fmtNum(foodToday.kcal)} <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>/ {fmtNum(macroGoal.kcal)}</span></div>
        <div className="macros compact" style={{ marginTop: 8, gap: 5 }}>
          {[['protein', t('Protein'), 'var(--blue)'], ['carbs', t('Carbs'), 'var(--orange)'], ['fat', t('Fat'), 'var(--red)']].map(([k, l, c]) => <div key={k} className="mrow" style={{ gridTemplateColumns: '1fr auto' }}>
            <span className="ml" style={{ fontSize: 11 }}>{l}</span><span className="mv" style={{ fontSize: 11 }}>{fmtNum(foodToday[k])}/{fmtNum(macroGoal[k])}g</span>
            <span className="mb"><i style={{ width: pctOf(foodToday[k], macroGoal[k]) + '%', background: c }} /></span>
          </div>)}
        </div>
      </button>
      <div className="tile">
        <div className="l"><Icon name="utensils" style={{ color: 'var(--orange)' }} />{t('Nutrition')}</div>
        <div className="dim small" style={{ margin: '6px 0 10px' }}>{mealsToday ? t(mealsToday === 1 ? '{0} meal' : '{0} meals', mealsToday) : t('Nothing logged yet')}</div>
        <Button size="sm" variant="tinted" icon="camera" style={{ width: '100%' }} onClick={() => mealPhoto.current?.click()}>{t('Snap a meal')}</Button>
      </div>
      <div className="tile">
        <div className="l"><Icon name="droplet" style={{ color: 'var(--blue)' }} />{t('Water')}</div>
        <div className="dim small" style={{ margin: '6px 0 8px' }}>{fmtWater(water)} / {fmtWater(waterGoal)}</div>
        <div className="wprog" style={{ marginBottom: 10 }}><i style={{ width: waterPct + '%', background: water >= waterGoal ? 'var(--acc)' : 'var(--blue)' }} /></div>
        <div className="row" style={{ gap: 6 }}>
          <Button size="xs" icon="plus" style={{ flex: 1 }} onClick={() => addWater(250)}>250</Button>
          <Button size="xs" icon="plus" style={{ flex: 1 }} onClick={() => addWater(500)}>500</Button>
          <Button size="xs" icon="list" onClick={() => waterSheet()} aria-label={t('Water')} />
        </div>
      </div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="eyebrow">{t('Body weight')}</div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="xs" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="xs" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>{S.unit}</span></div>
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 600, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={120} unit={S.unit} goal={S.targetW} /></div>
      </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="eyebrow">{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      <div className="row between" style={{ marginTop: 12 }}>
        <div className="muted small">{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {t(S.workouts.length === 1 ? '{0} workout total' : '{0} workouts total', S.workouts.length)}</div>
        <Button size="xs" icon="calendar" onClick={() => calendarSheet()}>{t('Calendar')}</Button>
      </div>
    </div>

    <input ref={mealPhoto} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) analyzeMealSheet(f, todayISO()) }} />
  </div>
}
