// Meal-log sheets: analyse a photo / description with AI, review + edit the itemised estimate,
// edit a saved meal, set macro goals, and the month calendar. Kept apart from sheets.jsx so the
// nutrition feature is one module to read (lib/nutrition.js has the pure maths).
import { useEffect, useRef, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { fmtDate, fmtNum, todayISO, uid, MONTHS_LONG } from './lib/format.js'
import { t, getLang } from './lib/i18n.js'
import { aiAnalyzeMeal, aiImportPlan, aiRecipes, fileToResizedBase64, aiErrorMessage } from './lib/api.js'
import { readUpload, UPLOAD_ACCEPT } from './lib/upload.js'
import {
  MEAL_TYPES, MEAL_TYPE_LABEL, MEAL_TYPE_ICON, macroGoalOf, cleanItem, scaleItem, totalsOf,
  guessMealType, nowHHMM, kcalByDay, pctOf, MICROS, MICRO_UNIT, MICRO_IS_CEILING
} from './lib/nutrition.js'
import Icon from './components/Icon.jsx'
import { Button, Segmented, TextField, TextArea, Stepper } from './components/ui.jsx'
import Ring from './components/Ring.jsx'
import { goalWizardSheet, sourcesSheet, DISCLAIMER } from './sheets-goal.jsx'
import { GOAL_LABEL } from './lib/nutrition-goal.js'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/* ============================ persistence ============================ */

export function saveMeal(meal) {
  update(s => {
    s.meals = s.meals || []
    const i = s.meals.findIndex(m => m.id === meal.id)
    if (i >= 0) s.meals[i] = meal; else s.meals.push(meal)
    s.meals.sort((a, b) => (a.d + a.t < b.d + b.t ? -1 : 1))
  })
}
export function deleteMeal(id) { update(s => { s.meals = (s.meals || []).filter(m => m.id !== id) }) }

/* ============================ shared bits ============================ */

// Compact P / C / F readout used under every total.
export function MacroLine({ tot, dim }) {
  return <span className={'small ' + (dim ? 'dim' : 'muted')} style={{ whiteSpace: 'nowrap' }}>
    <b style={{ fontWeight: 500, color: 'var(--blue)' }}>P</b> {fmtNum(tot.protein)}g · <b style={{ fontWeight: 500, color: 'var(--orange)' }}>C</b> {fmtNum(tot.carbs)}g · <b style={{ fontWeight: 500, color: 'var(--yellow)' }}>F</b> {fmtNum(tot.fat)}g
  </span>
}

function ItemRow({ item, onChange, onRemove }) {
  const [open, setOpen] = useState(!!item._new)   // a hand-added row opens straight into its fields
  return <div className="nitem">
    <div className="row" style={{ gap: 10 }}>
      <div className="grow" style={{ minWidth: 0 }} onClick={() => setOpen(o => !o)}>
        <div className="tt">{item.name}</div>
        <div className="ss">{[item.portion, item.grams ? item.grams + ' g' : ''].filter(Boolean).join(' · ')}</div>
      </div>
      <div style={{ textAlign: 'right', flex: 'none' }}>
        <div className="tt">{fmtNum(item.kcal)} <span className="dim small">kcal</span></div>
        <MacroLine tot={item} dim />
      </div>
      <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 14 }} onClick={() => setOpen(o => !o)} aria-label={t('Edit')}><Icon name={open ? 'chevronUp' : 'pencil'} /></button>
    </div>
    {open && <div className="nitem-edit">
      <TextField value={item.name} onChange={e => onChange({ ...item, name: e.target.value })} placeholder={t('Food name')} />
      <div className="row cfgrow">
        <Stepper label={t('Portion (g)')} value={item.grams} step={10} decimal={false} onChange={g => onChange(scaleItem(item, g))} />
        <Stepper label="kcal" value={item.kcal} step={10} decimal={false} onChange={v => onChange({ ...item, kcal: v })} />
      </div>
      <div className="row cfgrow">
        <Stepper label={t('Protein (g)')} value={item.protein} step={1} onChange={v => onChange({ ...item, protein: v })} />
        <Stepper label={t('Carbs (g)')} value={item.carbs} step={1} onChange={v => onChange({ ...item, carbs: v })} />
        <Stepper label={t('Fat (g)')} value={item.fat} step={1} onChange={v => onChange({ ...item, fat: v })} />
      </div>
      <div className="row cfgrow">
        <Stepper label={t('Sugar (g)')} value={item.sugar || 0} step={1} onChange={v => onChange({ ...item, sugar: v })} />
        <Stepper label={t('Fibre (g)')} value={item.fiber || 0} step={1} onChange={v => onChange({ ...item, fiber: v })} />
        <Stepper label={t('Sodium (mg)')} value={item.sodium || 0} step={50} decimal={false} onChange={v => onChange({ ...item, sodium: v })} />
      </div>
      <div className="small dim">{t('Changing the portion rescales calories and macros proportionally.')}</div>
      <Button size="sm" variant="danger" icon="trash" onClick={onRemove}>{t('Remove item')}</Button>
    </div>}
  </div>
}

// The editable meal: name, slot, time, items with per-item edit, totals. Used for a fresh AI
// result and for an existing meal alike — `meal` is the draft, `onSave` receives the final one.
// `refine` (optional) is how the person talks back to the estimate: it gets their correction
// and the current items, and resolves to a revised { name, items, note } from the model.
function MealForm({ draft, onSave, onDelete, close, saveLabel, refine }) {
  const [m, setM] = useState(draft)
  const [corr, setCorr] = useState('')
  const [fixing, setFixing] = useState(false)
  const [fixNote, setFixNote] = useState('')
  const tot = totalsOf(m.items)
  const doRefine = async () => {
    const c = corr.trim()
    if (!c || !refine) return
    setFixing(true); setFixNote('')
    try {
      const r = await refine(c, m.items.map(cleanItem))
      if (!(r.items || []).length) { toast(t('Couldn’t apply that — try saying it another way')); setFixing(false); return }
      setM(x => ({ ...x, name: r.name || x.name, items: r.items.map(cleanItem), ai: true }))
      setFixNote(r.note || '')
      setCorr('')
      toast(t('Estimate updated'))
    } catch (e) { toast(aiErrorMessage(e)) }
    setFixing(false)
  }
  const setItem = (i, it) => setM(x => ({ ...x, items: x.items.map((o, j) => (j === i ? it : o)) }))
  const rmItem = i => setM(x => ({ ...x, items: x.items.filter((_, j) => j !== i) }))
  const addItem = () => setM(x => ({ ...x, items: [...x.items, { name: '', portion: '', grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0, _new: true }] }))
  const save = () => {
    const items = m.items.map(cleanItem).filter(i => i.name !== 'Food' || i.kcal > 0)
    if (!items.length) { toast(t('Add at least one food')); return }
    onSave({ ...m, name: (m.name || '').trim() || t(MEAL_TYPE_LABEL[m.type]), items })
    close()
  }
  const goalM = macroGoalOf(useStore.getState().S)
  const pct = k => goalM && goalM[k] ? Math.round((tot[k] || 0) / goalM[k] * 100) : null
  return <>
    {/* 1. The answer first: what this meal adds up to, against the day's targets. */}
    <div className="meal-hero">
      <div className="meal-kcal"><b>{fmtNum(tot.kcal)}</b><span>kcal{pct('kcal') !== null ? ' · ' + t('{0}% of your day', pct('kcal')) : ''}</span></div>
      <div className="meal-macros">
        <div><i style={{ background: 'var(--blue)' }} /><b>{fmtNum(tot.protein)} g</b><span>{t('Protein')}</span></div>
        <div><i style={{ background: 'var(--orange)' }} /><b>{fmtNum(tot.carbs)} g</b><span>{t('Carbs')}</span></div>
        <div><i style={{ background: 'var(--yellow)' }} /><b>{fmtNum(tot.fat)} g</b><span>{t('Fat')}</span></div>
      </div>
    </div>

    {/* 2. What we saw. Tap a food to change the portion; the numbers follow. */}
    <div className="row between" style={{ margin: '14px 0 6px' }}>
      <div className="eyebrow" style={{ margin: 0 }}>{t(m.items.length === 1 ? '{0} food' : '{0} foods', m.items.length)}</div>
      <span className="small dim">{t('Tap to adjust')}</span>
    </div>
    <div className="list" style={{ marginBottom: 10 }}>
      {m.items.map((it, i) => <ItemRow key={i} item={it} onChange={x => setItem(i, x)} onRemove={() => rmItem(i)} />)}
    </div>
    <Button size="sm" icon="plus" onClick={addItem}>{t('Add food manually')}</Button>

    {/* 3. Talk back to the estimate in one sentence. */}
    {refine && m.items.length > 0 && <div className="ncorr card" style={{ marginTop: 12 }}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}><Icon name="sparkles" style={{ color: 'var(--violet)' }} /><b>{t('Something off?')}</b></div>
      <div className="small muted" style={{ marginBottom: 8 }}>{t('Tell it in your own words and the numbers are redone.')}</div>
      <div className="row" style={{ gap: 8 }}>
        <TextField value={corr} onChange={e => setCorr(e.target.value)} placeholder={t('e.g. “it’s unsweetened Greek yoghurt, about 200 g”')}
          onKeyDown={e => { if (e.key === 'Enter') doRefine() }} disabled={fixing} />
        <Button size="sm" variant="tinted" icon={fixing ? undefined : 'sparkles'} disabled={!corr.trim() || fixing} onClick={doRefine} style={{ flex: 'none' }}>{fixing ? <span className="spin" /> : t('Fix')}</Button>
      </div>
      {fixNote && <div className="small dim" style={{ marginTop: 6 }}>{fixNote}</div>}
    </div>}

    {/* 4. Where it goes in the day: name, slot, time. */}
    <div className="eyebrow" style={{ margin: '16px 0 8px' }}>{t('Details')}</div>
    <TextField value={m.name} onChange={e => setM({ ...m, name: e.target.value })} placeholder={t('Meal name')} style={{ marginBottom: 10 }} />
    <Segmented className="seg-range" value={m.type} onChange={v => setM({ ...m, type: v })}
      options={MEAL_TYPES.map(k => ({ value: k, icon: MEAL_TYPE_ICON[k], label: t(MEAL_TYPE_LABEL[k]) }))} />
    <div className="row" style={{ gap: 8, margin: '10px 0 4px' }}>
      <span className="small muted">{fmtDate(m.d, true)}</span>
      <input className="input" type="time" value={m.t} onChange={e => setM({ ...m, t: e.target.value || m.t })} style={{ width: 'auto', marginLeft: 'auto', padding: '6px 10px' }} />
    </div>

    <div style={{ height: 14 }} />
    <Button variant="primary" icon="check" onClick={save}>{saveLabel || t('Save meal')}</Button>
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { onDelete(); close() }}>{t('Delete meal')}</Button></>}
    <div className="small dim" style={{ marginTop: 12, textAlign: 'center' }}>{t('Photo estimates are usually within ±20%. Tap a food to fix its portion.')}</div>
  </>
}

const newDraft = (iso, patch = {}) => {
  const tm = nowHHMM()
  return { id: uid(), d: iso || todayISO(), t: iso && iso !== todayISO() ? '12:00' : tm, type: guessMealType(iso && iso !== todayISO() ? '12:00' : tm), name: '', items: [], ai: false, ...patch }
}

/* ============================ AI: analyse a meal ============================ */

function AnalyzeMeal({ file, text, iso, type, close }) {
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const [photoUrl] = useState(() => (file ? URL.createObjectURL(file) : ''))
  const [enc, setEnc] = useState({ image: '', mediaType: '' })
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return   // StrictMode double-mounts in dev; one paid request is enough
    started.current = true
    ;(async () => {
      try {
        let image = '', mediaType = ''
        if (file) ({ base64: image, mediaType } = await fileToResizedBase64(file))
        setEnc({ image, mediaType })
        const r = await aiAnalyzeMeal({ image, mediaType, text, lang: getLang() })
        setRes(r)
      } catch (e) { setErr(aiErrorMessage(e)) }
      setBusy(false)
    })()
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }
  }, [])
  const none = res && (res.confidence === 'none' || !(res.items || []).length)
  return <>
    <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 10 }}>
      {photoUrl && <img src={photoUrl} alt="" style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'cover', flex: 'none' }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3 style={{ margin: 0 }}>{busy ? t('Reading your plate…') : res && !none ? (res.name || t('Your meal')) : t('Your meal')}</h3>
        <div className="small muted">{busy ? t('A few seconds') : text && !photoUrl ? '“' + text + '”' : res && !none ? t('Check the numbers, then save') : ''}</div>
      </div>
    </div>
    {busy && <div className="meal-skel"><div /><div /><div /></div>}
    {err && <><div className="small" style={{ color: 'var(--red)', marginBottom: 12 }}>{err}</div>
      <Button onClick={() => { close(); mealFormSheet(newDraft(iso)) }}>{t('Log it manually instead')}</Button></>}
    {none && <><div className="small dim" style={{ marginBottom: 12 }}>{res.note || t('Couldn’t find any food there — try a closer, well-lit shot, or describe the meal instead.')}</div>
      <Button onClick={() => { close(); describeMealSheet(iso) }}>{t('Describe it instead')}</Button></>}
    {res && !none && <>
      {res.confidence === 'low' && <div className="row small" style={{ gap: 6, color: 'var(--orange)', marginBottom: 8 }}><Icon name="info" style={{ fontSize: 14 }} />{t('Hard to see the portions — check them before saving.')}</div>}
      {res.note && <div className="small dim" style={{ marginBottom: 6 }}>{res.note}</div>}
      <MealForm close={close} saveLabel={t('Save meal')} onSave={saveMeal}
        refine={(correction, previous) => aiAnalyzeMeal({ ...enc, text, lang: getLang(), previous, correction })}
        draft={newDraft(iso, { name: res.name || '', items: (res.items || []).map(cleanItem), ai: true, ...(type ? { type } : {}) })} />
    </>}
  </>
}
export const analyzeMealSheet = (file, iso, text, type) => ui().openSheet(close => <AnalyzeMeal file={file} text={text} iso={iso} type={type} close={close} />)

// Text path: no camera at hand, or leftovers with a known recipe. A couple of lines is plenty.
function DescribeMeal({ iso, type, close }) {
  const [txt, setTxt] = useState('')
  const go = () => { const v = txt.trim(); if (!v) return; close(); analyzeMealSheet(null, iso, v, type) }
  return <>
    <h3>{t('Describe your meal')}</h3>
    <div className="small muted" style={{ marginBottom: 10 }}>{t('Quantities help: “2 scrambled eggs, 1 slice of toast with butter, a black coffee”.')}</div>
    <TextArea value={txt} onChange={e => setTxt(e.target.value)} placeholder={t('What did you eat?')} autoFocus />
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="sparkles" disabled={!txt.trim()} onClick={go}>{t('Estimate it')}</Button>
  </>
}
export const describeMealSheet = (iso, type) => ui().openSheet(close => <DescribeMeal iso={iso} type={type} close={close} />)

/* ============================ edit / manual ============================ */

function MealFormSheet({ meal, close }) {
  const existing = (useStore.getState().S.meals || []).some(m => m.id === meal.id)
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name={MEAL_TYPE_ICON[meal.type] || 'flame'} style={{ color: 'var(--orange)' }} />{existing ? t('Edit meal') : t('Log a meal')}</h3>
    <MealForm draft={meal} close={close} onSave={saveMeal} onDelete={existing ? () => { deleteMeal(meal.id); toast(t('Meal deleted')) } : null}
      refine={(correction, previous) => aiAnalyzeMeal({ text: meal.name, lang: getLang(), previous, correction })} />
  </>
}
export const mealFormSheet = meal => ui().openSheet(close => <MealFormSheet meal={meal} close={close} />)
export const manualMealSheet = (iso, type) => mealFormSheet(newDraft(iso, type ? { type } : {}))

// "+" on a meal slot: pick how to log breakfast / lunch / dinner / snack for that day.
function AddMeal({ iso, type, close }) {
  const camRef = useRef(null)
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name={MEAL_TYPE_ICON[type] || 'flame'} style={{ color: 'var(--orange)' }} />{t('Log {0}', t(MEAL_TYPE_LABEL[type] || 'Snack').toLowerCase())}</h3>
    <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { close(); analyzeMealSheet(f, iso, undefined, type) } }} />
    <div className="sect-b" style={{ marginBottom: 12 }}>
      <button className="lrow tap" onClick={() => camRef.current?.click()}><span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="camera" /></span><span className="lrow-m"><span className="lrow-t">{t('Take a photo')}</span><span className="lrow-s">{t('We read the foods and portions; you check before saving')}</span></span><Icon name="chevronRight" className="lrow-k" /></button>
      <button className="lrow tap" onClick={() => { close(); describeMealSheet(iso, type) }}><span className="lrow-i" style={{ '--tint': 'var(--violet)' }}><Icon name="pencil" /></span><span className="lrow-m"><span className="lrow-t">{t('Describe it')}</span><span className="lrow-s">{t('A sentence is enough')}</span></span><Icon name="chevronRight" className="lrow-k" /></button>
      <button className="lrow tap" onClick={() => { close(); manualMealSheet(iso, type) }}><span className="lrow-i" style={{ '--tint': 'var(--blue)' }}><Icon name="plus" /></span><span className="lrow-m"><span className="lrow-t">{t('Manual')}</span><span className="lrow-s">{t('Type the foods and numbers yourself')}</span></span><Icon name="chevronRight" className="lrow-k" /></button>
    </div>
  </>
}
export const addMealSheet = (iso, type) => ui().openSheet(close => <AddMeal iso={iso} type={type} close={close} />)

/* ============================ diet plan (from a nutritionist) ============================ */

// Tidy what the model read off the plan: short strings, no empty meals, at most a handful of
// options each. Numbers only when the plan stated them.
export function cleanPlanMenu(res) {
  const num = v => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : undefined)
  return (Array.isArray(res.meals) ? res.meals : []).slice(0, 8).map(m => ({
    name: String(m.name || '').trim().slice(0, 60) || t('Meal'),
    time: String(m.time || '').trim().slice(0, 30),
    options: (Array.isArray(m.options) ? m.options : []).slice(0, 6).map(o => ({
      title: String(o.title || '').trim().slice(0, 80) || t('Option'),
      items: (Array.isArray(o.items) ? o.items : []).map(x => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 20),
      kcal: num(o.kcal), protein: num(o.protein), carbs: num(o.carbs), fat: num(o.fat)
    })).filter(o => o.items.length || o.title)
  })).filter(m => m.options.length)
}
export const removeDietPlan = () => update(s => { delete s.dietPlan })

function OptionMacros({ o }) {
  if (!o.kcal) return null
  return <span className="dim small" style={{ whiteSpace: 'nowrap' }}>{fmtNum(o.kcal)} kcal{o.protein ? ' · P ' + fmtNum(o.protein) + 'g' : ''}</span>
}

// One meal of the plan: what the nutritionist wrote, option by option. From here the person
// logs an option as eaten today, or asks the AI for a different recipe with the same numbers.
function PlanMeal({ idx, close }) {
  const S = useStore(s => s.S)
  const plan = S.dietPlan
  const meal = plan && plan.meals[idx]
  if (!meal) return null
  const logOption = o => { close(); analyzeMealSheet(null, todayISO(), (o.title ? o.title + ': ' : '') + o.items.join(', ')) }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="utensils" style={{ color: 'var(--orange)' }} />{meal.name}{meal.time ? <span className="dim" style={{ fontWeight: 400, fontSize: 15 }}>· {meal.time}</span> : null}</h3>
    <div className="small muted" style={{ marginBottom: 12 }}>{t(meal.options.length === 1 ? 'What your plan says for this meal.' : 'Your plan gives {0} options for this meal — any of them works.', meal.options.length)}</div>
    {meal.options.map((o, i) => <div key={i} className="card" style={{ marginBottom: 10 }}>
      <div className="row between" style={{ gap: 8, marginBottom: 6 }}><b>{o.title}</b><OptionMacros o={o} /></div>
      <ul className="plan-items">{o.items.map((x, k) => <li key={k}>{x}</li>)}</ul>
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <Button size="sm" variant="tinted" icon="check" style={{ flex: 1 }} onClick={() => logOption(o)}>{t('I ate this')}</Button>
        <Button size="sm" icon="sparkles" style={{ flex: 1, color: 'var(--violet)' }} onClick={() => { close(); recipeSheet(idx) }}>{t('Other recipe')}</Button>
      </div>
    </div>)}
  </>
}
export const planMealSheet = idx => ui().openSheet(close => <PlanMeal idx={idx} close={close} />)

// AI recipes for one meal slot. Always three, always inside the plan's numbers and rules; the
// person can steer with a wish ("something with fish") and ask for three more.
function Recipes({ idx, close }) {
  const S = useStore.getState().S
  const plan = S.dietPlan
  const meal = plan && plan.meals[idx]
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const [open, setOpen] = useState(-1)
  const seen = useRef([])
  const started = useRef(false)
  const run = async () => {
    setBusy(true); setErr(''); setOpen(-1)
    try {
      const g = macroGoalOf(S)
      const r = await aiRecipes({ meal, targets: { kcal: g.kcal, protein: g.protein, carbs: g.carbs, fat: g.fat }, rules: plan.rules || [], lang: getLang(), wish: wish.trim(), avoid: seen.current, mealsPerDay: plan.meals.length })
      seen.current = [...seen.current, ...(r.recipes || []).map(x => x.title)].slice(-12)
      setRes(r)
    } catch (e) { setErr(aiErrorMessage(e)) }
    setBusy(false)
  }
  useEffect(() => { if (!started.current) { started.current = true; run() } }, [])
  if (!meal) return null
  const logRecipe = r => {
    const item = cleanItem({ name: r.title, portion: t('1 serving'), grams: 0, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat })
    saveMeal(newDraft(todayISO(), { name: r.title, items: [item], ai: true, recipe: { ingredients: r.ingredients, steps: r.steps } }))
    toast(t('Logged for today')); close()
  }
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="sparkles" style={{ color: 'var(--violet)' }} />{t('Recipes for {0}', meal.name.toLowerCase())}</h3>
    <div className="small muted" style={{ marginBottom: 10 }}>{t('Same calories and macros as your plan for this meal, and it follows your nutritionist’s rules.')}</div>
    <form className="coach-ask" style={{ marginTop: 0, marginBottom: 12 }} onSubmit={e => { e.preventDefault(); run() }}>
      <TextField value={wish} onChange={e => setWish(e.target.value)} placeholder={t('Any wish? e.g. “with fish”, “no cooking”')} disabled={busy} />
      <button type="submit" className="coach-send" disabled={busy} aria-label={t('Suggest')}><Icon name="sparkles" /></button>
    </form>
    {busy && <div className="row small dim" style={{ gap: 8, marginBottom: 10 }}><span className="spin" />{t('Cooking up ideas — a few seconds…')}</div>}
    {err && <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}
    {res && !busy && (res.recipes || []).map((r, i) => <div key={i} className="card" style={{ marginBottom: 10 }}>
      <button className="row" style={{ width: '100%', gap: 8, textAlign: 'left', alignItems: 'flex-start' }} onClick={() => setOpen(open === i ? -1 : i)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{r.title}</b>
          <div className="dim small" style={{ marginTop: 2 }}>{r.minutes} min · {fmtNum(r.kcal)} kcal · <MacroLine tot={r} dim /></div>
          <div className="small muted" style={{ marginTop: 4 }}>{r.why}</div>
        </div>
        <Icon name={open === i ? 'chevronUp' : 'chevronDown'} style={{ color: 'var(--label-3)', flex: 'none', marginTop: 4 }} />
      </button>
      {open === i && <div style={{ marginTop: 10 }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>{t('Ingredients')}</div>
        <ul className="plan-items">{(r.ingredients || []).map((x, k) => <li key={k}>{x}</li>)}</ul>
        <div className="eyebrow" style={{ margin: '10px 0 4px' }}>{t('Steps')}</div>
        <ol className="plan-items">{(r.steps || []).map((x, k) => <li key={k}>{x}</li>)}</ol>
        <Button size="sm" variant="tinted" icon="check" style={{ marginTop: 10 }} onClick={() => logRecipe(r)}>{t('I’ll make this — log it for today')}</Button>
      </div>}
    </div>)}
    {res && !busy && res.note && <div className="small dim" style={{ marginBottom: 8 }}>{res.note}</div>}
    {res && !busy && <Button icon="shuffle" onClick={run}>{t('Three more')}</Button>}
  </>
}
export const recipeSheet = idx => ui().openSheet(close => <Recipes idx={idx} close={close} />)

/* ============================ goals ============================ */

const PLAN_FIELDS = ['kcal', 'protein', 'carbs', 'fat', 'sugar', 'fiber', 'sodium']
const PLAN_UNIT = { kcal: 'kcal', protein: 'g', carbs: 'g', fat: 'g', sugar: 'g', fiber: 'g', sodium: 'mg' }
const PLAN_LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat', sugar: 'Sugar', fiber: 'Fibre', sodium: 'Sodium' }

// Photo or PDF of a diet plan -> the AI reads the daily numbers -> the person reviews them here
// before they replace the targets. Only fields the plan actually states are offered.
function ImportPlan({ file, onApply }) {
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    ;(async () => {
      try {
        const up = await readUpload(file, { maxDim: 1568 })
        const r = await aiImportPlan(up.kind === 'pdf' ? { pdf: up.base64, lang: getLang() } : { image: up.base64, mediaType: up.mediaType, lang: getLang() })
        setRes(r)
      } catch (e) { setErr(aiErrorMessage(e)) }
      setBusy(false)
    })()
  }, [])
  const found = res && res.found && PLAN_FIELDS.some(k => +res[k] > 0)
  const picked = found ? Object.fromEntries(PLAN_FIELDS.filter(k => +res[k] > 0).map(k => [k, Math.round(+res[k])])) : {}
  const menu = res ? cleanPlanMenu(res) : []
  const rules = res && Array.isArray(res.rules) ? res.rules.map(r => String(r).trim().slice(0, 160)).filter(Boolean).slice(0, 25) : []
  const plan = (menu.length || rules.length) ? { at: Date.now(), file: file.name, summary: res.summary || '', meals: menu, rules } : null
  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="row" style={{ gap: 8, marginBottom: 6 }}><Icon name="sparkles" style={{ color: 'var(--violet)' }} /><b>{t('From your plan')}</b><span className="dim small" style={{ marginLeft: 'auto' }}>{file.name}</span></div>
    {busy && <div className="row small dim" style={{ gap: 8 }}><span className="spin" />{t('Reading the plan — a few seconds…')}</div>}
    {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}
    {res && !found && <div className="small muted">{t('Couldn’t find daily targets in that file.')} {res.summary}</div>}
    {found && <>
      <div className="small muted" style={{ marginBottom: 6 }}>{res.summary}{res.note ? ' · ' + res.note : ''}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {Object.keys(picked).map(k => <span key={k} className="chip">{t(PLAN_LABEL[k])} <b>{fmtNum(picked[k])}</b> {PLAN_UNIT[k]}</span>)}
      </div>
      {plan && <div className="small muted" style={{ marginBottom: 10 }}>
        <Icon name="utensils" style={{ fontSize: 13, color: 'var(--orange)', marginRight: 5 }} />
        {t(menu.length === 1 ? '{0} meal in the menu' : '{0} meals in the menu', menu.length)}{rules.length ? ' · ' + t(rules.length === 1 ? '{0} rule' : '{0} rules', rules.length) : ''}
        {menu.length > 0 && <span className="dim"> — {menu.map(m => m.name).join(', ')}</span>}
      </div>}
      {res.confidence === 'low' && <div className="small dim" style={{ marginBottom: 8 }}>{t('Low confidence — check the numbers before applying.')}</div>}
      <Button variant="primary" size="sm" icon="check" onClick={() => onApply(picked, plan)}>{plan ? t('Save plan and targets') : t('Use these targets')}</Button>
    </>}
  </div>
}

function MacroGoal({ close }) {
  const S = useStore(s => s.S)
  const g = macroGoalOf(S)
  const set = patch => update(s => { s.macroGoal = { ...macroGoalOf(s), ...patch } })
  const fromMacros = Math.round(g.protein * 4 + g.carbs * 4 + g.fat * 9)
  const planInput = useRef(null)
  const [planFile, setPlanFile] = useState(null)
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="target" style={{ color: 'var(--yellow)' }} />{t('Daily targets')}</h3>
    <div style={{ margin: '2px 0 8px' }}><button className="linkbtn small" onClick={() => sourcesSheet(null)}>{t('Where do these numbers come from?')}</button></div>
    <button className="card tappable" style={{ width: '100%', textAlign: 'left', marginBottom: 12, padding: 14 }} onClick={() => { close(); goalWizardSheet() }}>
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <span className="lrow-i" style={{ '--tint': 'var(--yellow)', color: '#000', width: 40, height: 40, borderRadius: 12 }}><Icon name="bolt" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{S.nutriGoal ? t('Recalculate my calories') : t('How many calories do I need?')}</div>
          <div className="dim small">{S.nutriGoal ? t('{0}: {1} kcal · set {2}', t(GOAL_LABEL[S.nutriGoal.goal] || 'Lose fat'), fmtNum(S.nutriGoal.kcal), fmtDate(new Date(S.nutriGoal.at).toISOString().slice(0, 10), true)) : t('Lose fat, maintain or gain muscle — worked out from your body and activity, with safe limits.')}</div>
        </div>
        <Icon name="chevronRight" className="dim" />
      </div>
    </button>
    {S.nutriGoal && <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 12 }}><Icon name="shield" style={{ fontSize: 12, marginRight: 5, color: 'var(--yellow)' }} />{t(DISCLAIMER)}</div>}
    <input ref={planInput} type="file" accept={UPLOAD_ACCEPT} style={{ display: 'none' }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPlanFile(f) }} />
    {!planFile && <div style={{ marginBottom: 12 }}>
      <Button size="sm" icon="upload" style={{ color: 'var(--violet)' }} onClick={() => planInput.current?.click()}>{t('Import from a diet plan (photo or PDF)')}</Button>
      <div className="small dim" style={{ marginTop: 4 }}>{t('Got a plan from a nutritionist? Snap it or upload the PDF and the targets fill themselves in.')}</div>
    </div>}
    {planFile && <ImportPlan key={planFile.name + planFile.size} file={planFile} onApply={(p, plan) => {
      set(p); if (plan) update(s => { s.dietPlan = plan }); setPlanFile(null)
      toast(plan ? t('Plan saved — find it in Nutrition') : t('Targets updated from your plan'))
    }} />}
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Calories (kcal)')} value={g.kcal} step={50} decimal={false} onChange={v => set({ kcal: Math.max(0, v) })} />
    </div>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Protein (g)')} value={g.protein} step={5} decimal={false} onChange={v => set({ protein: Math.max(0, v) })} />
      <Stepper label={t('Carbs (g)')} value={g.carbs} step={5} decimal={false} onChange={v => set({ carbs: Math.max(0, v) })} />
      <Stepper label={t('Fat (g)')} value={g.fat} step={5} decimal={false} onChange={v => set({ fat: Math.max(0, v) })} />
    </div>
    <h4 className="sec" style={{ marginTop: 6 }}>{t('Also keep an eye on')}</h4>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Sugar (g) · max')} value={g.sugar} step={5} decimal={false} onChange={v => set({ sugar: Math.max(0, v) })} />
      <Stepper label={t('Fibre (g) · min')} value={g.fiber} step={5} decimal={false} onChange={v => set({ fiber: Math.max(0, v) })} />
      <Stepper label={t('Sodium (mg) · max')} value={g.sodium} step={100} decimal={false} onChange={v => set({ sodium: Math.max(0, v) })} />
    </div>
    <div className="small dim" style={{ marginBottom: 6 }}>{t('Your macros add up to {0} kcal.', fmtNum(fromMacros))}{Math.abs(fromMacros - g.kcal) > 150 ? ' ' + t('That’s a fair way from your calorie target — one of them is probably off.') : ''}</div>
    <div className="small dim" style={{ marginBottom: 14 }}>{t('A common starting point: 1.6–2.2 g protein per kg of body weight, 20–35% of calories from fat, the rest carbs.')}</div>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const macroGoalSheet = () => ui().openSheet(close => <MacroGoal close={close} />)

/* ============================ month calendar ============================ */

function NutritionCalendar({ start, onPick, close }) {
  const S = useStore(s => s.S)
  const goal = macroGoalOf(S).kcal
  const by = kcalByDay(S)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start + 'T12:00:00') : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const startOffset = (new Date(y, mo, 1).getDay() + 6) % 7
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const prefix = y + '-' + String(mo + 1).padStart(2, '0')
  const logged = Object.keys(by).filter(k => k.startsWith(prefix))
  const avg = logged.length ? Math.round(logged.reduce((a, k) => a + by[k], 0) / logged.length) : 0
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = prefix + '-' + String(d).padStart(2, '0')
    const k = by[iso]
    const lvl = !k ? '' : k > goal * 1.1 ? ' over' : k >= goal * 0.9 ? ' hit' : ' under'
    cells.push(<button key={d} className={'cal-d ncal' + (k ? ' has' + lvl : '') + (iso === todayISO() ? ' today' : '')}
      onClick={() => { close(); onPick(iso) }}>
      <span>{d}</span><small>{k ? Math.round(k / 100) / 10 + 'k' : ''}</small>
    </button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label="Previous month"><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label="Next month"><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{logged.length ? t('{0} days logged · avg {1} kcal', logged.length, fmtNum(avg)) : t('Nothing logged this month')}</div>
    <div className="cal-grid">{['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(l => <div key={l} className="cal-h">{t(l)}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('On target')}</span>
      <span><i style={{ background: 'var(--blue)' }} />{t('Under')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Over')}</span>
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{t('Within ±10% of your calorie target counts as on target · tap a day to open it')}</div>
  </>
}
export const nutritionCalendarSheet = (start, onPick) => ui().openSheet(close => <NutritionCalendar start={start} onPick={onPick} close={close} />)

/* ============================ day summary widget ============================ */

// Sugar / fibre / sodium as three small tiles. Tinted only when they cross the line: sugar
// and sodium turn orange when over, fibre turns green when reached — the rest stays neutral
// so the macro bars above keep the attention.
export function MicroLine({ tot, goal }) {
  const label = { sugar: t('Sugar'), fiber: t('Fibre'), sodium: t('Sodium') }
  return <div className="micros">
    {MICROS.map(k => {
      const v = +tot[k] || 0, g = +goal[k] || 0, ceil = MICRO_IS_CEILING[k]
      const over = ceil && g && v > g, hit = !ceil && g && v >= g
      const col = over ? 'var(--orange)' : hit ? 'var(--acc)' : ''
      return <div key={k} className="micro" style={col ? { color: col } : null}>
        <span className="ml">{label[k]}</span>
        <span className="mv">{fmtNum(v)}<span className="dim"> / {fmtNum(g)} {MICRO_UNIT[k]}</span></span>
        <span className="mb"><i style={{ width: pctOf(v, g) + '%', background: col || 'var(--label-3)' }} /></span>
      </div>
    })}
  </div>
}

// Shared by Home and the Nutrition view: calories vs goal + the three macros. The full version
// is a ring you can read from across the room plus three tiles; `compact` keeps the bars.
export function DaySummary({ tot, goal, compact }) {
  const rows = [
    { k: 'protein', l: t('Protein'), c: 'var(--blue)', hint: t('Muscle') },
    { k: 'carbs', l: t('Carbs'), c: 'var(--orange)', hint: t('Energy') },
    { k: 'fat', l: t('Fat'), c: 'var(--yellow)', hint: t('Hormones') }
  ]
  const kp = pctOf(tot.kcal, goal.kcal)
  const over = tot.kcal > goal.kcal * 1.1
  const left = goal.kcal - tot.kcal
  if (compact) return <>
    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
      <div className="big">{fmtNum(tot.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>/ {fmtNum(goal.kcal)} kcal</span></div>
      <span className="small dim" style={{ marginLeft: 'auto' }}>{tot.kcal >= goal.kcal ? (over ? t('over by {0}', fmtNum(tot.kcal - goal.kcal)) : t('target reached')) : t('{0} left', fmtNum(left))}</span>
    </div>
    <div className="wprog" style={{ margin: '8px 0 12px' }}><i style={{ width: kp + '%', background: over ? 'var(--orange)' : 'var(--acc)' }} /></div>
    <div className="macros compact">
      {rows.map(r => <div key={r.k} className="mrow">
        <span className="ml">{r.l}</span>
        <span className="mv">{fmtNum(tot[r.k])}<span className="dim"> / {fmtNum(goal[r.k])} g</span></span>
        <span className="mb"><i style={{ width: pctOf(tot[r.k], goal[r.k]) + '%', background: r.c }} /></span>
      </div>)}
    </div>
  </>
  return <>
    <div className="row" style={{ gap: 16, alignItems: 'center' }}>
      <Ring pct={kp} size={116} stroke={11} color={over ? 'var(--orange)' : 'var(--acc)'}>
        <div style={{ textAlign: 'center', lineHeight: 1.05 }}><div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>{fmtNum(tot.kcal)}</div><div className="dim" style={{ fontSize: 11, fontWeight: 600 }}>kcal</div></div>
      </Ring>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{tot.kcal === 0 ? t('Nothing eaten yet') : over ? t('{0} kcal over your goal', fmtNum(tot.kcal - goal.kcal)) : left > 0 ? t('{0} kcal to go', fmtNum(left)) : t('Goal reached')}</div>
        <div className="dim small" style={{ marginTop: 3 }}>{t('Goal: {0} kcal a day', fmtNum(goal.kcal))}</div>
        {tot.kcal === 0 && <div className="small" style={{ color: 'var(--acc)', marginTop: 6 }}>{t('Snap your first meal below')}</div>}
      </div>
    </div>
    <div className="macro-tiles">
      {rows.map(r => { const p = pctOf(tot[r.k], goal[r.k]); return <div key={r.k} className="macro-tile">
        <Ring pct={p} size={46} stroke={5} color={r.c}><span style={{ fontSize: 11 }}>{p}%</span></Ring>
        <div className="mt-l">{r.l}</div>
        <div className="mt-v"><b>{fmtNum(tot[r.k])}</b> / {fmtNum(goal[r.k])} g</div>
      </div> })}
    </div>
    <details className="adv" style={{ margin: '6px 0 0' }}><summary className="small muted">{t('More detail: sugar, fibre and sodium')}</summary><MicroLine tot={tot} goal={goal} /></details>
  </>
}
