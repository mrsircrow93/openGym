import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtNum, fmtDate, todayISO, isoOf, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { macroGoalOf, mealsOn, dayTotals, totalsOf, kcalByDay, avgLogged, MEAL_TYPE_ICON, MEAL_TYPE_LABEL } from '../lib/nutrition.js'
import { analyzeMealSheet, describeMealSheet, manualMealSheet, mealFormSheet, macroGoalSheet, nutritionCalendarSheet, DaySummary, MacroLine } from '../sheets-nutrition.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Meal log for one day at a time: pick the day on the week strip (or the calendar), see how
// the day stacks up against the targets, and add meals by photo, by description or by hand.
export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [iso, setIso] = useState(todayISO())
  const [weekOffset, setWeekOffset] = useState(0)
  const photoInput = useRef(null)

  const goal = macroGoalOf(S)
  const meals = mealsOn(S, iso)
  const tot = dayTotals(S, iso)
  const by = kcalByDay(S)
  const avg = avgLogged(S, 7)
  const isToday = iso === todayISO()

  const today = new Date()
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i)
    const k = isoOf(d), kc = by[k]
    const dot = !kc ? '' : kc > goal.kcal * 1.1 ? ' ovr' : kc >= goal.kcal * 0.9 ? ' done' : ' plan'
    strip.push(<button key={i} className={'wday' + (k === iso ? ' today' : '')} onClick={() => setIso(k)}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></button>)
  }
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`
  const pickDay = k => {
    setIso(k)
    const d = new Date(k + 'T12:00:00'), mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7)); mon.setHours(0, 0, 0, 0)
    setWeekOffset(Math.floor((d - mon) / (7 * 86400000)))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('Nutrition')}</h1>
        <div className="sub">{isToday ? t('Today') + ' · ' : ''}{new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nutritionCalendarSheet(iso, pickDay)} aria-label={t('Calendar')}><Icon name="calendar" /></button>
    </div>

    <input ref={photoInput} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) analyzeMealSheet(f, iso) }} />

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label="Previous week"><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label="Next week"><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Daily intake')}</h2>
        <Button size="sm" icon="target" style={{ color: 'var(--yellow)' }} onClick={macroGoalSheet}>{t('Targets')}</Button>
      </div>
      <DaySummary tot={tot} goal={goal} />
    </div>

    <div className="card">
      <Button variant="primary" icon="camera" onClick={() => photoInput.current?.click()}>{t('Snap a photo of your meal')}</Button>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <Button style={{ flex: 1 }} icon="pencil" onClick={() => describeMealSheet(iso)}>{t('Describe it')}</Button>
        <Button style={{ flex: 1 }} icon="plus" onClick={() => manualMealSheet(iso)}>{t('Manual')}</Button>
      </div>
      <div className="small dim" style={{ marginTop: 10, textAlign: 'center' }}>{t('AI reads the foods and portions off the photo — you review the numbers before anything is saved.')}</div>
    </div>

    <h4 className="sec">{meals.length ? t(meals.length === 1 ? '{0} meal' : '{0} meals', meals.length) : t('Meals')}</h4>
    {meals.length ? <div className="list" style={{ marginBottom: 16 }}>
      {meals.map(m => { const mt = totalsOf(m.items); return <div key={m.id} className="item" onClick={() => mealFormSheet(m)}>
        <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 18, background: 'var(--orange)' }}><Icon name={MEAL_TYPE_ICON[m.type] || 'flame'} /></span>
        <div className="grow">
          <div className="tt">{m.name}</div>
          <div className="ss">{[m.t, t(MEAL_TYPE_LABEL[m.type] || 'Snack'), (m.items || []).map(i => i.name).slice(0, 3).join(', ') + ((m.items || []).length > 3 ? '…' : '')].filter(Boolean).join(' · ')}</div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="tt">{fmtNum(mt.kcal)} <span className="dim small">kcal</span></div>
          <MacroLine tot={mt} dim />
        </div>
        <Icon name="chevronRight" className="chev" />
      </div> })}
    </div> : <div className="empty" style={{ padding: '24px 20px' }}><div className="ico"><Icon name="utensils" /></div>{isToday ? t('Nothing logged yet today — snap your next meal.') : t('Nothing logged on {0}.', fmtDate(iso, true))}</div>}

    {avg && <div className="card">
      <h2>{t('Last {0} logged days · daily average', avg.days)}</h2>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <div className="big">{fmtNum(avg.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
        <span className="small dim" style={{ marginLeft: 'auto' }}>{avg.kcal > goal.kcal ? t('{0} over target', fmtNum(avg.kcal - goal.kcal)) : t('{0} under target', fmtNum(goal.kcal - avg.kcal))}</span>
      </div>
      <div style={{ marginTop: 4 }}><MacroLine tot={avg} /></div>
    </div>}
  </div>
}
