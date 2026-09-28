// Meal-log sheets: analyse a photo / description with AI, review + edit the itemised estimate,
// edit a saved meal, set macro goals, and the month calendar. Kept apart from sheets.jsx so the
// nutrition feature is one module to read (lib/nutrition.js has the pure maths).
import { useEffect, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { fmtDate, fmtNum, todayISO, uid, MONTHS_LONG } from './lib/format.js'
import { t, getLang } from './lib/i18n.js'
import { aiAnalyzeMeal, fileToResizedBase64 } from './lib/api.js'
import {
  MEAL_TYPES, MEAL_TYPE_LABEL, MEAL_TYPE_ICON, macroGoalOf, cleanItem, scaleItem, totalsOf,
  guessMealType, nowHHMM, kcalByDay, pctOf
} from './lib/nutrition.js'
import Icon from './components/Icon.jsx'
import { Button, Segmented, TextField, TextArea, Stepper } from './components/ui.jsx'

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
  const [open, setOpen] = useState(false)
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
      <TextField value={item.name} onChange={e => onChange({ ...item, name: e.target.value })} placeholder={t('Food')} />
      <div className="row cfgrow">
        <Stepper label={t('Portion (g)')} value={item.grams} step={10} decimal={false} onChange={g => onChange(scaleItem(item, g))} />
        <Stepper label="kcal" value={item.kcal} step={10} decimal={false} onChange={v => onChange({ ...item, kcal: v })} />
      </div>
      <div className="row cfgrow">
        <Stepper label={t('Protein (g)')} value={item.protein} step={1} onChange={v => onChange({ ...item, protein: v })} />
        <Stepper label={t('Carbs (g)')} value={item.carbs} step={1} onChange={v => onChange({ ...item, carbs: v })} />
        <Stepper label={t('Fat (g)')} value={item.fat} step={1} onChange={v => onChange({ ...item, fat: v })} />
      </div>
      <div className="small dim">{t('Changing the portion rescales calories and macros proportionally.')}</div>
      <Button size="sm" variant="danger" icon="trash" onClick={onRemove}>{t('Remove item')}</Button>
    </div>}
  </div>
}

// The editable meal: name, slot, time, items with per-item edit, totals. Used for a fresh AI
// result and for an existing meal alike — `meal` is the draft, `onSave` receives the final one.
function MealForm({ draft, onSave, onDelete, close, saveLabel }) {
  const [m, setM] = useState(draft)
  const tot = totalsOf(m.items)
  const setItem = (i, it) => setM(x => ({ ...x, items: x.items.map((o, j) => (j === i ? it : o)) }))
  const rmItem = i => setM(x => ({ ...x, items: x.items.filter((_, j) => j !== i) }))
  const addItem = () => setM(x => ({ ...x, items: [...x.items, { name: '', portion: '', grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0, _new: true }] }))
  const save = () => {
    const items = m.items.map(cleanItem).filter(i => i.name !== 'Food' || i.kcal > 0)
    if (!items.length) { toast(t('Add at least one food')); return }
    onSave({ ...m, name: (m.name || '').trim() || t(MEAL_TYPE_LABEL[m.type]), items })
    close()
  }
  return <>
    <TextField value={m.name} onChange={e => setM({ ...m, name: e.target.value })} placeholder={t('Meal name')} style={{ marginBottom: 10 }} />
    <Segmented className="seg-range" value={m.type} onChange={v => setM({ ...m, type: v })}
      options={MEAL_TYPES.map(k => ({ value: k, icon: MEAL_TYPE_ICON[k], label: t(MEAL_TYPE_LABEL[k]) }))} />
    <div className="row" style={{ gap: 8, marginBottom: 14 }}>
      <span className="small muted">{fmtDate(m.d, true)}</span>
      <input className="input" type="time" value={m.t} onChange={e => setM({ ...m, t: e.target.value || m.t })} style={{ width: 'auto', marginLeft: 'auto', padding: '6px 10px' }} />
    </div>

    <div className="ntot">
      <div className="big">{fmtNum(tot.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
      <MacroLine tot={tot} />
    </div>

    <div className="list" style={{ marginBottom: 10 }}>
      {m.items.map((it, i) => <ItemRow key={i} item={it} onChange={x => setItem(i, x)} onRemove={() => rmItem(i)} />)}
    </div>
    <Button size="sm" icon="plus" onClick={addItem}>{t('Add food manually')}</Button>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{saveLabel || t('Save meal')}</Button>
    {onDelete && <><div style={{ height: 8 }} /><Button variant="danger" icon="trash" onClick={() => { onDelete(); close() }}>{t('Delete meal')}</Button></>}
    <div className="small dim" style={{ marginTop: 12, textAlign: 'center' }}>{t('Estimates from a photo are typically within ±20% — tap an item to correct the portion.')}</div>
  </>
}

const newDraft = (iso, patch = {}) => {
  const tm = nowHHMM()
  return { id: uid(), d: iso || todayISO(), t: iso && iso !== todayISO() ? '12:00' : tm, type: guessMealType(iso && iso !== todayISO() ? '12:00' : tm), name: '', items: [], ai: false, ...patch }
}

/* ============================ AI: analyse a meal ============================ */

function AnalyzeMeal({ file, text, iso, close }) {
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [res, setRes] = useState(null)
  const [photoUrl] = useState(() => (file ? URL.createObjectURL(file) : ''))
  useEffect(() => {
    (async () => {
      try {
        let image = '', mediaType = ''
        if (file) ({ base64: image, mediaType } = await fileToResizedBase64(file))
        const r = await aiAnalyzeMeal({ image, mediaType, text, lang: getLang() })
        setRes(r)
      } catch (e) { setErr(e.message || t('AI request failed')) }
      setBusy(false)
    })()
    return () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }
  }, [])
  const none = res && (res.confidence === 'none' || !(res.items || []).length)
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="sparkles" style={{ color: 'var(--violet)' }} />{t('Analyse meal')}</h3>
    {photoUrl && <img src={photoUrl} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 12, maxHeight: 200, objectFit: 'cover' }} />}
    {text && !photoUrl && <div className="small muted" style={{ marginBottom: 12, fontStyle: 'italic' }}>“{text}”</div>}
    {busy && <div className="row small dim" style={{ gap: 8 }}><span className="spin" />{t('Reading the plate — a few seconds…')}</div>}
    {err && <><div className="small" style={{ color: 'var(--red)', marginBottom: 12 }}>{err}</div>
      <Button onClick={() => { close(); mealFormSheet(newDraft(iso)) }}>{t('Log it manually instead')}</Button></>}
    {none && <><div className="small dim" style={{ marginBottom: 12 }}>{res.note || t('Couldn’t find any food there — try a closer, well-lit shot, or describe the meal instead.')}</div>
      <Button onClick={() => { close(); describeMealSheet(iso) }}>{t('Describe it instead')}</Button></>}
    {res && !none && <>
      {res.note && <div className="small dim" style={{ marginBottom: 6 }}>{res.note}</div>}
      {res.confidence === 'low' && <div className="small" style={{ color: 'var(--orange)', marginBottom: 8 }}>{t('Low confidence — check the portions before saving.')}</div>}
      <MealForm close={close} saveLabel={t('Save meal')} onSave={saveMeal}
        draft={newDraft(iso, { name: res.name || '', items: (res.items || []).map(cleanItem), ai: true })} />
    </>}
  </>
}
export const analyzeMealSheet = (file, iso, text) => ui().openSheet(close => <AnalyzeMeal file={file} text={text} iso={iso} close={close} />)

// Text path: no camera at hand, or leftovers with a known recipe. A couple of lines is plenty.
function DescribeMeal({ iso, close }) {
  const [txt, setTxt] = useState('')
  const go = () => { const v = txt.trim(); if (!v) return; close(); analyzeMealSheet(null, iso, v) }
  return <>
    <h3>{t('Describe your meal')}</h3>
    <div className="small muted" style={{ marginBottom: 10 }}>{t('Quantities help: “2 scrambled eggs, 1 slice of toast with butter, a black coffee”.')}</div>
    <TextArea value={txt} onChange={e => setTxt(e.target.value)} placeholder={t('What did you eat?')} autoFocus />
    <div style={{ height: 12 }} />
    <Button variant="primary" icon="sparkles" disabled={!txt.trim()} onClick={go}>{t('Estimate with AI')}</Button>
  </>
}
export const describeMealSheet = iso => ui().openSheet(close => <DescribeMeal iso={iso} close={close} />)

/* ============================ edit / manual ============================ */

function MealFormSheet({ meal, close }) {
  const existing = (useStore.getState().S.meals || []).some(m => m.id === meal.id)
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name={MEAL_TYPE_ICON[meal.type] || 'flame'} style={{ color: 'var(--orange)' }} />{existing ? t('Edit meal') : t('Log a meal')}</h3>
    <MealForm draft={meal} close={close} onSave={saveMeal} onDelete={existing ? () => { deleteMeal(meal.id); toast(t('Meal deleted')) } : null} />
  </>
}
export const mealFormSheet = meal => ui().openSheet(close => <MealFormSheet meal={meal} close={close} />)
export const manualMealSheet = iso => mealFormSheet(newDraft(iso))

/* ============================ goals ============================ */

function MacroGoal({ close }) {
  const S = useStore(s => s.S)
  const g = macroGoalOf(S)
  const set = patch => update(s => { s.macroGoal = { ...macroGoalOf(s), ...patch } })
  const fromMacros = Math.round(g.protein * 4 + g.carbs * 4 + g.fat * 9)
  return <>
    <h3 className="row" style={{ gap: 8 }}><Icon name="target" style={{ color: 'var(--yellow)' }} />{t('Daily targets')}</h3>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Calories (kcal)')} value={g.kcal} step={50} decimal={false} onChange={v => set({ kcal: Math.max(0, v) })} />
    </div>
    <div className="row cfgrow" style={{ marginBottom: 8 }}>
      <Stepper label={t('Protein (g)')} value={g.protein} step={5} decimal={false} onChange={v => set({ protein: Math.max(0, v) })} />
      <Stepper label={t('Carbs (g)')} value={g.carbs} step={5} decimal={false} onChange={v => set({ carbs: Math.max(0, v) })} />
      <Stepper label={t('Fat (g)')} value={g.fat} step={5} decimal={false} onChange={v => set({ fat: Math.max(0, v) })} />
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

// Shared by Home and the Nutrition view: calories vs goal + the three macro bars.
export function DaySummary({ tot, goal, compact }) {
  const rows = [
    { k: 'protein', l: t('Protein'), c: 'var(--blue)' },
    { k: 'carbs', l: t('Carbs'), c: 'var(--orange)' },
    { k: 'fat', l: t('Fat'), c: 'var(--yellow)' }
  ]
  const kp = pctOf(tot.kcal, goal.kcal)
  const over = tot.kcal > goal.kcal * 1.1
  return <>
    <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
      <div className="big">{fmtNum(tot.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>/ {fmtNum(goal.kcal)} kcal</span></div>
      <span className="small dim" style={{ marginLeft: 'auto' }}>{tot.kcal >= goal.kcal ? (over ? t('over by {0}', fmtNum(tot.kcal - goal.kcal)) : t('target reached')) : t('{0} left', fmtNum(goal.kcal - tot.kcal))}</span>
    </div>
    <div className="wprog" style={{ margin: '8px 0 12px' }}><i style={{ width: kp + '%', background: over ? 'var(--orange)' : 'var(--acc)' }} /></div>
    <div className={'macros' + (compact ? ' compact' : '')}>
      {rows.map(r => <div key={r.k} className="mrow">
        <span className="ml">{r.l}</span>
        <span className="mv">{fmtNum(tot[r.k])}<span className="dim"> / {fmtNum(goal[r.k])} g</span></span>
        <span className="mb"><i style={{ width: pctOf(tot[r.k], goal[r.k]) + '%', background: r.c }} /></span>
      </div>)}
    </div>
  </>
}
