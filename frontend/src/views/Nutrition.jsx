import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { fmtNum, fmtDate, todayISO, isoOf, DAYS } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { lastBW } from '../lib/history.js'
import { macroGoalOf, mealsOn, dayTotals, totalsOf, kcalByDay, MEAL_TYPE_ICON, MEAL_TYPE_LABEL, MEAL_TYPES } from '../lib/nutrition.js'
import { SupplementsCard } from '../sheets-supplements.jsx'
import { analyzeMealSheet, describeMealSheet, manualMealSheet, mealFormSheet, addMealSheet, macroGoalSheet, nutritionCalendarSheet, planMealSheet, recipeSheet, removeDietPlan, DaySummary, MacroLine, MicroLine } from '../sheets-nutrition.jsx'
import { goalWizardSheet, sourcesSheet } from '../sheets-goal.jsx'
import { reviewDue, toKg } from '../lib/nutrition-goal.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import Ring from '../components/Ring.jsx'
import StreakCard from '../components/StreakCard.jsx'
import { computeBadges, mealStreak } from '../lib/badges.js'
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

    <StreakCard title={t('Nutrition streak')} unitWord="{0} days" streak={mealStreak(S)} badges={computeBadges(S).filter(b => b.cat === 'nutrition')} color="var(--orange)" />

    {S.nutriGoal && reviewDue(S.nutriGoal, lastBW(S) ? toKg(lastBW(S).w, S.unit || 'kg') : null) && <button className="card tappable banner" style={{ width: '100%', textAlign: 'left' }} onClick={goalWizardSheet}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Icon name="target" style={{ color: 'var(--yellow)', fontSize: 20 }} />
        <div style={{ flex: 1, minWidth: 0 }}><b>{t('Time to review your calorie goal')}</b><div className="dim small">{t('Four weeks passed or your weight moved — what you burn has changed too. Takes a minute.')}</div></div>
        <Icon name="chevronRight" className="dim" />
      </div>
    </button>}
    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Daily intake')}</h2>
        <Button size="sm" icon="target" style={{ color: 'var(--yellow)' }} onClick={macroGoalSheet}>{t('Targets')}</Button>
      </div>
      <DaySummary tot={tot} goal={goal} />
      <MicroLine tot={tot} goal={goal} />
      {/* guideline 1.4.1: the sources behind these targets are one tap away from the targets */}
      <div style={{ marginTop: 8 }}><button className="linkbtn small" onClick={() => sourcesSheet(null)}>{t('Where do these numbers come from?')}</button></div>
    </div>

    <div className="card">
      <Button variant="primary" icon="camera" onClick={() => photoInput.current?.click()}>{t('Snap a photo of your meal')}</Button>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <Button style={{ flex: 1 }} icon="pencil" onClick={() => describeMealSheet(iso)}>{t('Describe it')}</Button>
        <Button style={{ flex: 1 }} icon="plus" onClick={() => manualMealSheet(iso)}>{t('Manual')}</Button>
      </div>
      <div className="small dim" style={{ marginTop: 10, textAlign: 'center' }}>{t('We read the foods and portions off the photo — you check the numbers before anything is saved.')}</div>
    </div>


    {S.dietPlan ? <div className="card">
      <div className="row between" style={{ marginBottom: 2 }}>
        <h2 style={{ margin: 0 }}>{t('My diet plan')}</h2>
        <Button size="xs" icon="upload" onClick={macroGoalSheet}>{t('Replace')}</Button>
      </div>
      <div className="small muted" style={{ marginBottom: 10 }}>{S.dietPlan.summary || S.dietPlan.file}{S.dietPlan.rules?.length ? ' · ' + t(S.dietPlan.rules.length === 1 ? '{0} rule' : '{0} rules', S.dietPlan.rules.length) : ''}</div>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {S.dietPlan.meals.map((m, i) => <div key={i} className="item" onClick={() => planMealSheet(i)}>
          <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 18, background: 'var(--teal)', color: '#0d211c' }}><Icon name="utensils" /></span>
          <div className="grow">
            <div className="tt">{m.name}{m.time ? <span className="dim small" style={{ fontWeight: 400 }}> · {m.time}</span> : null}</div>
            <div className="ss">{m.options.length > 1 ? t('{0} options', m.options.length) + ' · ' : ''}{m.options[0].title}</div>
          </div>
          <button className="iconbtn" style={{ width: 32, height: 32, fontSize: 15, color: 'var(--violet)' }} aria-label={t('Other recipe')} onClick={e => { e.stopPropagation(); recipeSheet(i) }}><Icon name="sparkles" /></button>
          <Icon name="chevronRight" className="chev" />
        </div>)}
      </div>
      {S.dietPlan.rules?.length > 0 && <details className="plan-rules"><summary className="small muted">{t('Rules from your nutritionist')}</summary>
        <ul className="plan-items small">{S.dietPlan.rules.map((r, i) => <li key={i}>{r}</li>)}</ul></details>}
      <div className="small dim" style={{ marginTop: 8 }}>{t('Tap a meal to see it, or the sparkle for a different recipe with the same numbers.')} <button className="linkbtn" onClick={() => confirmSheet({ title: t('Remove this plan?'), message: t('Your targets stay as they are.'), confirmText: t('Remove'), danger: true, onConfirm: removeDietPlan })}>{t('Remove plan')}</button></div>
    </div> : <div className="card">
      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <span className="lrow-i" style={{ width: 40, height: 40, borderRadius: 12, fontSize: 20, background: 'var(--teal)', color: '#0d211c' }}><Icon name="clipboard" /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{t('Got a plan from a nutritionist?')}</div>
          <div className="dim small">{t('Upload it: targets, menu and rules load in, and you get recipes that fit it.')}</div>
        </div>
        <Button size="sm" variant="tinted" icon="upload" onClick={macroGoalSheet}>{t('Upload')}</Button>
      </div>
    </div>}

    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="eyebrow">{t('Meals')}</div>
        <span className="small dim">{meals.length ? t(meals.length === 1 ? '{0} logged' : '{0} logged', meals.length) : (isToday ? t('Nothing yet') : '')}</span>
      </div>
      <div className="slots">
        {MEAL_TYPES.map(k => { const ms = meals.filter(m => m.type === k); const kc = ms.reduce((a, m) => a + totalsOf(m.items).kcal, 0); const share = { breakfast: .25, lunch: .35, dinner: .3, snack: .1 }[k]
          return <button key={k} className="slot" onClick={() => ms.length ? mealFormSheet(ms[ms.length - 1]) : addMealSheet(iso, k)}>
            <Ring pct={goal.kcal ? kc / (goal.kcal * share) * 100 : 0} size={60} stroke={6} color="var(--orange)">
              {ms.length ? <Icon name={MEAL_TYPE_ICON[k]} style={{ fontSize: 20, color: 'var(--orange)' }} /> : <span className="slot-plus"><Icon name="plus" /></span>}
            </Ring>
            <span className="slot-n">{t(MEAL_TYPE_LABEL[k])}</span>
            <span className="slot-k">{ms.length ? fmtNum(Math.round(kc)) + ' kcal' : t('Add')}</span>
          </button> })}
      </div>
      {meals.length > 0 && <div className="list" style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
        {MEAL_TYPES.filter(k => meals.some(m => m.type === k)).map(k => <div key={k}>
          <div className="row between" style={{ margin: '6px 2px 4px' }}><span className="small muted" style={{ fontWeight: 600 }}>{t(MEAL_TYPE_LABEL[k])}</span><button className="linkbtn small" onClick={() => addMealSheet(iso, k)}>{t('+ Add more')}</button></div>
          {meals.filter(m => m.type === k).map(m => { const mt = totalsOf(m.items); return <div key={m.id} className="item" onClick={() => mealFormSheet(m)}>
            <div className="grow">
              <div className="tt">{m.name}</div>
              <div className="ss">{[m.t, (m.items || []).map(i => i.name).slice(0, 3).join(', ') + ((m.items || []).length > 3 ? '…' : '')].filter(Boolean).join(' · ')}</div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div className="tt">{fmtNum(mt.kcal)} <span className="dim small">kcal</span></div>
              <MacroLine tot={mt} dim />
            </div>
            <Icon name="chevronRight" className="chev" />
          </div> })}
        </div>)}
      </div>}
      {!meals.length && <div className="small dim" style={{ marginTop: 10, textAlign: 'center' }}>{isToday ? t('Tap a meal to log it — photo, a sentence or by hand.') : t('Nothing logged on {0}.', fmtDate(iso, true))}</div>}
    </div>

    {isToday && <SupplementsCard />}

  </div>
}
