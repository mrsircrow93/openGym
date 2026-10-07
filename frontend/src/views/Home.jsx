import { useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW, setsDone, workoutVolume } from '../lib/history.js'
import { fmtNum, fmtDate, fmtDur, fmtVol, fmtWater, todayISO, isoOf, weekKey, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { daysLeft } from '../lib/entitlements.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, bwDeltaColor, coachSheet, COACH_QUESTIONS, waterSheet, addWater, waterToday } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { exOr } from '../lib/exercises.js'
import { macroGoalOf, dayTotals, mealsOn, pctOf } from '../lib/nutrition.js'
import { analyzeMealSheet } from '../sheets-nutrition.jsx'
import { trainerSheet } from '../sheets-trainer.jsx'
import { CheckinCard } from '../sheets-checkin.jsx'
import { COACHES, coachOf } from '../lib/coach.js'
import CoachAvatar from '../components/CoachAvatar.jsx'
import Ring from '../components/Ring.jsx'
import { stepsSheet } from '../sheets-steps.jsx'
import { stepsOn, stepGoalOf, stepPct } from '../lib/steps.js'
import { authResendVerify, api } from '../lib/api.js'
import { useUI } from '../store/useUI.js'

// Home = what to do now, then a glance at today. Deep charts & history live in Stats.
// Layout follows design/sleek/02-inicio.png: greeting, one hero card with the single primary
// action, the coach note, two goal tiles, body weight, then the week and the small stuff.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const user = useStore(s => s.user)
  // maintenance banner set from the admin console (System → banner); empty = nothing shown
  const [banner, setBanner] = useState('')
  useEffect(() => { api('/api/config').then(c => setBanner(c.banner || '')).catch(() => {}) }, [])
  const [weekOffset, setWeekOffset] = useState(0)
  const mealPhoto = useRef(null)

  const today = new Date()
  const routine = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  // Today's session is logged: the card celebrates it instead of offering the same workout again.
  // Training twice is still possible, just not the default next step.
  const doneToday = [...S.workouts].reverse().find(w => w.d === todayISO()) || null
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
  const coach = coachOf(S)
  const toastU = useUI(s => s.toast)
  const hasAnyData = S.workouts.length > 0 || (S.meals || []).length > 0 || S.bodyweight.length > 0
  const exNames = routine ? routine.ex.slice(0, 3).map(e => exOr(e.id).n).join(', ') + (routine.ex.length > 3 ? '…' : '') : ''

  const onToday = () => { if (S.active) nav('/workout'); else if (routine) startFlow(routine.id); else dayOverrideSheet(todayISO()) }
  const firstName = user ? user.name.split(' ')[0] : ''

  return <div className="narrow">
    <div className="hdr" style={{ alignItems: 'center' }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>{firstName ? t('Hi {0}', firstName) + '! 👋' : 'VantixGym'}</h1>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {streak > 0 && <button className="pill" onClick={() => calendarSheet()}><Icon name="flame" style={{ color: 'var(--orange)' }} />{t('{0} wk', streak)}</button>}
        <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
      </div>
    </div>
    {banner && <div className="card banner" style={{ width: '100%', textAlign: 'left', borderColor: 'var(--orange)' }}><div className="row" style={{ gap: 10, alignItems: 'center' }}><Icon name="wrench" style={{ color: 'var(--orange)', fontSize: 20 }} /><div className="small" style={{ fontWeight: 600 }}>{banner}</div></div></div>}
    {user && user.email && !user.emailVerified && <button className="card tappable banner" style={{ width: '100%', textAlign: 'left' }}
      onClick={() => authResendVerify().then(() => toastU(t('Sent — check your inbox'))).catch(e => toastU(e.message))}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Icon name="bell" style={{ color: 'var(--orange)', fontSize: 20 }} />
        <div style={{ flex: 1, minWidth: 0 }}><b>{t('Confirm your email')}</b><div className="dim small">{t('We sent a link to {0}. Tap here to send it again.', user.email)}</div></div>
      </div>
    </button>}

    {user?.billing?.status === 'trial' && daysLeft(user.billing.trialEnds) <= 2 && <button className="card tappable banner" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav('/plans')}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Icon name="crown" style={{ color: 'var(--yellow)', fontSize: 20 }} />
        <div style={{ flex: 1, minWidth: 0 }}><b>{daysLeft(user.billing.trialEnds) <= 1 ? t('Your trial ends today') : t('Your trial ends on {0}', new Date(user.billing.trialEnds).toLocaleDateString(dateLocale(), { weekday: 'long' }))}</b><div className="dim small">{t('No automatic charge. Pick a plan to keep your coach and your progress.')}</div></div>
        <Icon name="chevronRight" className="dim" />
      </div>
    </button>}

    {/* the one thing to do now */}
    <div className={'card' + (routine || S.active || doneToday ? ' hero' : '')}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className={'pill' + (S.active || doneToday ? '' : routine ? ' acc' : '')} style={S.active ? { background: 'color-mix(in srgb,var(--orange) 16%,transparent)', color: 'var(--orange)' } : doneToday ? { background: 'color-mix(in srgb,var(--green) 16%,transparent)', color: 'var(--green)' } : undefined}>
          <Icon name={S.active ? 'timer' : doneToday ? 'checkCircle' : routine ? 'play' : 'moon'} />
          {S.active ? t('In progress') : doneToday ? t('Done today') : routine ? t('Next routine') : t('Today')}
        </span>
        <span className="dim small">{todayOvr && routine && !doneToday ? t('rescheduled') : t('Today')}</span>
      </div>
      <div className="big" style={{ textTransform: 'capitalize' }}>{S.active ? S.active.name : doneToday ? doneToday.name : routine ? routine.name : t('Rest day')}</div>
      <div className="muted small" style={{ marginTop: 4, marginBottom: 16 }}>
        {S.active ? t('Pick up where you left off')
          : doneToday ? t('{0} sets · {1}', setsDone(doneToday), fmtDur((doneToday.end || doneToday.start) - doneToday.start)) + ' · ' + fmtVol(doneToday.vol ?? workoutVolume(doneToday), S.unit || 'kg') + (doneToday.prs?.length ? ' · ' + t('{0} PR', doneToday.prs.length) : '')
            : routine ? t('{0} exercises', routine.ex.length) + (exNames ? ' · ' + exNames : '') : t('Recover well — or move a session here.')}
      </div>
      {S.active
        ? <Button variant="primary" icon="play" onClick={onToday} style={{ background: 'var(--orange)', color: '#000', boxShadow: 'none' }}>{t('Resume workout')}</Button>
        : doneToday
          ? <div className="row" style={{ gap: 8 }}>
            <Button style={{ flex: 1 }} icon="chart" onClick={() => nav('/history')}>{t('See summary')}</Button>
            <Button style={{ flex: 1 }} variant="tinted" icon="play" onClick={onToday}>{t('Train again')}</Button>
          </div>
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
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Answer five quick questions and your trainer builds a week around your goal — or load a ready-made Push / Pull / Legs plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={trainerSheet}>{t('Build my plan with the trainer')}</Button>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <Button style={{ flex: 1 }} onClick={loadStarterPlan}>{t('Example gym plan (barbell)')}</Button>
          <Button style={{ flex: 1 }} onClick={() => nav('/plan')}>{t('Build my own')}</Button>
        </div>
      </div>
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
        <Button size="sm" variant="tinted" icon="camera" style={{ width: '100%', whiteSpace: 'nowrap' }} onClick={() => mealPhoto.current?.click()}>{t('Snap a meal')}</Button>
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

    <CheckinCard S={S} compact />

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

    {hasAnyData && !coach && (
      <div className="card coach-card">
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.012em' }}>{t('Choose your coach')}</div>
        <div className="dim small" style={{ marginTop: 2 }}>{t('They will read your training and food and answer your questions. You can change later in Settings.')}</div>
        <div className="coach-pick">
          {COACHES.map(c => <button key={c.id} className="coach-opt tappable" onClick={() => update(s => { s.coach = c.id })}>
            <CoachAvatar gender={c.gender} size={72} />
            <span>{c.name}</span>
            <span className="dim small" style={{ fontWeight: 500, lineHeight: 1.25 }}>{t(c.desc)}</span>
          </button>)}
        </div>
      </div>
    )}

    {hasAnyData && coach && (
      <div className="card coach-card">
        <button className="row tappable" style={{ gap: 12, alignItems: 'center', width: '100%', textAlign: 'left' }} onClick={() => coachSheet()}>
          <span className="coach-avatar"><CoachAvatar gender={coach.gender} size={44} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.012em' }}>{t('{0} is here to help', coach.name)}</div>
            <div className="dim small">{t('{0} this week', wThisWeek + (plannedPerWeek ? '/' + plannedPerWeek : ''))} · {t('ask anything')}</div>
          </div>
          <Icon name="chevronRight" style={{ color: 'var(--label-3)' }} />
        </button>
        <div className="coach-qs">
          {COACH_QUESTIONS.map(q => <button key={q} className="coach-q tappable" onClick={() => coachSheet(q)}>
            <span>{t(q)}</span><Icon name="chevronRight" />
          </button>)}
          <button className="coach-q tappable" onClick={() => coachSheet()}>
            <span>{t('Ask something else')}</span><Icon name="chevronRight" />
          </button>
        </div>
      </div>
    )}

    <input ref={mealPhoto} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) analyzeMealSheet(f, todayISO()) }} />
  </div>
}
