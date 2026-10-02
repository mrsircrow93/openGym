// Personal trainer: a five-step questionnaire, then a plan preview you can apply as-is, add to what
// you have, or regenerate. Plan maths + validation live in lib/trainer.js.
import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { fmtNum, DAYN, uid } from './lib/format.js'
import { t } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { exOr } from './lib/exercises.js'
import { lastBW, exLine } from './lib/history.js'
import { aiTrainerPlan, aiErrorMessage } from './lib/api.js'
import {
  GOALS, GOAL_LABEL, GOAL_ICON, LEVELS, LEVEL_LABEL, LEVEL_DESC, EQUIP, EQUIP_LABEL, EQUIP_ICON,
  SESSION_LENGTHS, FOCUS, DEFAULT_ANSWERS, trainerCandidates, materializePlan, trainerRequestBody
} from './lib/trainer.js'
import { macroGoalOf } from './lib/nutrition.js'
import { glyphOf } from './lib/glyphs.js'
import { routineMinutes, routineMuscles, setsLabel } from './lib/routine.js'
import { Thumb } from './components/Media.jsx'
import Icon from './components/Icon.jsx'
import { Button, Stepper, TextArea, Row, Check } from './components/ui.jsx'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

const STEPS = 5

function Choice({ options, value, onChange, label, desc, icon, multi }) {
  const on = v => (multi ? (value || []).includes(v) : value === v)
  const pick = v => multi ? onChange(on(v) ? value.filter(x => x !== v) : [...(value || []), v]) : onChange(v)
  return <div className="sect-b" style={{ marginBottom: 12 }}>
    {options.map(o => <button key={o} className="lrow tap" onClick={() => pick(o)}>
      {icon && <span className="lrow-i" style={{ '--tint': on(o) ? 'var(--acc)' : 'var(--surface-3)' }}><Icon name={icon[o]} /></span>}
      <span className="lrow-m"><span className="lrow-t">{t(label[o])}</span>{desc && <span className="lrow-s">{t(desc[o])}</span>}</span>
      {on(o) && <Icon name="check" className="lrow-k" />}
    </button>)}
  </div>
}

function Trainer({ close }) {
  const S = useStore.getState().S
  const prev = (S.trainer && S.trainer.answers) || {}
  const [a, setA] = useState({ ...DEFAULT_ANSWERS, weight: lastBW(S)?.w || null, targetW: S.targetW || null, ...prev })
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)      // { plan, routines, week, dropped, candidates }
  const [applyNutrition, setApplyNutrition] = useState(true)
  const [openRoutine, setOpenRoutine] = useState(null)
  const [moreSummary, setMoreSummary] = useState(false)
  const set = patch => setA(x => ({ ...x, ...patch }))

  const build = async () => {
    setBusy(true); setErr('')
    try {
      const candidates = trainerCandidates(S, a.equipment)
      const mock = import.meta.env.DEV ? (() => { try { return JSON.parse(localStorage.getItem('vx_mock_plan')) } catch { return null } })() : null
      const plan = mock || await aiTrainerPlan(trainerRequestBody(S, a, candidates))
      const m = materializePlan(plan, candidates)
      if (!m.routines.length) throw new Error(t('The plan came back empty — try again'))
      setRes({ plan, ...m })
    } catch (e) { setErr(aiErrorMessage(e)) }
    setBusy(false)
  }

  const apply = replace => {
    const { plan, routines, week } = res
    update(s => {
      if (replace) { s.routines = []; s.week = {}; s.dayPlan = {} }
      s.routines.push(...routines)
      for (const d in week) s.week[d] = week[d]
      if (applyNutrition && plan.nutrition) s.macroGoal = { ...macroGoalOf(s), kcal: plan.nutrition.kcal, protein: plan.nutrition.protein, carbs: plan.nutrition.carbs, fat: plan.nutrition.fat }
      s.trainer = { answers: a, at: Date.now(), split: plan.split, summary: plan.summary }
    })
    close()
    toast(t('Plan ready — see your week'))
    nav('/plan')
  }

  /* ---------- result ---------- */
  if (res) {
    const { plan, routines, week, dropped } = res
    const daysOf = id => Object.keys(week).filter(d => week[d] === id).map(d => t(DAYN[+d]).slice(0, 3))
    const n = plan.nutrition
    const daysPerWeek = Object.keys(week).length
    const minutes = routines.length ? Math.round(routines.reduce((acc, r) => acc + routineMinutes(r), 0) / routines.length / 5) * 5 : 0
    const summary = String(plan.summary || '')
    const shortSummary = summary.length > 220 && !moreSummary ? summary.slice(0, 200).replace(/\s+\S*$/, '') + '…' : summary
    return <>
      <h3 className="row" style={{ gap: 8 }}><Icon name="sparkles" style={{ color: 'var(--acc)' }} />{plan.split || t('Your plan')}</h3>
      <div className="tr-stats">
        <div><b>{daysPerWeek}</b><span>{t('days a week')}</span></div>
        <div><b>~{minutes}</b><span>{t('min per session')}</span></div>
        <div><b>{routines.length}</b><span>{t(routines.length === 1 ? 'routine' : 'routines')}</span></div>
      </div>
      {summary && <div className="small muted" style={{ lineHeight: 1.5, margin: '10px 0 4px' }}>{shortSummary}{summary.length > 220 && <button className="linkbtn" style={{ marginLeft: 6 }} onClick={() => setMoreSummary(v => !v)}>{moreSummary ? t('Less') : t('Read more')}</button>}</div>}

      <div className="eyebrow" style={{ margin: '14px 0 8px' }}>{t('Your week')}</div>
      <div className="tr-week">
        {[1, 2, 3, 4, 5, 6, 0].map(d => { const r = routines.find(x => x.id === week[d]); return <div key={d} className={'tr-day' + (r ? ' on' : '')}>
          <span className="tr-day-n">{t(DAYN[d]).slice(0, 1)}</span>
          <span className="tr-day-i">{r ? <Icon name={glyphOf(r.emoji)} /> : <Icon name="moon" />}</span>
          <span className="tr-day-t">{r ? r.name : t('Rest')}</span>
        </div> })}
      </div>

      <div className="eyebrow" style={{ margin: '16px 0 8px' }}>{t('Your routines')}</div>
      {routines.map(r => {
        const open = openRoutine === r.id
        const shown = open ? r.ex : r.ex.slice(0, 3)
        return <div key={r.id} className="card" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="avatar-l" style={{ fontSize: 22 }}><Icon name={glyphOf(r.emoji)} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-.012em' }}>{r.name}</div>
              <div className="muted small">{[t(r.ex.length === 1 ? '{0} exercise' : '{0} exercises', r.ex.length), '~' + routineMinutes(r) + ' min', routineMuscles(r)].filter(Boolean).join(' · ')}</div>
              {daysOf(r.id).length > 0 && <div className="row" style={{ gap: 5, marginTop: 6, flexWrap: 'wrap' }}>{daysOf(r.id).map(d => <span key={d} className="pill acc" style={{ padding: '3px 9px', fontSize: 12 }}>{d}</span>)}</div>}
            </div>
          </div>
          <div className="tr-ex">
            {shown.map((e, i) => { const x = exOr(e.id); return <div key={i} className="tr-ex-row">
              <Thumb ex={x} />
              <div className="tr-ex-n capitalize">{x.n}</div>
              <div className="tr-ex-s"><b>{setsLabel(e)}</b>{e.rest > 0 && <span>{t('rest {0}', Math.floor(e.rest / 60) + ':' + String(e.rest % 60).padStart(2, '0'))}</span>}</div>
            </div> })}
          </div>
          {r.ex.length > 3 && <button className="linkbtn small" style={{ marginTop: 8 }} onClick={() => setOpenRoutine(open ? null : r.id)}>{open ? t('Show fewer') : t('See all {0} exercises', r.ex.length)}</button>}
        </div>
      })}
      {plan.cardio && <div className="row small muted" style={{ gap: 6, alignItems: 'flex-start', margin: '4px 0 12px' }}><Icon name="figureRun" style={{ fontSize: 14, flex: 'none', marginTop: 2 }} /><span>{plan.cardio}</span></div>}
      {dropped > 0 && <div className="small dim" style={{ marginBottom: 10 }}>{t('{0} suggested exercise(s) weren’t in your library and were left out.', dropped)}</div>}
      {n && <div className="sect-b" style={{ margin: '6px 0 14px' }}>
        <button className="lrow tap" onClick={() => setApplyNutrition(v => !v)}>
          <Check checked={applyNutrition} onChange={() => {}} />
          <span className="lrow-m"><span className="lrow-t">{t('Also set my food targets')}</span>
            <span className="lrow-s">{fmtNum(n.kcal)} kcal · {t('Protein')} {n.protein} g · {t('Carbs')} {n.carbs} g · {t('Fat')} {n.fat} g</span></span>
        </button>
      </div>}
      <Button variant="primary" icon="check" onClick={() => apply(true)}>{S.routines.length ? t('Use this plan instead of mine') : t('Use this plan')}</Button>
      {S.routines.length > 0 && <><div style={{ height: 8 }} /><Button icon="plus" onClick={() => apply(false)}>{t('Add alongside my routines')}</Button></>}
      <div style={{ height: 8 }} /><Button variant="ghost" icon="shuffle" onClick={() => { setRes(null); build() }}>{t('Show me another option')}</Button>
      <div style={{ height: 4 }} /><Button variant="ghost" className="dim" onClick={() => setRes(null)}>{t('Change my answers')}</Button>
    </>
  }

  /* ---------- building ---------- */
  if (busy) return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="sparkles" style={{ color: 'var(--violet)' }} />{t('Personal trainer')}</h3>
    <div className="row small dim" style={{ gap: 8, padding: '20px 0' }}><span className="spin" />{t('Designing your week — this takes 15–30 seconds…')}</div>
  </>

  /* ---------- questionnaire ---------- */
  const titles = [t('What’s your main goal?'), t('How experienced are you?'), t('How much time do you have?'), t('What can you train with?'), t('Anything else I should know?')]
  const canNext = step !== 0 || !!a.goal
  return <>
    <div className="row between" style={{ marginBottom: 4 }}>
      <h3 className="row" style={{ gap: 8, margin: 0 }}><Icon name="sparkles" style={{ color: 'var(--violet)' }} />{t('Personal trainer')}</h3>
      <span className="small dim">{step + 1} / {STEPS}</span>
    </div>
    <div className="wprog" style={{ margin: '8px 0 14px' }}><i style={{ width: ((step + 1) / STEPS) * 100 + '%', background: 'var(--violet)' }} /></div>
    <h4 className="sec" style={{ marginTop: 0 }}>{titles[step]}</h4>

    {step === 0 && <Choice options={GOALS} value={a.goal} onChange={v => set({ goal: v })} label={GOAL_LABEL} icon={GOAL_ICON} />}
    {step === 1 && <Choice options={LEVELS} value={a.level} onChange={v => set({ level: v })} label={LEVEL_LABEL} desc={LEVEL_DESC} />}
    {step === 2 && <>
      <div className="row cfgrow" style={{ marginBottom: 12 }}>
        <Stepper label={t('Days per week')} value={a.days} step={1} decimal={false} onChange={v => set({ days: Math.min(6, Math.max(2, Math.round(v))) })} />
      </div>
      <div className="small muted" style={{ marginBottom: 6 }}>{t('Minutes per session')}</div>
      <div className="chips" style={{ marginBottom: 12 }}>
        {SESSION_LENGTHS.map(m => <button key={m} className={'chip nocap' + (a.minutes === m ? ' on' : '')} onClick={() => set({ minutes: m })}>{m} min</button>)}
      </div>
      <div className="small dim">{t('Be honest — a plan you actually finish beats a perfect one you skip.')}</div>
    </>}
    {step === 3 && <Choice options={EQUIP} value={a.equipment} onChange={v => set({ equipment: v })} label={EQUIP_LABEL} icon={EQUIP_ICON} />}
    {step === 4 && <>
      <div className="small muted" style={{ marginBottom: 6 }}>{t('Areas you want extra work on (optional)')}</div>
      <div className="chips" style={{ marginBottom: 14 }}>
        {FOCUS.map(f => <button key={f} className={'chip' + ((a.focus || []).includes(f) ? ' on' : '')} onClick={() => set({ focus: (a.focus || []).includes(f) ? a.focus.filter(x => x !== f) : [...(a.focus || []), f] })}>{t(f)}</button>)}
      </div>
      <div className="row cfgrow" style={{ marginBottom: 12 }}>
        <Stepper label={t('Body weight') + ' (' + S.unit + ')'} value={a.weight || 0} step={1} onChange={v => set({ weight: v || null })} />
        <Stepper label={t('Target weight') + ' (' + S.unit + ')'} value={a.targetW || 0} step={1} onChange={v => set({ targetW: v || null })} />
        <Stepper label={t('Age')} value={a.age || 0} step={1} decimal={false} onChange={v => set({ age: v || null })} />
      </div>
      <div className="small muted" style={{ marginBottom: 6 }}>{t('Injuries, pain or anything to avoid (optional)')}</div>
      <TextArea value={a.limits} onChange={e => set({ limits: e.target.value })} placeholder={t('e.g. sore lower back, no overhead pressing, knee surgery last year')} style={{ marginBottom: 12 }} />
    </>}

    {err && <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}
    <div className="row" style={{ gap: 8 }}>
      {step > 0 && <Button icon="chevronLeft" onClick={() => setStep(s => s - 1)} style={{ flex: 1 }}>{t('Back')}</Button>}
      {step < STEPS - 1
        ? <Button variant="primary" trailingIcon="chevronRight" disabled={!canNext} onClick={() => setStep(s => s + 1)} style={{ flex: 2 }}>{t('Next')}</Button>
        : <Button variant="primary" icon="sparkles" onClick={build} style={{ flex: 2 }}>{t('Build my plan')}</Button>}
    </div>
  </>
}
export const trainerSheet = () => ui().openSheet(close => <Trainer close={close} />)
