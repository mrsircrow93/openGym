import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { EXDB, EXIDX, BODYPARTS, isCardio, isBodyweightEq, allExercises, equipmentOf, exOr } from './lib/exercises.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, uid, exCount, fmtWater, DAYN, MONTHS_LONG, ACCENTS } from './lib/format.js'
import { lastEntryFor, bestWeightFor, buildSets, effectiveRoutineId, workoutVolume, setsDone, setsDoneActive, lastBW, supersetUnits, unitOf, setLabel, defaultConfig, cleanupSg, modeOf, effortOf, isBw, isPerSide, sideReps } from './lib/history.js'
import { beep, vibrate } from './lib/sound.js'
import { t, instrFor, getLang, INSTR_LANGS } from './lib/i18n.js'
import { nav } from './lib/nav.js'
import { starterRoutines } from './lib/starter.js'
import Media, { Thumb } from './components/Media.jsx'
import Stepper from './components/Stepper.jsx'
import Icon from './components/Icon.jsx'
import { Button, Slider, Switch, Segmented, SelectRow, Row, TextField } from './components/ui.jsx'
import { glyphOf, GLYPH_GROUPS, DEFAULT_GLYPH } from './lib/glyphs.js'
import BodyMap from './components/BodyMap.jsx'
import { loadOfWorkouts } from './lib/muscles.js'
import { parseImport, mergeImport } from './lib/import-csv.js'
import { buildPlanBundle, parsePlan, mergePlan, printPlan } from './lib/plan-share.js'
import { estimate1RM, best1RM, is1RMRecord, REP_CAP } from './lib/onerm.js'
import { nextPrescription, applyPrescription, policyFor, defaultIncrement, POLICIES_FOR, POLICY_NAME, POLICY_DESC, MAX_BW_SETS } from './lib/progression.js'
import { MOBILE, shareExport } from './lib/mobile.js'
import { aiParseSet, aiCoach, aiIdentifyExercise, aiAlternatives, fileToResizedBase64, aiErrorMessage } from './lib/api.js'
import { hrSupported, hrConnect, hrDisconnect } from './lib/heartrate.js'
import { COACHES, coachOf } from './lib/coach.js'
import CoachAvatar from './components/CoachAvatar.jsx'

const S = () => useStore.getState().S
const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const snd = () => S().sound

/* ============================ custom confirm dialog ============================ */
function ConfirmDialog({ title, message, confirmText, cancelText, danger, onConfirm, close }) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    {title && <h3 style={{ marginBottom: 8 }}>{title}</h3>}
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
    <button className={'btn ' + (danger ? 'danger' : 'primary')} onClick={() => { close(); onConfirm && onConfirm() }}>{confirmText || t('Confirm')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{cancelText || t('Cancel')}</Button>
  </div>
}
// Themed replacement for window.confirm — callback-based (no blocking).
export function confirmSheet(opts) {
  ui().openSheet(close => <ConfirmDialog {...opts} close={close} />, { kind: 'center' })
}

/* ============================ starter plan ============================ */
export function loadStarterPlan() {
  const [push, pull, legs] = starterRoutines()
  update(st => {
    st.routines.push(push, pull, legs)
    st.week[1] = push.id; st.week[3] = pull.id; st.week[5] = legs.id
  })
  toast(t('Starter plan loaded — Mon Push · Wed Pull · Fri Legs'))
}

// Removes a routine and every schedule slot that pointed at it. Shared by the routine editor
// and the swipe-to-delete on the Plan list.
export function deleteRoutine(id, afterDelete) {
  const r = S().routines.find(x => x.id === id)
  if (!r) return
  confirmSheet({
    title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        s.routines = s.routines.filter(x => x.id !== id)
        Object.keys(s.week).forEach(k => { if (s.week[k] === id) delete s.week[k] })
        Object.keys(s.dayPlan).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
      })
      toast(t('Routine deleted'))
      if (afterDelete) afterDelete()
    }
  })
}

/* ============================ weight picker (shared: body weight + goal) ============================ */
// Fixed range, not a moving window — a window that resizes itself mid-drag (the previous
// attempt) makes the thumb's position unpredictable: every time it grows, everything already
// placed on it shifts toward one side. A static range never has that problem, at the cost of
// coarser precision per pixel — the +/- buttons cover exact values.
// The ceiling follows the profile's unit: 300 covers a body weight or a working weight in
// kg, but as pounds it cut off at 136 kg — below plenty of people's body weight, and well
// below an everyday squat.
const W_LO = 1
const wHi = unit => (unit === 'lb' ? 660 : 300)
function WeightInput({ value, setValue, unit }) {
  const W_HI = wHi(unit)
  const clamp = x => Math.max(W_LO, Math.min(W_HI, Math.round((x || 0) * 10) / 10))
  const sv = Math.max(W_LO, Math.min(W_HI, value))
  const onSlide = v => setValue(clamp(v))
  return <>
    <div className="bwstep">
      <button className="bw-pm" onClick={() => onSlide(value - 0.1)} aria-label="minus 0.1"><Icon name="minus" /></button>
      <div className="bw-read">{fmtNum(value)}<span className="u"> {unit}</span></div>
      <button className="bw-pm" onClick={() => onSlide(value + 0.1)} aria-label="plus 0.1"><Icon name="plus" /></button>
    </div>
    <div className="chips" style={{ justifyContent: 'center', margin: '8px 0' }}>
      <button className="chip" onClick={() => onSlide(value - 1)}>−1</button>
      <button className="chip" onClick={() => onSlide(value - 0.5)}>−0.5</button>
      <button className="chip" onClick={() => onSlide(value + 0.5)}>+0.5</button>
      <button className="chip" onClick={() => onSlide(value + 1)}>+1</button>
    </div>
    <Slider value={sv} min={W_LO} max={W_HI} step={0.5} onChange={onSlide} />
  </>
}

/* ============================ body weight ============================ */
function BwSheet({ required, onDone, close }) {
  const st = useStore(s => s.S)
  const unit = st.unit
  const bw = lastBW(st)
  const [v, setV] = useState(bw ? bw.w : 70)
  const save = () => {
    const n = Math.round((v || 0) * 10) / 10
    if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      const iso = todayISO()
      const ex = s.bodyweight.find(b => b.d === iso)
      if (ex) { ex.w = n; ex.t = Date.now() } else s.bodyweight.push({ d: iso, w: n, t: Date.now() })
      s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    })
    close()
    if (onDone) onDone(n); else toast(t('Weight saved'))
  }
  const recent = [...st.bodyweight].reverse().slice(0, 3)
  const delEntry = d => update(s => { s.bodyweight = s.bodyweight.filter(b => b.d !== d) })
  return <>
    <h3>{required ? t('Quick check-in') : t('Log body weight')}</h3>
    <div className="muted small">{required ? t('Slide or tap to set your weight — tracked before every workout so your curve stays honest.') : t('Today') + ', ' + fmtDate(todayISO(), true)}</div>
    <WeightInput value={v} setValue={setV} unit={unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{required ? t('Save & start workout') : t('Save')}</Button>
    {required && <>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => { close(); onDone && onDone(null) }}>{t('Start without weighing in')}</Button>
      <div style={{ height: 2 }} /><Button variant="ghost" className="dim" icon="reset" onClick={() => { close(); nav('/workout') }}>{t('Choose a different workout')}</Button>
    </>}
    {!required && recent.length > 0 && <>
      <h4 className="sec">{t('Recent weigh-ins')}</h4>
      <div className="list" style={{ gap: 0 }}>
        {recent.map(b => <div key={b.d} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small muted">{fmtDate(b.d, true)}</span>
          <span className="row" style={{ gap: 12 }}><b>{fmtNum(b.w)} {unit}</b>
            <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => delEntry(b.d)} aria-label="delete"><Icon name="trash" /></button></span>
        </div>)}
      </div>
    </>}
  </>
}
export function bwSheet(opts = {}) {
  const h = ui().openSheet(close => <BwSheet {...opts} close={close} />, { locked: !!opts.required })
  return h
}

/* ============================ import from another app ============================ */
// Shows what a parsed export would actually do before anything is written. An import is
// the one action where "just try it" is expensive — it's someone's entire training
// history — so the numbers, the unit conversion and the exercises we couldn't recognise
// are all on screen before the confirm button.
function ImportSummary({ parsed, close }) {
  const st = useStore(s => s.S)
  const isBW = parsed.kind === 'bodyweight'
  const have = isBW
    ? parsed.bodyweight.filter(b => st.bodyweight.some(x => x.d === b.d)).length
    : parsed.workouts.filter(w => st.workouts.some(x => x.d === w.d)).length
  const fresh = (isBW ? parsed.bodyweight.length : parsed.workouts.length) - have

  const doImport = () => {
    let res
    update(s => { res = mergeImport(s, parsed) })
    close()
    toast(isBW
      ? t('{0} weigh-ins imported', res.added)
      : t('{0} workouts imported', res.added))
  }

  return <>
    <h3>{parsed.source ? t('Import from {0}', parsed.source) : t('Import history')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {parsed.from === parsed.to ? fmtDate(parsed.from, true) : fmtDate(parsed.from, true) + ' – ' + fmtDate(parsed.to, true)}
    </div>

    <div className="tiles" style={{ textAlign: 'left' }}>
      {isBW ? <>
        <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.bodyweight.length}</div></div>
        <div className="tile"><div className="l">{t('New')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fresh}</div></div>
      </> : <>
        <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.workouts.length}</div></div>
        <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.sets}</div></div>
        <div className="tile"><div className="l">{t('Exercises matched')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.matched}</div></div>
        <div className="tile"><div className="l">{t('Added as your own')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{parsed.created}</div></div>
      </>}
    </div>

    {parsed.mixedUnits ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file mixes kg and lb — each set is converted to {0}.', st.unit)}
    </div> : parsed.converted ? <div className="small" style={{ color: 'var(--yellow)', marginBottom: 10 }}>
      {t('The file is in {0} and your profile is in {1} — weights will be converted.', parsed.fileUnit, st.unit)}
    </div> : null}
    {!isBW && !parsed.fileUnit && !parsed.mixedUnits && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('The file does not say which unit it uses — numbers are imported as they are.')}
    </div>}
    {have > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t('{0} days already have data here and will be left alone.', have)}
    </div>}
    {/* The file rated its sets. Say so: the column is off by default, so the ratings would
        otherwise arrive invisibly and look like they had been dropped. */}
    {!isBW && (parsed.rirSets + parsed.rpeSets) > 0 && <div className="small dim" style={{ marginBottom: 10 }}>
      {t(effortOf(st) === 'none'
        ? '{0} sets bring an {1} with them — switch on Effort per set in Settings to see it.'
        : '{0} sets bring an {1} with them.',
      parsed.rirSets || parsed.rpeSets, parsed.rirSets ? 'RIR' : 'RPE')}
    </div>}
    {!isBW && parsed.unmatchedNames.length > 0 && <>
      <h4 className="sec">{t('Not in the library — added as your own exercises')}</h4>
      <div className="mchips" style={{ marginBottom: 12 }}>
        {parsed.unmatchedNames.slice(0, 12).map(n => <span key={n} className="mchip capitalize">{n}</span>)}
        {parsed.unmatchedNames.length > 12 && <span className="mchip">+{parsed.unmatchedNames.length - 12}</span>}
      </div>
    </>}

    <Button variant="primary" onClick={doImport} disabled={!fresh}>
      {fresh ? t('Import') : t('Nothing new to import')}
    </Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** Read a CSV/XML export, then show what it would do. */
export function importFromApp(file, onDone) {
  const rd = new FileReader()
  rd.onload = () => {
    let parsed
    try { parsed = parseImport(String(rd.result), { unit: S().unit }) }
    catch (e) { toast(t('Could not read that file')); return }
    if (parsed.error === 'empty') { toast(t('That file is empty')); return }
    if (parsed.error) { toast(t("That file's columns aren't recognised — see the docs for supported apps.")); return }
    if (parsed.kind === 'bodyweight' ? !parsed.bodyweight.length : !parsed.workouts.length) {
      toast(t('Nothing to import from that file')); return
    }
    ui().openSheet(close => <ImportSummary parsed={parsed} close={close} />)
    onDone && onDone()
  }
  rd.onerror = () => toast(t('Could not read that file'))
  rd.readAsText(file)
}

/* ============================ target weight ============================ */
export function bwDeltaColor(delta, currentW) {
  if (!delta) return 'var(--label-2)'
  if (!S().targetW) return 'var(--label)'
  const up = S().targetW > currentW
  return (delta > 0) === up ? 'var(--acc)' : 'var(--red)'
}
function GoalSheet({ close }) {
  const st = S()
  const bw = lastBW(st)
  const [v, setV] = useState(st.targetW || (bw ? bw.w : 70))
  return <>
    <h3>{t('Target weight')}</h3>
    <div className="muted small">{t('Your goal is drawn as a line through the weight charts, and gains/losses are colored by whether they move toward it.')}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => {
      const n = Math.round((v || 0) * 10) / 10
      if (!n || n <= 0) { toast(t('Enter a valid weight')); return }
      update(s => { s.targetW = n }); close()
      const b = lastBW(S()); toast(t('Goal set: {0}', fmtNum(n) + ' ' + st.unit) + (b ? ' (' + t('{0} to go', fmtNum(Math.abs(n - b.w))) + ')' : ''))
    }}>{t('Save goal')}</Button>
    {st.targetW && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { update(s => { s.targetW = null }); close(); toast(t('Goal removed')) }}>{t('Remove goal')}</Button></>}
  </>
}
export const goalSheet = () => ui().openSheet(close => <GoalSheet close={close} />)

/* ============================ exercise detail ============================ */
// Estimated 1RM for one exercise (issue #18): what the log already implies, plus a calculator
// for a set you have not done — so the number is reachable before there is any history.
function OneRM({ ex }) {
  const st = useStore(s => s.S)
  const best = best1RM(st, ex.id)
  const [w, setW] = useState(best ? best.w : (st.exWeights[ex.id] || {}).w || 20)
  const [r, setR] = useState(best ? best.r : 5)
  const est = estimate1RM(w, r)
  return <>
    <h4 className="sec">{t('Estimated 1RM')}</h4>
    {best && <div className="small" style={{ marginBottom: 8 }}>
      {t('From your log:')} <b className="accent">{fmtNum(best.est)} {st.unit}</b>
      <span className="dim"> · {t('{0} × {1} on {2}', fmtNum(best.w) + ' ' + st.unit, best.r, fmtDate(best.d, true))}</span>
    </div>}
    <div className="row cfgrow" style={{ marginBottom: 10 }}>
      <Stepper label={t('Weight ({0})', st.unit)} value={w} step={2.5} onChange={setW} />
      <Stepper label={t('Reps')} value={r} step={1} decimal={false} onChange={setR} />
    </div>
    <div className="row between" style={{ marginBottom: 4 }}>
      <span className="muted small">{t('Estimate')}</span>
      <b className="accent" style={{ fontSize: 20 }}>{est === null ? '—' : fmtNum(est) + ' ' + st.unit}</b>
    </div>
    <div className="small dim">{est === null
      ? t('Enter a weight and 1–{0} reps — beyond that an estimate is guesswork.', REP_CAP)
      : t('Epley formula — a calculation from one set, not a tested max.')}</div>
  </>
}

function ExerciseDetail({ ex, close }) {
  const st = useStore(s => s.S)
  const last = lastEntryFor(st, ex.id)
  const best = bestWeightFor(st, ex.id)
  return <>
    <h3 className="capitalize">{ex.n}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
      <span className="tag acc">{t(ex.bp)}</span>
      {ex.tg && <span className="tag"><Icon name="target" />{t(ex.tg)}</span>}
      <span className="tag"><Icon name="dumbbell" />{t(ex.eq)}</span>
      {(ex.sm || []).slice(0, 3).map((s, i) => <span key={i} className="tag">{t(s)}</span>)}
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {best > 0 && <div className="small row" style={{ marginBottom: 6, gap: 5 }}><Icon name="trophy" style={{ fontSize: 14, color: 'var(--yellow)' }} />{t('Best:')} <b className="accent">{fmtNum(best)} {st.unit}</b>{last ? ` · ${t('last')} ${fmtDate(last.d)}: ${last.sets.map(s => setLabel(ex.id, s, last.target)).join(', ')}` : ''}</div>}
    <Button variant="primary" icon="plus" style={{ margin: '10px 0 4px' }} onClick={() => addToRoutineSheet(ex)}>{t('Add to my plan')}</Button>
    {ex.custom && <div className="row" style={{ gap: 8, marginTop: 8 }}>
      <Button icon="pencil" style={{ flex: 1 }} onClick={() => { close(); customExSheet(ex) }}>{t('Edit')}</Button>
      <Button variant="danger" icon="trash" style={{ flex: 1 }} onClick={() => deleteCustomEx(ex, close)}>{t('Delete')}</Button>
    </div>}
    {!isCardio(ex) && <OneRM ex={ex} />}
    {instrFor(ex).length > 0 &&<><h4 className="sec">{t('How to')}{!INSTR_LANGS.includes(getLang()) && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4><ol className="steps-list">{instrFor(ex).map((s, i) => <li key={i}>{s}</li>)}</ol></>}
  </>
}
export const exerciseDetailSheet = ex => ui().openSheet(close => <ExerciseDetail ex={ex} close={close} />)

/* ============================ add to routine ============================ */
function AddToRoutine({ ex, close }) {
  const st = useStore(s => s.S)
  const pick = rid => {
    close()
    const isNew = rid === '_new'
    exConfigSheet(ex, null, cfg => {
      update(s => {
        let r = isNew ? { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] } : s.routines.find(x => x.id === rid)
        if (isNew) s.routines.push(r)
        if (r) r.ex.push({ id: ex.id, ...cfg })
      })
      const r = isNew ? S().routines[S().routines.length - 1] : st.routines.find(x => x.id === rid)
      toast(t('“{0}” added to {1}', ex.n, r ? r.name : t('routine')))
      if (isNew && r) nav('/plan/r/' + r.id)
    }, null, isNew ? null : st.routines.find(x => x.id === rid))
  }
  return <>
    <h3 className="capitalize">{t('Add “{0}”', ex.n)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a routine — sets, reps & weight come next.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => pick(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {r.ex.some(e => e.id === ex.id) && <span className="tag">{t('already in')}</span>}<Icon name="plus" className="chev" />
      </div>)}
      <div className="item" onClick={() => pick('_new')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{t('New routine')}</div><div className="ss">{t('Create one and start with this exercise')}</div></div><Icon name="plus" className="chev" /></div>
    </div>
  </>
}
export const addToRoutineSheet = ex => ui().openSheet(close => <AddToRoutine ex={ex} close={close} />)

/* ============================ custom exercises (issue #11) ============================ */
// Name + body part is all it takes — the exercise then behaves like any built-in one
// (planning, logging, PRs, stats), just without an animation.
function CustomExForm({ existing, prefill, onDone, close }) {
  const prefillName = typeof prefill === 'string' ? prefill : (prefill && prefill.name) || ''
  const prefillBp = (prefill && typeof prefill === 'object' && prefill.bp) || ''
  const [n, setN] = useState(existing ? existing.n : prefillName)
  const [bp, setBp] = useState(existing ? existing.bp : prefillBp)
  const [desc, setDesc] = useState(existing ? (existing.desc || '') : '')
  const save = () => {
    const name = n.trim()
    if (!name) { toast(t('Give it a name')); return }
    if (!bp) { toast(t('Pick a body part')); return }
    const dup = allExercises(S()).find(e => e.n.toLowerCase() === name.toLowerCase() && e.id !== (existing || {}).id)
    if (dup) { toast(t('“{0}” already exists', dup.n)); return }
    const d = desc.trim().slice(0, 1000)
    let id = existing && existing.id
    if (existing) update(s => { const c = (s.customEx || []).find(x => x.id === id); if (c) { c.n = name; c.bp = bp; c.desc = d } })
    else {
      id = 'c' + uid()
      update(s => { (s.customEx = s.customEx || []).push({ id, n: name, bp, desc: d, tg: '', eq: 'custom', custom: true }) })
    }
    close()
    toast(existing ? t('Saved') : t('“{0}” created', name))
    onDone && onDone(EXIDX[id])
  }
  return <>
    <h3>{existing ? t('Edit custom exercise') : t('Create your own exercise')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Name it and pick a body part — it behaves like any other exercise, just without an animation.')}</div>
    <input className="input" placeholder={t('Exercise name')} value={n} onChange={e => setN(e.target.value)} />
    <div className="chips" style={{ margin: '12px 0' }}>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => setBp(b)}>{t(b)}</button>)}
    </div>
    {bp === 'cardio' && <div className="small dim row" style={{ marginBottom: 10, gap: 5 }}><Icon name="figureRun" style={{ fontSize: 13 }} />{t('Cardio exercises log time + speed instead of weight × reps.')}</div>}
    <textarea className="input" rows={4} maxLength={1000} placeholder={t('Description (optional) — setup, cues, anything you want to remember')}
      value={desc} onChange={e => setDesc(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Create exercise')}</Button>
    {existing && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { close(); deleteCustomEx(existing) }}>{t('Delete exercise')}</Button></>}
  </>
}
export const customExSheet = (existing, onDone, prefill) => ui().openSheet(close => <CustomExForm existing={existing} prefill={prefill} onDone={onDone} close={close} />)

export function deleteCustomEx(ex, afterDelete) {
  if (S().active?.entries.some(e => e.id === ex.id)) { toast(t('Finish your current workout first')); return }
  confirmSheet({
    title: t('Delete “{0}”?', ex.n),
    message: t('It will be removed from your routines. Already-logged workouts keep their sets.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => {
      update(s => {
        s.customEx = (s.customEx || []).filter(x => x.id !== ex.id)
        s.routines.forEach(r => { r.ex = r.ex.filter(e => e.id !== ex.id); cleanupSg(r.ex) })
        // stamp the name into history entries so past workouts stay readable
        s.workouts.forEach(w => w.entries.forEach(e => { if (e.id === ex.id) e.n = ex.n }))
        delete s.exWeights[ex.id]
      })
      toast(t('Exercise deleted'))
      afterDelete && afterDelete()
    }
  })
}

/* ============================ exercise picker ============================ */
// Exercises already used in your routines or past workouts (for the "Chosen" filter + a marker).
function usageMap(st) {
  const u = {}
  st.routines.forEach(r => r.ex.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  st.workouts.forEach(w => w.entries.forEach(e => { u[e.id] = (u[e.id] || 0) + 1 }))
  return u
}
function ExercisePicker({ onPick, close }) {
  const st = useStore(s => s.S)
  const usage = usageMap(st)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')          // '' = all, '★' = chosen, else a body part
  const [eq, setEq] = useState('')          // '' = any equipment
  const [shown, setShown] = useState(50)
  const ql = q.toLowerCase().trim()
  const all = allExercises(st)
  let base = all.filter(e =>
    (bp === '★' ? usage[e.id] : (!bp || e.bp === bp)) &&
    (!ql || e.n.toLowerCase().includes(ql) || e.tg.includes(ql) || e.eq.includes(ql) || (e.desc || '').toLowerCase().includes(ql)))
  if (bp === '★') base = [...base].sort((a, b) => (usage[b.id] - usage[a.id]) || (a.n < b.n ? -1 : 1))
  const eqOpts = equipmentOf(base)
  // Drop the equipment filter if the search narrowed it away, so you never hit a dead end.
  const eqOn = eqOpts.includes(eq) ? eq : ''
  const f = eqOn ? base.filter(e => e.eq === eqOn) : base
  const chosenCount = Object.keys(usage).length
  return <>
    <h3>{t('Add exercise')}</h3>
    <div className="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} exercises…', all.length)} value={q} onChange={e => { setQ(e.target.value); setShown(50) }} /></div>
    <div className="chips" style={{ margin: eqOpts.length > 1 ? '10px 0 6px' : '10px 0' }}>
      {chosenCount > 0 && <button className={'chip' + (bp === '★' ? ' on' : '')} onClick={() => { setBp('★'); setEq(''); setShown(50) }}><Icon name="starFill" style={{ fontSize: 12, display: 'inline-block', marginRight: 4, verticalAlign: '-1px' }} />{t('Chosen')} ({chosenCount})</button>}
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(50) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setEq(''); setShown(50) }}>{t(b)}</button>)}
    </div>
    {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 10 }}>
      <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(50) }}>{t('Any equipment')}</button>
      {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(50) }}>{t(x)}</button>)}
    </div>}
    <div className="list">
      {bp !== '★' && <div className="item" onClick={() => customExSheet(null, ex => onPick(ex), q.trim())}>
        <div className="thumb thumb-x"><Icon name="sparkles" /></div>
        <div className="grow"><div className="tt">{t('Create your own exercise')}</div><div className="ss">{t('name + body part, no animation')}</div></div><Icon name="plus" className="chev" />
      </div>}
      {f.slice(0, shown).map(e => <div key={e.id} className="item" onClick={() => onPick(e)}>
        <Thumb ex={e} /><div className="grow"><div className="tt capitalize">{e.n}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div>
        {usage[e.id] && <span className="tag acc"><Icon name="starFill" /></span>}<Icon name="plus" className="chev" />
      </div>)}
      {f.length === 0 && bp === '★' && <div className="empty">{t('Nothing chosen yet — add exercises and they’ll show up here.')}</div>}
    </div>
    {f.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 50)}>{t('Show more')}</Button></>}
  </>
}
export const exercisePicker = onPick => ui().openSheet(close => <ExercisePicker onPick={onPick} close={close} />)

/* ============================ exercise config ============================ */
// Progression settings for one exercise (issue #17). Shown inside the config sheet because
// "how does this lift go up" belongs next to sets and reps, not in a separate screen. Left
// on "follow the routine" it inherits, so most people never touch it.
function ProgressionFields({ ex, mode, c, setC, routine, unit }) {
  const options = POLICIES_FOR[mode] || ['off']
  if (options.length < 2) return null
  const inherited = policyFor({ id: ex.id }, routine, mode)
  const active = policyFor({ ...c, id: ex.id }, routine, mode)
  const inc = c.inc > 0 ? c.inc : (mode === 'time' ? 5 : defaultIncrement(ex.id, unit))
  return <>
    <h4 className="sec">{t('Progression')}</h4>
    <div className="sect-b" style={{ marginBottom: 8 }}>
      <SelectRow title={t('Rule')} sheetTitle={t('Progression')} value={c.prog || ''} onChange={v => setC(x => ({ ...x, prog: v || undefined }))}
        options={[{ value: '', label: t('Follow the routine ({0})', t(POLICY_NAME[inherited])) },
          ...options.map(p => ({ value: p, label: t(POLICY_NAME[p]) }))]} />
    </div>
    <div className="small dim" style={{ marginBottom: active === 'off' ? 18 : 10 }}>{t(POLICY_DESC[active])}</div>
    {active !== 'off' && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={mode === 'time' ? t('Step (seconds)') : t('Step ({0})', unit)} value={inc}
        step={mode === 'time' ? 5 : 1.25} decimal={mode !== 'time'} onChange={v => setC(x => ({ ...x, inc: v }))} />
      {active === 'double' && <Stepper label={t('Reps from')} value={c.repsMin || Math.max(1, (c.reps || 10) - 2)}
        step={1} decimal={false} onChange={v => setC(x => ({ ...x, repsMin: v }))} />}
    </div>}
  </>
}

function ExConfig({ ex, existing, onSave, onDelete, close, routine }) {
  const st = useStore(s => s.S)
  const cardio = isCardio(ex.id)
  const [c, setC] = useState(existing || defaultConfig(ex.id))
  // Cardio keeps its own duration+speed form; the reps/time choice (issue #16) is offered for
  // everything else, which is where the gap was — planks, hangs, wall sits, loaded carries.
  const mode = cardio ? 'cardio' : modeOf({ ...c, id: ex.id })
  // Both default from the dataset and are then whatever the config says — see isBw.
  const bw = !cardio && isBw({ ...c, id: ex.id })
  const perSide = isPerSide(c)
  // Keep whatever the other mode already had (sets, weight) and fill only what is missing.
  const setMode = m => setC(x => ({ ...defaultConfig(ex.id, m), ...x, mode: m }))
  const save = () => {
    close()
    const sets = Math.max(1, Math.round(c.sets) || (cardio ? 1 : 3))
    // Only carry progression settings that differ from the inherited default, so a plan file
    // stays readable and "follow the routine" keeps meaning exactly that.
    const prog = {}
    if (c.prog) prog.prog = c.prog
    if (c.inc > 0) prog.inc = c.inc
    // Written only when it differs from what the dataset already says, so a barbell config
    // stays exactly the shape it was before these flags existed.
    // `bodyweight` is true of a hold as much as of a set of reps; `side` is not — it counts
    // reps, and a timed hold has none. Switching an exercise to Time therefore drops it
    // rather than carrying a flag nothing downstream can read.
    const flags = {}
    if (bw !== isBodyweightEq(ex.id)) flags.bodyweight = bw
    // Written only when it's on — most exercises just inherit the app-wide rest timer, and
    // a plan file that carried every exercise's rest even at the default would be noise.
    const rest = {}
    if (!cardio && c.rest > 0) rest.rest = Math.round(c.rest)
    if (cardio) onSave({ sets, min: Math.max(1, Math.round(c.min) || 20), speed: Math.max(0, c.speed || 8) })
    else if (mode === 'time') onSave({ sets, mode: 'time', sec: Math.max(1, Math.round(c.sec) || 45), weight: Math.max(0, c.weight || 0), ...flags, ...prog, ...rest })
    else {
      // A unilateral target is stored even: the split has to divide, and a typed 15 would
      // otherwise plan seven reps on one side and eight on the other, every session.
      const typed = Math.max(1, Math.round(c.reps) || 10)
      const reps = perSide ? Math.ceil(typed / 2) * 2 : typed
      const out = { sets, mode: 'reps', reps, weight: Math.max(0, c.weight || 0), ...flags, ...(perSide ? { side: true } : {}), ...prog, ...rest }
      if (policyFor({ ...c, id: ex.id }, routine, 'reps') === 'double') out.repsMin = Math.min(reps, Math.max(1, Math.round(c.repsMin) || Math.max(1, reps - 2)))
      // A ceiling below the working reps would tell you to add a set on day one.
      if (bw && !(out.weight > 0) && c.repsMax > 0) out.repsMax = Math.max(reps, Math.round(c.repsMax))
      onSave(out)
    }
  }
  return <>
    <h3 className="capitalize">{ex.n}</h3>
    <Media ex={ex} />
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 14px' }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      <span className="tag">{t(ex.tg || ex.bp)}</span><span className="tag">{t(ex.eq)}</span>
    </div>
    {ex.desc && <div className="exnote">{ex.desc}</div>}
    {!cardio && <div style={{ marginBottom: 14 }}>
      <Segmented className="seg-range" value={mode} onChange={setMode}
        options={[{ value: 'reps', label: t('Reps') }, { value: 'time', label: t('Time') }]} />
    </div>}
    <div className="row cfgrow" style={{ marginBottom: mode === 'time' ? 8 : 18 }}>
      {cardio ? <>
        <Stepper label={t('Intervals')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Minutes')} value={c.min} step={1} decimal={false} onChange={v => setC(x => ({ ...x, min: v }))} />
        <Stepper label={t('Speed (km/h)')} value={c.speed} step={0.5} onChange={v => setC(x => ({ ...x, speed: v }))} />
      </> : mode === 'time' ? <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Seconds')} value={c.sec} step={5} decimal={false} onChange={v => setC(x => ({ ...x, sec: v }))} />
        <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />
      </> : <>
        <Stepper label={t('Sets')} value={c.sets} step={1} decimal={false} onChange={v => setC(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Reps')} value={c.reps} step={perSide ? 2 : 1} decimal={false} onChange={v => setC(x => ({ ...x, reps: v }))} />
        {/* On bodyweight work the weight stepper is the click #32 is about, so it is not here
            until there is a belt to describe — see the added-weight row below. */}
        {!bw && <Stepper label={t('Weight ({0})', st.unit)} value={c.weight} step={2.5} onChange={v => setC(x => ({ ...x, weight: v }))} />}
      </>}
    </div>
    {mode === 'time' && !bw && <div className="small dim" style={{ marginBottom: 18 }}>
      {t('A timer runs while you hold the set. Leave the weight at 0 for bodyweight holds.')}
    </div>}
    {/* ---------- bodyweight + per side (issues #31/#32/#33) ---------- */}
    {!cardio && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Bodyweight')}
        subtitle={bw ? t('No weight to enter — just log the reps.') : t('Ask for a weight on every set.')}>
        <Switch checked={bw} onChange={v => setC(x => ({ ...x, bodyweight: v, weight: v ? 0 : x.weight }))} />
      </Row>
      {mode === 'reps' && <Row icon="shuffle" iconTint="var(--blue)" title={t('Reps per side')}
        subtitle={perSide ? t('You still log the total: {0} is {1} per side.', c.reps || 0, fmtNum(sideReps(c.reps))) : t('For lunges, single-arm rows and the like.')}>
        {/* Turning it on rounds the target up to an even number, since half of an odd
            total is a rep one side does not get. */}
        <Switch checked={perSide} onChange={v => setC(x => ({ ...x, side: v || undefined, reps: v ? Math.ceil((x.reps || 0) / 2) * 2 : x.reps }))} />
      </Row>}
    </div>}
    {/* ---------- per-exercise rest override ---------- */}
    {!cardio && <div className="sect-b" style={{ marginBottom: 8 }}>
      <Row icon="timer" iconTint="var(--orange)" title={t('Custom rest')}
        subtitle={c.rest > 0 ? t('{0}s after every set of this exercise.', Math.round(c.rest)) : t('Uses the app-wide rest timer ({0}s).', st.restSec)}>
        <Switch checked={c.rest > 0} onChange={v => setC(x => ({ ...x, rest: v ? (x.rest || st.restSec) : undefined }))} />
      </Row>
    </div>}
    {c.rest > 0 && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Rest (seconds)')} value={c.rest} step={15} decimal={false} onChange={v => setC(x => ({ ...x, rest: v }))} />
    </div>}
    {/* A stepper is too wide to sit in a list row next to a label — it squeezes the text to
        one word per line — so added weight gets the same full-width treatment as sets and
        reps, with its explanation underneath. */}
    {bw && <>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Added ({0})', st.unit)} value={c.weight || 0} step={2.5}
          onChange={v => setC(x => ({ ...x, weight: v }))} />
      </div>
      <div className="small dim" style={{ marginBottom: 18 }}>
        {t('For dips or pull-ups with a belt. Progression then follows the weight.')}
      </div>
    </>}
    {/* The rep ceiling only means something when there is no load to add instead. */}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="row cfgrow" style={{ marginBottom: 18 }}>
      <Stepper label={t('Top of the range')} value={c.repsMax || 0} step={1} decimal={false}
        onChange={v => setC(x => ({ ...x, repsMax: v }))} />
    </div>}
    {mode === 'reps' && bw && !(c.weight > 0) && <div className="small dim" style={{ marginTop: -10, marginBottom: 18 }}>
      {c.repsMax > 0
        ? t('Reps climb to {0}, then a set is added and the reps start over. At {1} sets it asks you to add weight instead.', c.repsMax, MAX_BW_SETS)
        : t('Reps climb by one whenever every set was clean. Set a ceiling to add sets instead of reps forever.')}
    </div>}
    <ProgressionFields ex={ex} mode={mode} c={c} setC={setC} routine={routine} unit={st.unit} />
    <Button variant="primary" onClick={save}>{existing ? t('Save') : t('Add to routine')}</Button>
    {ex.custom && <><div style={{ height: 8 }} /><Button icon="pencil" onClick={() => { close(); customExSheet(ex) }}>{t('Edit or delete this exercise')}</Button></>}
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" onClick={() => { close(); onDelete() }}>{t('Remove from routine')}</Button></>}
  </>
}
export const exConfigSheet = (ex, existing, onSave, onDelete, routine) => ui().openSheet(close => <ExConfig ex={ex} existing={existing} onSave={onSave} onDelete={onDelete} routine={routine} close={close} />)

/* ============================ glyph picker ============================ */
// Grouped by what the glyph means for a training day, so picking one is a scan
// of four short rows rather than a hunt through twenty loose icons.
export const glyphPicker = (current, onPick) => {
  const cur = glyphOf(current)
  return ui().openSheet(close => <>
    <h3>{t('Pick an icon')}</h3>
    {GLYPH_GROUPS.map(g => (
      <div key={g.key} style={{ marginBottom: 14 }}>
        <div className="sect-t" style={{ padding: '0 2px 7px' }}>{t(g.key)}</div>
        <div className="glyph-grid">
          {g.items.map(n => (
            <button key={n} className={'glyph-cell' + (n === cur ? ' on' : '')}
              onClick={() => { close(); onPick(n) }} aria-label={n}>
              <Icon name={n} />
            </button>
          ))}
        </div>
      </div>
    ))}
    <div style={{ height: 4 }} />
  </>)
}

/* ============================ share / print / import a plan ============================ */
export const planToolsSheet = () => ui().openSheet(close => <PlanTools close={close} />)

function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const fileRef = useRef(null)
  const hasRoutines = (st.routines || []).some(r => r.ex && r.ex.length)

  const exportFile = async () => {
    const bundle = buildPlanBundle(st, user?.name ? t('{0}’s plan', user.name) : '')
    const json = JSON.stringify(bundle, null, 2)
    const name = 'opengym-plan-' + todayISO() + '.json'
    if (MOBILE) { try { await shareExport(json, name) } catch (e) { /* dismissed */ } close(); return }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    close(); toast(t('Plan file saved — send it to a friend'))
  }
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try { const bundle = parsePlan(rd.result); close(); planImportSheet(bundle) }
      catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Send your routines to a friend, or put your week on paper.')}</div>
    <Button variant="primary" icon="upload" onClick={exportFile} disabled={!hasRoutines}>{t('Export plan file')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A small file a friend imports into their own openGym — routines only, none of your workouts or weigh-ins.')}</div>
    {!MOBILE && <>
      <div style={{ height: 12 }} />
      <Button variant="tinted" icon="download" onClick={() => { close(); printPlan(st, user?.name || '') }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
      <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean one-page-per-plan printout — no exercise ever splits across a page.')}</div>
    </>}
    {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first — an empty plan has nothing to share.')}</div>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="folder" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
  </>
}

export const planImportSheet = bundle => ui().openSheet(close => <PlanImport bundle={bundle} close={close} />)

function PlanImport({ bundle, close }) {
  const [schedule, setSchedule] = useState(false)
  const apply = () => {
    update(s => mergePlan(s, bundle, { schedule }))
    close()
    toast(t('Added {0} routines to your plan', bundle.routineCount))
    nav('/plan')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t(bundle.routineCount === 1 ? '{0} routine' : '{0} routines', bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
      {bundle.scheduledDays > 0
        ? ' · ' + t(bundle.scheduledDays === 1 ? 'scheduled on {0} day' : 'scheduled on {0} days', bundle.scheduledDays)
        : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines — nothing you already have is changed.')}</div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ day override / assign ============================ */
function DayOverride({ iso, close }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyR = st.routines.find(r => r.id === st.week[wd])
  const hasOvr = st.dayPlan[iso] !== undefined
  const effId = effectiveRoutineId(st, iso)
  const set = v => {
    update(s => { if (!v) delete s.dayPlan[iso]; else s.dayPlan[iso] = v })
    close()
    toast(v === '' ? t('Back to weekly plan') : v === 'rest' ? t('{0} set to rest', fmtDate(iso)) : t('{0} planned for {1}', (st.routines.find(r => r.id === v) || {}).name, fmtDate(iso)))
  }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{hasOvr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    <div className="list">
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {effId === r.id && <Icon name="check" className="accent" />}</div>)}
      <div className="item" onClick={() => set('rest')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{effId === null && <Icon name="check" className="accent" />}</div>
      {hasOvr && <div className="item" onClick={() => set('')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </>
}
export const dayOverrideSheet = iso => ui().openSheet(close => <DayOverride iso={iso} close={close} />)

function DayAssign({ day, close }) {
  const st = useStore(s => s.S)
  const set = v => { update(s => { if (v) s.week[day] = v; else delete s.week[day] }); close() }
  return <>
    <h3>{t(DAYN[day])}</h3>
    <div className="list">
      <div className="item" onClick={() => set('')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest day')}</div></div>{!st.week[day] && <Icon name="check" className="accent" />}</div>
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => set(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {st.week[day] === r.id && <Icon name="check" className="accent" />}</div>)}
    </div>
  </>
}
export const dayAssignSheet = day => ui().openSheet(close => <DayAssign day={day} close={close} />)

/* ============================ workout detail ============================ */
function WorkoutDetail({ w, close }) {
  const st = useStore(s => s.S)
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {w.entries.map((e, i) => {
      const ex = EXIDX[e.id]
      return <div key={i} className="row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
        {ex && <Thumb ex={ex} />}
        <div className="grow"><div className="tt capitalize" style={{ fontWeight: 600 }}>{ex ? ex.n : (e.n || e.id)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
          <div className="ss">{e.sets.filter(s => s.done).map(s => setLabel(e.id, s, e.target)).join('  ·  ') || t('no sets')}</div></div>
      </div>
    })}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
export const workoutDetailSheet = w => ui().openSheet(close => <WorkoutDetail w={w} close={close} />)

/* ============================ calendar ============================ */
function Calendar({ start, close }) {
  const st = useStore(s => s.S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start) : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay = {}
  st.workouts.forEach(w => (byDay[w.d] = byDay[w.d] || []).push(w))
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter(w => w.d.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a, w) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a, w) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso], effId = effectiveRoutineId(st, iso), ovr = st.dayPlan[iso] !== undefined
    const dotCls = ws ? 'done' : ovr && effId ? 'ovr' : effId ? 'plan' : ''
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (iso === todayISO() ? ' today' : '')} onClick={() => {
      if (!ws) { close(); dayOverrideSheet(iso); return }
      if (ws.length === 1) { close(); workoutDetailSheet(ws[0]); return }
      close(); ui().openSheet(c2 => <><h3>{fmtDate(iso, true)}</h3><div className="list">{ws.map(w => <WorkoutRow key={w.id} w={w} onClick={() => { c2(); workoutDetailSheet(w) }} />)}</div></>)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label="Next month"><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${t(monthWs.length === 1 ? '{0} workout' : '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--label-3)' }} />{t('Planned')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Rescheduled')}</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{t('Tap a trained day for details · tap any other day to plan a session')}</div>
  </>
}
export const calendarSheet = start => ui().openSheet(close => <Calendar start={start} close={close} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }) {
  const st = useStore(s => s.S)
  const glyph = glyphOf((st.routines.find(r => r.id === w.routineId) || {}).emoji)
  return <div className="item" onClick={onClick}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{w.name}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), t('{0} sets', setsDone(w)), fmtVol(w.vol, st.unit)].join(' · ')}</div></div>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* ============================ workout lifecycle ============================ */
export function startFlow(routineId) {
  bwSheet({ required: true, onDone: bw => beginWorkout(routineId, bw) })
}
export function beginWorkout(routineId, bw) {
  const st = S()
  const r = routineId ? st.routines.find(x => x.id === routineId) : null
  // The prescription is applied as the session is built, so you walk up to the bar with the
  // right weight already on the screen instead of being told about it afterwards. `plan` is
  // kept on the entry purely so the workout can explain the number it chose.
  const entries = (r ? r.ex : []).map(cfg => {
    const plan = nextPrescription(st, cfg, r)
    return { id: cfg.id, sg: cfg.sg, target: { ...cfg }, plan, sets: applyPrescription(buildSets(st, cfg), plan) }
  })
  update(s => {
    s.active = { id: uid(), d: todayISO(), start: Date.now(), routineId, name: r ? r.name : t('Freestyle'), bw: bw || null, cur: 0, entries }
  })
  useUI.getState().stopRest()
  useUI.getState().resetHrPeak()   // fresh peak for this session; any connected monitor stays connected
  nav('/workout')
}
function TopWeight({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const A = st.active
  // The workout can end underneath this sheet: finishing from the last exercise clears
  // `active`, and this re-renders before the sheet is torn down. Everything below is
  // read defensively and the sheet dismisses itself — reading A.entries straight took
  // the whole app down with it. Hooks still run unconditionally, so the bail-out has
  // to sit after every one of them.
  const entry = A ? A.entries[entryIdx] : null
  const ex = entry && EXIDX[entry.id]
  const maxSet = entry ? Math.max(0, ...entry.sets.filter(s => s.done && !s.warmup).map(s => s.w || 0)) : 0
  const prevBest = entry ? Math.max((st.exWeights[entry.id] || {}).w || 0, bestWeightFor(st, entry.id)) : 0
  const [v, setV] = useState(entry ? (Math.max(maxSet, prevBest) || entry.target.weight || 0) : 0)
  useEffect(() => { if (!entry) close() }, [!entry])

  const units = supersetUnits(A ? A.entries : [])
  const unit = entry ? unitOf(units, entryIdx) : []
  const unitDone = !!entry && unit.every(i => A.entries[i].sets.every(s => s.done))
  const unitIdx = units.findIndex(u => u === unit)
  const isLastUnit = unitIdx === units.length - 1
  if (!entry || !ex) return null

  const commit = advance => {
    const n = Math.round((v || 0) * 10) / 10
    if (!isFinite(n) || n < 0) { toast(t('Enter a valid weight')); return }
    update(s => {
      s.active.entries[entryIdx].topW = n
      const cur = s.exWeights[entry.id]
      s.exWeights[entry.id] = { w: Math.max(n, cur ? cur.w : 0), d: todayISO() }
    })
    close()
    if (advance && unitDone) {
      if (isLastUnit) workoutCompleteSheet()               // whole workout done → finish/continue prompt
      else update(s => { s.active.cur = units[unitIdx + 1][0] })
    } else toast(t('Tracked — next time starts at {0}', fmtNum(S().exWeights[entry.id].w) + ' ' + st.unit))
  }
  return <>
    <h3 className="capitalize row" style={{ gap: 8 }}><Icon name="checkCircle" style={{ color: 'var(--acc)' }} />{t('{0} done', ex.n)}</h3>
    <div className="muted small">{t('Confirm the weight you worked with — your highest becomes the default next time.')}{!unitDone && unit.length > 1 ? ' ' + t('Then finish the superset partner.') : ''}</div>
    <WeightInput value={v} setValue={setV} unit={st.unit} />
    <div style={{ height: 10 }} />
    {prevBest > 0 ? <div className="small dim" style={{ textAlign: 'center', marginBottom: 12 }}>{t('Previous best:')} {fmtNum(prevBest)} {st.unit}{maxSet > prevBest && <span style={{ color: 'var(--yellow)' }}> — {t('new record!')}</span>}</div> : <div style={{ height: 4 }} />}
    {unitDone ? <>
      <Button variant="primary" trailingIcon={isLastUnit ? null : 'chevronRight'} onClick={() => commit(true)}>{isLastUnit ? t('Save') : t('Save & next exercise')}</Button>
      <div style={{ height: 8 }} /><Button variant="ghost" className="dim" onClick={() => commit(false)}>{t('Just close')}</Button>
    </> : <Button variant="primary" onClick={() => commit(false)}>{t('Save weight')}</Button>}
  </>
}
export const topWeightSheet = entryIdx => ui().openSheet(close => <TopWeight entryIdx={entryIdx} close={close} />)

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close }) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Every exercise done — great work. Finish up, or keep going and add another exercise.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); useUI.getState().toast(t('Keep going — tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => ui().openSheet(close => <WorkoutComplete close={close} />, { kind: 'center' })

function FinishSummary({ w, prs, e1prs = [], close }) {
  const st = useStore(s => s.S)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{setsDone(w)}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '—'}</div></div>
    </div>
    {w.hrMax > 0 && <div className="small row" style={{ gap: 5, justifyContent: 'center', color: 'var(--red)', marginBottom: 4 }}><Icon name="heart" style={{ fontSize: 13 }} />{t('Peak heart rate: {0} bpm', w.hrMax)}</div>}
    {(prs.length > 0 || e1prs.length > 0) && <div style={{ textAlign: 'left', marginBottom: 12 }}>
      {prs.map(id => <div key={id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} {(EXIDX[id] || {}).n || id}</div>)}
      {e1prs.map(p => <div key={p.id} className="small accent capitalize row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} {(EXIDX[p.id] || {}).n || p.id} · {fmtNum(p.est)} {st.unit}</div>)}
    </div>}
    <h4 className="sec" style={{ textAlign: 'left' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w])} body={st.body} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={() => { close(); nav('/home') }}>{t('Nice!')}</Button>
  </div>
}
export function finishWorkout() {
  const A = S().active
  if (!A) return
  const done = setsDoneActive(A)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: doFinishWorkout }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: t(total - done === 1 ? '{0} set still unchecked. Finish the workout now?' : '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: doFinishWorkout }); return }
  doFinishWorkout()
}
function doFinishWorkout() {
  const st = S()
  const A = st.active
  if (!A) return
  const prs = []
  const e1prs = []
  A.entries.forEach(e => {
    const mx = Math.max(0, ...e.sets.filter(s => s.done && !s.warmup).map(s => s.w))
    if (mx > 0 && mx > bestWeightFor(st, e.id)) prs.push(e.id)
    // A heavier estimate without a heavier top set is its own kind of progress —
    // same weight for more reps. Reported separately so it can't be read as a load PR.
    const rec = is1RMRecord(st, e.id, e)
    if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
  })
  const w = {
    id: A.id, d: A.d, start: A.start, end: Date.now(), routineId: A.routineId, name: A.name, bw: A.bw,
    // `target` (what the session prescribed) is kept alongside the sets: without it a
    // finished workout cannot say whether it hit its reps, and a timed session reads back
    // as "0 reps". It is what the progression engine works from.
    entries: A.entries.map(e => ({ id: e.id, sets: e.sets, topW: e.topW || null, target: e.target || null })).filter(e => e.sets.some(s => s.done)),
    prs
  }
  w.vol = workoutVolume(w)
  const hrMax = useUI.getState().hrMax
  if (hrMax > 0) w.hrMax = hrMax   // peak heart rate, when a monitor was connected this session
  update(s => {
    w.entries.forEach(e => {
      const mx = Math.max(0, ...e.sets.filter(x => x.done && !x.warmup).map(x => x.w || 0), e.topW || 0)
      if (mx > 0) { const cur = s.exWeights[e.id]; if (!cur || mx > cur.w) s.exWeights[e.id] = { w: mx, d: w.d } }
    })
    s.workouts.push(w)
    s.active = null
  })
  useUI.getState().stopRest()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  ui().openSheet(close => <FinishSummary w={w} prs={prs} e1prs={e1prs} close={close} />, { kind: 'center', locked: true })
}

/* ============================ AI: quick-log a set from text ============================ */
// Reps-mode only (issue: cardio/time targets don't map onto the sets/reps/weight the parser
// returns) — the button that opens this is hidden for those modes.
function AiQuickLog({ ex, unit, close, onApply }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const parse = async () => {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true); setErr('')
    try {
      const r = await aiParseSet(v, ex.n, unit)
      if (!r.confident && r.sets == null && r.reps == null && r.weight == null) setErr(t('Couldn’t make sense of that — try again with the numbers spelled out.'))
      else setResult(r)
    } catch (e) { setErr(aiErrorMessage(e)) }
    setBusy(false)
  }
  return <>
    <h3>{t('Quick log')}</h3>
    <div className="small dim" style={{ margin: '0 0 12px' }}>{t('Describe the set in your own words, e.g. “did 3 sets of 10 at 60kg”.')}</div>
    {!result ? <>
      <textarea className="input" rows={3} autoFocus value={text} onChange={e => setText(e.target.value)}
        placeholder={t('e.g. 3x10 at 60kg')} style={{ marginBottom: 12, resize: 'none' }} />
      {err && <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}
      <Button variant="primary" disabled={!text.trim() || busy} onClick={parse}>{busy ? t('Parsing…') : t('Parse')}</Button>
    </> : <>
      <div className="row cfgrow" style={{ marginBottom: 18 }}>
        <Stepper label={t('Sets')} value={result.sets || 1} step={1} decimal={false} onChange={v => setResult(x => ({ ...x, sets: v }))} />
        <Stepper label={t('Reps')} value={result.reps || 0} step={1} decimal={false} onChange={v => setResult(x => ({ ...x, reps: v }))} />
        <Stepper label={t('Weight ({0})', unit)} value={result.weight || 0} step={2.5} onChange={v => setResult(x => ({ ...x, weight: v }))} />
      </div>
      {!result.confident && <div className="small dim" style={{ marginBottom: 12 }}>{t('Not fully sure about this one — check the numbers before applying.')}</div>}
      <Button variant="primary" onClick={() => { close(); onApply(result) }}>{t('Apply to next set')}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={() => setResult(null)}>{t('Try again')}</Button>
    </>}
  </>
}
export const aiQuickLogSheet = (ex, unit, onApply) => ui().openSheet(close => <AiQuickLog ex={ex} unit={unit} close={close} onApply={onApply} />)

/* ============================ AI: coach read-out ============================ */
// Starter questions shown on the Home card and inside the sheet. The first one is the classic
// training read-out; the rest are answered from the same data (meals, steps, weight included).
export const COACH_QUESTIONS = [
  'How is my training going?',
  'Am I getting enough protein?',
  'How many calories do I need?',
  'What should I train today?'
]

function AiCoach({ close, initial }) {
  const [msgs, setMsgs] = useState([])          // [{ role: 'user'|'assistant', content }]
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState('')
  const endRef = useRef(null)
  const started = useRef(false)
  const ask = async (q, history = msgs) => {
    const question = (q || '').trim()
    if (!question || busy) return
    setErr(''); setDraft('')
    setMsgs(m => [...m, { role: 'user', content: question }])
    setBusy(true)
    try {
      // The first starter question is the full read-out, which has its own richer prompt.
      const readout = question === t(COACH_QUESTIONS[0])
      const r = await aiCoach(readout ? '' : question, history, coachOf(useStore.getState().S) || COACHES[0])
      setMsgs(m => [...m, { role: 'assistant', content: r.text }])
    } catch (e) { setErr(aiErrorMessage(e)) }
    setBusy(false)
  }
  // StrictMode runs effects twice in dev — the ref keeps the opening question from being sent twice.
  useEffect(() => { if (initial && !started.current) { started.current = true; ask(t(initial), []) } }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [msgs.length, busy])
  const asked = new Set(msgs.filter(m => m.role === 'user').map(m => m.content))
  const suggestions = COACH_QUESTIONS.filter(q => !asked.has(t(q)))
  const S = useStore(s => s.S)
  const coach = coachOf(S) || COACHES[0]
  const other = COACHES.find(c => c.id !== coach.id)
  return <>
    <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 14 }}>
      <span className="coach-avatar"><CoachAvatar gender={coach.gender} size={44} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h3 style={{ marginBottom: 0 }}>{coach.name}</h3>
        <div className="dim small">{t('Ask anything about your training, food, steps or weight.')}</div>
      </div>
      <button className="chip nocap small" style={{ fontSize: 12 }} onClick={() => update(s => { s.coach = other.id })}>{t('Switch to {0}', other.name)}</button>
    </div>
    <div className="coach-chat">
      {msgs.map((m, i) => <div key={i} className={'coach-msg ' + m.role}>{m.content}</div>)}
      {busy && <div className="coach-msg assistant dim">{t('Thinking…')}</div>}
      {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}
      <div ref={endRef} />
    </div>
    {suggestions.length > 0 && <div className="coach-sugg">
      {suggestions.map(q => <button key={q} className="chip nocap" disabled={busy} onClick={() => ask(t(q))}>{t(q)}</button>)}
    </div>}
    <form className="coach-ask" onSubmit={e => { e.preventDefault(); ask(draft) }}>
      <TextField value={draft} onChange={e => setDraft(e.target.value)} placeholder={t('Ask something else…')} disabled={busy} />
      <button type="submit" className="coach-send" disabled={busy || !draft.trim()} aria-label={t('Send')}><Icon name="arrowUp" /></button>
    </form>
  </>
}
export const coachSheet = (question) => ui().openSheet(close => <AiCoach close={close} initial={question || ''} />)

/* ============================ AI: identify exercise from photo ============================ */
// Rough text-overlap score against the AI's guess — good enough to surface a couple of
// candidates from the catalog without shipping the whole 800KB dataset to the model.
function scoreMatch(guess, ex) {
  const gwords = new Set(guess.name.toLowerCase().split(/\W+/).filter(Boolean))
  const ewords = new Set(ex.n.toLowerCase().split(/\W+/).filter(Boolean))
  let overlap = 0
  gwords.forEach(w => { if (ewords.has(w)) overlap++ })
  let score = overlap / Math.max(1, Math.max(gwords.size, ewords.size))
  if (ex.bp === guess.bodyPart) score += 0.3
  const geq = (guess.equipment || '').toLowerCase()
  if (geq && ex.eq && (ex.eq.includes(geq) || geq.includes(ex.eq))) score += 0.2
  return score
}
const topMatches = (guess, st, n = 3) => allExercises(st).map(e => ({ e, score: scoreMatch(guess, e) }))
  .filter(x => x.score > 0.15).sort((a, b) => b.score - a.score).slice(0, n).map(x => x.e)

function IdentifyExercise({ file, close }) {
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [guess, setGuess] = useState(null)
  const [photoUrl] = useState(() => URL.createObjectURL(file))
  useEffect(() => {
    (async () => {
      try {
        const { base64, mediaType } = await fileToResizedBase64(file)
        setGuess(await aiIdentifyExercise(base64, mediaType))
      } catch (e) { setErr(aiErrorMessage(e)) }
      setBusy(false)
    })()
    return () => URL.revokeObjectURL(photoUrl)
  }, [])
  const matches = guess && guess.confidence !== 'none' ? topMatches(guess, S()) : []
  return <>
    <h3>{t('Identify from photo')}</h3>
    <img src={photoUrl} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 12, maxHeight: 220, objectFit: 'cover' }} />
    {busy && <div className="small dim">{t('Looking at your photo…')}</div>}
    {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}
    {guess && guess.confidence === 'none' && <div className="small dim">{t('Couldn’t spot an exercise in that photo — try getting closer to the machine.')}</div>}
    {guess && guess.confidence !== 'none' && <>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '4px 0 4px' }}>
        <span className="tag acc capitalize">{guess.name}</span>
        <span className="tag capitalize">{t(guess.bodyPart)}</span>
        <span className="tag capitalize">{t(guess.equipment)}</span>
      </div>
      {guess.note && <div className="small dim" style={{ marginBottom: 12 }}>{guess.note}</div>}
      {guess.confidence === 'low' && <div className="small dim" style={{ marginBottom: 12 }}>{t('Not very sure about this one — double check before adding.')}</div>}
      {matches.length > 0 && <>
        <h4 className="sec">{t('Closest matches in your library')}</h4>
        <div className="list" style={{ marginBottom: 12 }}>
          {matches.map(e => <div key={e.id} className="item" onClick={() => { close(); addToRoutineSheet(e) }}>
            <Thumb ex={e} /><div className="grow"><div className="tt capitalize">{e.n}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div><Icon name="plus" className="chev" />
          </div>)}
        </div>
      </>}
      <Button onClick={() => { close(); customExSheet(null, ex => addToRoutineSheet(ex), { name: guess.name, bp: guess.bodyPart }) }}>
        {matches.length ? t('None of these — create as new') : t('Create “{0}” as a new exercise', guess.name)}
      </Button>
    </>}
  </>
}
export const identifyExerciseSheet = file => ui().openSheet(close => <IdentifyExercise file={file} close={close} />)

/* ============================ AI: swap the current exercise ============================ */
// Candidates handed to the model: real library exercises that train the same muscle (target
// first, then the wider body part), same log-mode as the exercise being swapped, capped so the
// prompt stays cheap. The model can only ever pick from these, so every suggestion resolves to
// a known id we can swap straight to.
function altCandidates(st, ex) {
  const cardio = isCardio(ex.id)
  const pool = allExercises(st).filter(e => e.id !== ex.id && isCardio(e.id) === cardio)
  const sameTarget = pool.filter(e => ex.tg && e.tg === ex.tg)
  const sameBodyPart = pool.filter(e => e.bp === ex.bp && !(ex.tg && e.tg === ex.tg))
  return [...sameTarget, ...sameBodyPart].slice(0, 120).map(e => ({ id: e.id, n: e.n, eq: e.eq, tg: e.tg }))
}
// Reason chips steer the picks — leaving it blank just asks for the closest equivalents.
const SWAP_REASONS = [
  { k: '', label: 'Similar' },
  { k: 'the machine or equipment is taken', label: 'Equipment busy' },
  { k: 'I have no equipment / only bodyweight', label: 'No equipment' },
  { k: 'it is too hard, I want an easier variation', label: 'Easier' },
  { k: 'it is too easy, I want a harder variation', label: 'Harder' },
  { k: 'it aggravates a joint / causes pain', label: 'It hurts' },
]

// Replaces the exercise on an active entry in place, keeping the number of sets. Sets, target,
// progression plan and the "confirm working weight" flag are all rebuilt for the new exercise;
// the entry drops out of any superset it was in (its partner stays valid on its own).
function swapEntry(entryIdx, newId) {
  update(s => {
    const e = s.active && s.active.entries[entryIdx]
    if (!e) return
    const count = Math.max(1, e.sets.length)
    const target = defaultConfig(newId)
    const full = { ...target, id: newId }
    const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
    let sets = applyPrescription(buildSets(s, full), plan)
    while (sets.length < count) sets.push({ ...sets[sets.length - 1] })
    sets = sets.slice(0, count).map(x => ({ ...x, done: false }))
    e.id = newId; e.target = { ...target }; e.plan = plan; e.sets = sets
    e.asked = false; delete e.topW; delete e.sg
  }, true)
}

function SwapExercise({ entryIdx, close }) {
  const st = useStore(s => s.S)
  const entry = st.active && st.active.entries[entryIdx]
  const ex = entry ? exOr(entry.id) : null
  const [cands] = useState(() => (ex ? altCandidates(st, ex) : []))
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [reason, setReason] = useState('')
  const [alts, setAlts] = useState([])
  // "This machine is free — what can I do on it?": photograph it, identify it, and rank the
  // library matches with the same-muscle candidates boosted so a like-for-like swap comes first.
  const photoInput = useRef(null)
  const [photo, setPhoto] = useState(null)   // { busy, err, guess, matches: [{ e, sameMuscle }] }
  const identify = async file => {
    setPhoto({ busy: true })
    try {
      const { base64, mediaType } = await fileToResizedBase64(file)
      const guess = await aiIdentifyExercise(base64, mediaType)
      if (guess.confidence === 'none') { setPhoto({ guess, matches: [] }); return }
      const sameMuscle = new Set(cands.map(c => c.id))
      const matches = allExercises(st).filter(e => e.id !== ex.id && isCardio(e.id) === isCardio(ex.id))
        .map(e => ({ e, score: scoreMatch(guess, e) + (sameMuscle.has(e.id) ? 0.35 : 0), sameMuscle: sameMuscle.has(e.id) }))
        .filter(x => x.score > 0.15).sort((a, b) => b.score - a.score).slice(0, 4)
      setPhoto({ guess, matches })
    } catch (e) { setPhoto({ err: aiErrorMessage(e) }) }
  }

  const run = async rsn => {
    setBusy(true); setErr(''); setAlts([])
    try {
      const r = await aiAlternatives({ name: ex.n, bodyPart: ex.bp, target: ex.tg, equipment: ex.eq }, cands, rsn)
      const byId = {}; allExercises(st).forEach(e => { byId[e.id] = e })
      setAlts((r.alternatives || []).map(a => ({ ex: byId[a.id], why: a.why })).filter(a => a.ex))
    } catch (e) { setErr(aiErrorMessage(e)) }
    setBusy(false)
  }
  useEffect(() => { if (ex) run(''); else close() }, [])

  const pick = e => { swapEntry(entryIdx, e.id); close(); toast(t('Swapped to {0}', e.n)) }
  if (!ex) return null

  return <>
    <h3 className="capitalize">{t('Swap “{0}”', ex.n)}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Pick a different exercise for this slot — your sets carry over. The suggestions train the same muscle.')}</div>
    <div className="chips" style={{ marginBottom: 12 }}>
      {SWAP_REASONS.map(r => <button key={r.label} className={'chip' + (reason === r.k ? ' on' : '')}
        onClick={() => { setReason(r.k); run(r.k) }}>{t(r.label)}</button>)}
    </div>
    <input ref={photoInput} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) identify(f) }} />
    <Button variant="tinted" icon="camera" onClick={() => photoInput.current?.click()} style={{ marginBottom: 12 }}>{t('Photograph the free machine')}</Button>
    {photo && <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      {photo.busy && <div className="row small dim" style={{ gap: 8 }}><span className="spin" />{t('Looking at your photo…')}</div>}
      {photo.err && <div className="small" style={{ color: 'var(--red)' }}>{photo.err}</div>}
      {photo.guess && photo.guess.confidence === 'none' && <div className="small dim">{t('Couldn’t spot an exercise in that photo — try getting closer to the machine.')}</div>}
      {photo.guess && photo.guess.confidence !== 'none' && <>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <span className="small muted">{t('In the photo:')}</span>
          <span className="tag acc capitalize">{photo.guess.name}</span>
          <span className="tag capitalize">{t(photo.guess.bodyPart)}</span>
        </div>
        {photo.matches.length === 0 && <div className="small dim">{t('No library match for that machine — browse all exercises below.')}</div>}
        {photo.matches.length > 0 && !photo.matches[0].sameMuscle && <div className="small" style={{ color: 'var(--orange)', marginBottom: 8 }}>{t('That machine trains a different muscle than “{0}” — fine as a swap, but it won’t cover the same work.', ex.n)}</div>}
        {photo.matches.length > 0 && <div className="list">
          {photo.matches.map(m => <div key={m.e.id} className="item" onClick={() => pick(m.e)}>
            <Thumb ex={m.e} />
            <div className="grow"><div className="tt capitalize">{m.e.n}</div><div className="ss capitalize">{t(m.e.tg || m.e.bp)} · {t(m.e.eq)}{m.sameMuscle ? ' · ' + t('same muscle') : ''}</div></div>
            <span className="tag acc">{t('Swap')}</span>
          </div>)}
        </div>}
      </>}
    </div>}
    {busy && <div className="small dim">{t('Finding alternatives…')}</div>}
    {err && <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}
    {!busy && !err && alts.length === 0 && <div className="small dim">{t('No suggestions for that — browse the full library below.')}</div>}
    {alts.length > 0 && <div className="list" style={{ marginBottom: 12 }}>
      {alts.map(a => <div key={a.ex.id} className="item" onClick={() => pick(a.ex)}>
        <Thumb ex={a.ex} />
        <div className="grow"><div className="tt capitalize">{a.ex.n}</div><div className="ss">{a.why || t(a.ex.tg || a.ex.bp)}</div></div>
        <span className="tag acc">{t('Swap')}</span>
      </div>)}
    </div>}
    <Button icon="magnifier" onClick={() => { close(); exercisePicker(e => { swapEntry(entryIdx, e.id); toast(t('Swapped to {0}', e.n)) }) }}>{t('Browse all exercises')}</Button>
  </>
}
export const swapExerciseSheet = entryIdx => ui().openSheet(close => <SwapExercise entryIdx={entryIdx} close={close} />)

/* ============================ water log ============================ */
const WATER_ADDS = [{ ml: 250, label: 'Glass' }, { ml: 500, label: 'Bottle' }, { ml: 750, label: 'Large' }]
export function addWater(ml) {
  update(s => {
    s.water = s.water || []
    const iso = todayISO()
    const row = s.water.find(w => w.d === iso)
    if (row) row.ml = Math.max(0, Math.round(row.ml + ml))
    else s.water.push({ d: iso, ml: Math.max(0, Math.round(ml)) })
    s.water.sort((a, b) => (a.d < b.d ? -1 : 1))
  })
}
export const waterToday = st => ((st.water || []).find(w => w.d === todayISO()) || {}).ml || 0

function WaterSheet({ close }) {
  const st = useStore(s => s.S)
  const today = waterToday(st)
  const goal = st.waterGoal || 2000
  const pct = Math.min(100, Math.round((today / goal) * 100))
  const reached = today >= goal
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="droplet" style={{ color: 'var(--blue)' }} />{t('Water today')}</h3>
    <div className="muted small">{t('Today') + ', ' + fmtDate(todayISO(), true)}</div>
    <div className="row" style={{ gap: 8, alignItems: 'baseline', margin: '10px 0 6px' }}>
      <div className="big">{fmtWater(today)}</div>
      <span className="dim small">/ {fmtWater(goal)}{reached ? ' · ' + t('goal reached!') : ''}</span>
    </div>
    <div className="wprog" style={{ marginBottom: 16 }}><i style={{ width: pct + '%', background: reached ? 'var(--acc)' : 'var(--blue)' }} /></div>
    <div className="row" style={{ gap: 8, marginBottom: 8 }}>
      {WATER_ADDS.map(a => <Button key={a.ml} style={{ flex: 1 }} icon="plus" onClick={() => addWater(a.ml)}>{t(a.label)}<br /><span className="dim small">{fmtWater(a.ml)}</span></Button>)}
    </div>
    <div className="row" style={{ gap: 8, marginBottom: 16 }}>
      <Button style={{ flex: 1 }} icon="minus" disabled={!today} onClick={() => addWater(-250)}>{t('Undo 250 ml')}</Button>
      <Button style={{ flex: 1 }} variant="ghost" className="dim" disabled={!today} onClick={() => update(s => { s.water = (s.water || []).filter(w => w.d !== todayISO()) })}>{t('Clear today')}</Button>
    </div>
    <h4 className="sec">{t('Daily goal')}</h4>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Goal (ml)')} value={goal} step={250} decimal={false} onChange={v => update(s => { s.waterGoal = Math.max(250, Math.round(v)) })} />
    </div>
    <div className="small dim" style={{ marginBottom: 12 }}>{t('A common target is 30–35 ml per kg of body weight — adjust to what your day needs.')}</div>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const waterSheet = () => ui().openSheet(close => <WaterSheet close={close} />)

/* ============================ heart-rate monitor (Web Bluetooth) ============================ */
function HeartRateSheet({ close }) {
  const hr = useUI(s => s.hr)
  const hrName = useUI(s => s.hrName)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const connect = async () => {
    setBusy(true); setErr('')
    try {
      const { name } = await hrConnect(bpm => ui().setHr(bpm), () => { ui().setHrName(null) })
      ui().setHrName(name)
    } catch (e) {
      // The chooser being dismissed isn't an error worth showing.
      if (e && e.name !== 'NotFoundError') setErr(e.message || t('Could not connect'))
    }
    setBusy(false)
  }
  const disconnect = () => { hrDisconnect(); ui().setHrName(null) }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="heart" style={{ color: 'var(--red)' }} />{t('Heart rate')}</h3>
    {hrName ? <>
      <div style={{ textAlign: 'center', margin: '14px 0' }}>
        <div style={{ fontSize: 46, fontWeight: 700, lineHeight: 1, color: 'var(--red)' }}>{hr != null ? hr : '—'}<span className="dim" style={{ fontSize: 18, fontWeight: 500 }}> {t('bpm')}</span></div>
        <div className="small dim" style={{ marginTop: 6 }}>{hrName} · {hr != null ? t('live') : t('waiting for a reading…')}</div>
      </div>
      <Button variant="danger" icon="xmark" onClick={disconnect}>{t('Disconnect')}</Button>
    </> : <>
      <div className="muted small" style={{ marginBottom: 14 }}>{t('Pair a Bluetooth heart-rate monitor — a chest strap, or a watch broadcasting its heart rate. Your live BPM then shows during workouts.')}</div>
      {err && <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}
      <Button variant="primary" icon="bluetooth" disabled={busy} onClick={connect}>{busy ? t('Searching…') : t('Connect a monitor')}</Button>
      <div className="small dim" style={{ marginTop: 12, lineHeight: 1.5 }}>{t('Apple Watch doesn’t broadcast over Bluetooth on its own — open a heart-rate broadcast app on it first (or use a chest strap). iPhones can’t scan for Bluetooth from the browser.')}</div>
    </>}
  </>
}
export const heartRateSheet = () => ui().openSheet(close => <HeartRateSheet close={close} />)
export { hrSupported }
