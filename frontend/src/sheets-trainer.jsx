// Personal trainer: a five-step questionnaire, then a plan preview you can apply as-is, add to what
// you have, or regenerate. Plan maths + validation live in lib/trainer.js.
import { useState, useRef } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { fmtNum, DAYN, uid } from './lib/format.js'
import { t, getLang } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { exOr, registerCustom } from './lib/exercises.js'
import { lastBW, exLine } from './lib/history.js'
import { aiTrainerPlan, aiImportRoutine, aiErrorMessage } from './lib/api.js'
import { readUpload, UPLOAD_ACCEPT } from './lib/upload.js'
import { materializeImport } from './lib/import-routine.js'
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

// `imported` = { res, again }: the result view is reused for a routine read from a photo / PDF
// (see ImportRoutine below) — same preview, same apply buttons, no questionnaire behind it.
function Trainer({ close, imported }) {
  const S = useStore.getState().S
  const prev = (S.trainer && S.trainer.answers) || {}
  const [a, setA] = useState({ ...DEFAULT_ANSWERS, weight: lastBW(S)?.w || null, targetW: S.targetW || null, ...prev })
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(imported ? imported.res : null)      // { plan, routines, week, dropped, custom? }
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
      const m = materializePlan(plan, candidates, a.days)
      if (!m.routines.length) throw new Error(t('The plan came back empty — try again'))
      setRes({ plan, ...m })
    } catch (e) { setErr(aiErrorMessage(e)) }
    setBusy(false)
  }

  const apply = replace => {
    const { plan, routines, week, custom } = res
    update(s => {
      if (replace) { s.routines = []; s.week = {}; s.dayPlan = {} }
      if (custom && custom.length) { s.customEx = [...(s.customEx || []), ...custom]; registerCustom(s.customEx) }
      s.routines.push(...routines)
      for (const d in week) s.week[d] = week[d]
      if (applyNutrition && plan.nutrition) s.macroGoal = { ...macroGoalOf(s), kcal: plan.nutrition.kcal, protein: plan.nutrition.protein, carbs: plan.nutrition.carbs, fat: plan.nutrition.fat }
      if (!imported) s.trainer = { answers: a, at: Date.now(), split: plan.split, summary: plan.summary }
    })
    close()
    toast(t('Plan ready — see your week'))
    nav('/plan')
  }

  /* ---------- result ---------- */
  if (res) {
    const { plan, routines, week, dropped, created = 0 } = res
    const daysOf = id => Object.keys(week).filter(d => week[d] === id).map(d => t(DAYN[+d]).slice(0, 3))
    const n = plan.nutrition
    const daysPerWeek = Object.keys(week).length
    const minutes = routines.length ? Math.round(routines.reduce((acc, r) => acc + routineMinutes(r), 0) / routines.length / 5) * 5 : 0
    const summary = String(plan.summary || '')
    const shortSummary = summary.length > 220 && !moreSummary ? summary.slice(0, 200).replace(/\s+\S*$/, '') + '…' : summary
    return <>
      <h3 className="row" style={{ gap: 8 }}><Icon name={imported ? 'upload' : 'sparkles'} style={{ color: 'var(--acc)' }} />{plan.split || plan.title || t('Your plan')}</h3>
      {imported && <div className="small muted" style={{ marginTop: -4, marginBottom: 6 }}>{t('Read from {0}', imported.fileName)}{plan.confidence === 'low' ? ' · ' + t('Check it before saving — the file was hard to read.') : ''}</div>}
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

      <div className="row between" style={{ margin: '16px 0 8px' }}><div className="eyebrow" style={{ margin: 0 }}>{t('Your routines')}</div><span className="small dim">{t('Tap the days to change them')}</span></div>
      {routines.map(r => {
        const open = openRoutine === r.id
        const shown = open ? r.ex : r.ex.slice(0, 3)
        return <div key={r.id} className="card" style={{ padding: 14 }}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <span className="avatar-l" style={{ fontSize: 22 }}><Icon name={glyphOf(r.emoji)} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-.012em' }}>{r.name}</div>
              <div className="muted small">{[t(r.ex.length === 1 ? '{0} exercise' : '{0} exercises', r.ex.length), '~' + routineMinutes(r) + ' min', routineMuscles(r)].filter(Boolean).join(' · ')}</div>
              <div className="row" style={{ gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5, 6, 0].map(d => { const mine = week[d] === r.id, other = week[d] && !mine
                  return <button key={d} className={'chip nocap' + (mine ? ' on' : '')} style={{ padding: '4px 10px', fontSize: 12, opacity: other ? .45 : 1 }}
                    title={other ? t('Another routine is on this day') : ''}
                    onClick={() => setRes(x => { const w = { ...x.week }; if (mine) delete w[d]; else w[d] = r.id; return { ...x, week: w } })}>{t(DAYN[d]).slice(0, 3)}</button> })}
              </div>
            </div>
          </div>
          <div className="tr-ex">
            {shown.map((e, i) => { const x = exOr(e.id); return <div key={i} className="tr-ex-row">
              <Thumb ex={x} />
              <div className="tr-ex-n capitalize">{x.n}<span className="dim small" style={{ display: 'block', fontWeight: 400, textTransform: 'none' }}>{t(x.eq || '')}</span></div>
              <div className="tr-ex-s"><b>{setsLabel(e)}</b>{e.rest > 0 && <span>{t('rest {0}', Math.floor(e.rest / 60) + ':' + String(e.rest % 60).padStart(2, '0'))}</span>}</div>
            </div> })}
          </div>
          {r.ex.length > 3 && <button className="linkbtn small" style={{ marginTop: 8 }} onClick={() => setOpenRoutine(open ? null : r.id)}>{open ? t('Show fewer') : t('See all {0} exercises', r.ex.length)}</button>}
        </div>
      })}
      {plan.cardio && <div className="row small muted" style={{ gap: 6, alignItems: 'flex-start', margin: '4px 0 12px' }}><Icon name="figureRun" style={{ fontSize: 14, flex: 'none', marginTop: 2 }} /><span>{plan.cardio}</span></div>}
      {created > 0 && <div className="row small muted" style={{ gap: 6, alignItems: 'flex-start', margin: '4px 0 12px' }}><Icon name="info" style={{ fontSize: 14, flex: 'none', marginTop: 2 }} /><span>{t(created === 1 ? '{0} exercise wasn’t in our library, so it was added as your own — you can edit it later.' : '{0} exercises weren’t in our library, so they were added as your own — you can edit them later.', created)}</span></div>}
      {imported && Array.isArray(plan.notes) && plan.notes.length > 0 && <div className="small muted" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>{plan.notes.slice(0, 6).map((x, i) => <div key={i}>• {x}</div>)}</div>}
      {dropped > 0 && <div className="small" style={{ color: 'var(--orange)', marginBottom: 10 }}>{t('{0} suggestion(s) didn’t match your equipment and were left out — tap “Show me another option” if a routine looks thin.', dropped)}</div>}
      {n && <div className="sect-b" style={{ margin: '6px 0 14px' }}>
        <button className="lrow tap" onClick={() => setApplyNutrition(v => !v)}>
          <Check checked={applyNutrition} onChange={() => {}} />
          <span className="lrow-m"><span className="lrow-t">{t('Also set my food targets')}</span>
            <span className="lrow-s">{fmtNum(n.kcal)} kcal · {t('Protein')} {n.protein} g · {t('Carbs')} {n.carbs} g · {t('Fat')} {n.fat} g</span></span>
        </button>
      </div>}
      <Button variant="primary" icon="check" onClick={() => apply(true)}>{S.routines.length ? t('Use this plan instead of mine') : t('Use this plan')}</Button>
      {S.routines.length > 0 && <><div style={{ height: 8 }} /><Button icon="plus" onClick={() => apply(false)}>{t('Add alongside my routines')}</Button></>}
      {imported
        ? <><div style={{ height: 8 }} /><Button variant="ghost" icon="upload" onClick={imported.again}>{t('Pick another file')}</Button></>
        : <><div style={{ height: 8 }} /><Button variant="ghost" icon="shuffle" onClick={() => { setRes(null); build() }}>{t('Show me another option')}</Button>
          <div style={{ height: 4 }} /><Button variant="ghost" className="dim" onClick={() => setRes(null)}>{t('Change my answers')}</Button></>}
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

/* ---------- import a routine you already have (photo or PDF) ---------- */
// Pick -> read -> the trainer's result view. The file is read on the device (resized, HEIC
// converted), checked by signature on the server and never stored anywhere.
function ImportRoutine({ close }) {
  const [phase, setPhase] = useState('pick')   // pick | busy | result
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const [fileName, setFileName] = useState('')
  const camInput = useRef(null), photoInput = useRef(null), fileInput = useRef(null)
  const onFile = async f => {
    if (!f) return
    setErr(''); setPhase('busy'); setFileName(f.name)
    try {
      const up = await readUpload(f, { maxDim: 1568 })
      const parsed = await aiImportRoutine(up.kind === 'pdf' ? { pdf: up.base64, lang: getLang() } : { image: up.base64, mediaType: up.mediaType, lang: getLang() })
      if (!parsed.found || !(parsed.routines || []).length) throw new Error(t('Couldn’t find a routine in that file.') + (parsed.summary ? ' ' + parsed.summary : ''))
      const m = materializeImport(parsed, useStore.getState().S)
      if (!m.routines.length) throw new Error(t('Couldn’t find a routine in that file.'))
      setRes({ plan: parsed, ...m }); setPhase('result')
    } catch (e) { setErr(aiErrorMessage(e)); setPhase('pick') }
  }
  const pick = ref => e => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f) }
  if (phase === 'result') return <Trainer close={close} imported={{ res, fileName, again: () => { setRes(null); setPhase('pick') } }} />
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="upload" style={{ color: 'var(--acc)' }} />{t('Bring your own routine')}</h3>
    <input ref={camInput} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={pick(camInput)} />
    <input ref={photoInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={pick(photoInput)} />
    <input ref={fileInput} type="file" accept={UPLOAD_ACCEPT} style={{ display: 'none' }} onChange={pick(fileInput)} />
    {phase === 'busy' ? <div className="row small dim" style={{ gap: 8, padding: '20px 0' }}><span className="spin" />{t('Reading your routine — 15 to 30 seconds…')}</div> : <>
      <div className="small muted" style={{ lineHeight: 1.5, marginBottom: 14 }}>{t('Got a routine from your coach or gym? Take a photo of the sheet or upload the PDF. We read the days, exercises, sets and reps and set it up for you — you check it before anything is saved.')}</div>
      <div className="sect-b" style={{ marginBottom: 12 }}>
        <button className="lrow tap" onClick={() => camInput.current?.click()}>
          <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="camera" /></span>
          <span className="lrow-m"><span className="lrow-t">{t('Take a photo')}</span><span className="lrow-s">{t('Of the printed or handwritten sheet')}</span></span>
          <Icon name="chevronRight" className="lrow-k" />
        </button>
        <button className="lrow tap" onClick={() => photoInput.current?.click()}>
          <span className="lrow-i" style={{ '--tint': 'var(--violet)' }}><Icon name="star" /></span>
          <span className="lrow-m"><span className="lrow-t">{t('Pick from your photos')}</span><span className="lrow-s">{t('A photo or screenshot you already have')}</span></span>
          <Icon name="chevronRight" className="lrow-k" />
        </button>
        <button className="lrow tap" onClick={() => fileInput.current?.click()}>
          <span className="lrow-i" style={{ '--tint': 'var(--blue)' }}><Icon name="folder" /></span>
          <span className="lrow-m"><span className="lrow-t">{t('Choose a PDF or file')}</span><span className="lrow-s">{t('PDF, JPG, PNG or HEIC · PDFs up to 12 MB')}</span></span>
          <Icon name="chevronRight" className="lrow-k" />
        </button>
      </div>
      <div className="small dim" style={{ lineHeight: 1.5 }}>{t('Your file is read once and never stored.')}</div>
    </>}
    {err && <div className="small" style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
  </>
}
export const importRoutineSheet = () => ui().openSheet(close => <ImportRoutine close={close} />)
