// Calorie goal assistant: four short steps, plain words, and a result the person can read
// before anything is saved. Maths and guard-rails live in lib/nutrition-goal.js.
import { useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { fmtNum, fmtDate, todayISO } from './lib/format.js'
import { t } from './lib/i18n.js'
import { lastBW } from './lib/history.js'
import { macroGoalOf } from './lib/nutrition.js'
import { GOALS, GOAL_LABEL, ACTIVITY, ACTIVITY_LABEL, PACES, PACE_LABEL, plan, problem, toKg, fromKg } from './lib/nutrition-goal.js'
import Icon from './components/Icon.jsx'
import { Button, Stepper } from './components/ui.jsx'

const update = (...a) => useStore.getState().update(...a)
const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const GOAL_ICON = { lose: 'flame', maintain: 'scale', gain: 'arm' }
const STEPS = 4

export const DISCLAIMER = 'This is a general estimate, not medical advice. If you have a health condition, are pregnant or breastfeeding, are under 18, or have a history of disordered eating, talk to a nutritionist or doctor before changing how you eat.'

function Choice({ options, value, onChange, label, desc, icon }) {
  return <div className="sect-b" style={{ marginBottom: 12 }}>
    {options.map(o => <button key={o} className="lrow tap" onClick={() => onChange(o)}>
      {icon && <span className="lrow-i" style={{ '--tint': value === o ? 'var(--acc)' : 'var(--surface-3)' }}><Icon name={icon[o]} /></span>}
      <span className="lrow-m"><span className="lrow-t">{t(label[o])}</span>{desc && desc[o] && <span className="lrow-s">{t(desc[o])}</span>}</span>
      {value === o && <Icon name="check" className="lrow-k" />}
    </button>)}
  </div>
}

function GoalWizard({ close }) {
  const S = useStore.getState().S
  const unit = S.unit || 'kg'
  const prev = S.nutriGoal || {}
  const bw = lastBW(S)
  const [step, setStep] = useState(0)
  const [a, setA] = useState({
    goal: prev.goal || 'lose', pace: prev.pace || 'moderate',
    sex: prev.sex || (S.body === 'female' ? 'female' : 'male'),
    age: prev.age || (S.trainer && S.trainer.answers && S.trainer.answers.age) || 30,
    heightCm: prev.heightCm || S.heightCm || 170,
    weight: bw ? bw.w : (prev.weightKg ? Math.round(fromKg(prev.weightKg, unit) * 10) / 10 : 70),
    activity: prev.activity || 'moderate',
    targetW: S.targetW || null
  })
  const set = p => setA(x => ({ ...x, ...p }))
  const params = { sex: a.sex, age: a.age, heightCm: a.heightCm, weightKg: toKg(a.weight, unit), activity: a.activity, goal: a.goal, pace: a.pace, targetKg: a.targetW ? toKg(a.targetW, unit) : null }
  const err = step >= 1 ? problem(params) : null
  const res = !err ? plan(params) : null
  const PACE_DESC = {
    gentle: a.goal === 'gain' ? 'Slow and lean' : 'About a quarter kilo a week',
    moderate: a.goal === 'gain' ? 'What most people do well with' : 'About half a kilo a week',
    strong: a.goal === 'gain' ? 'Faster, some fat comes with it' : 'Up to three quarters of a kilo a week; harder to keep up'
  }
  const save = () => {
    update(s => {
      s.macroGoal = { ...macroGoalOf(s), kcal: res.kcal, protein: res.protein, carbs: res.carbs, fat: res.fat }
      s.nutriGoal = { goal: a.goal, pace: a.pace, sex: a.sex, age: a.age, heightCm: a.heightCm, weightKg: params.weightKg, activity: a.activity, targetKg: params.targetKg, kcal: res.kcal, weeklyKg: res.weeklyKg, eta: res.eta, at: Date.now() }
      s.heightCm = a.heightCm
      if (a.targetW) s.targetW = a.targetW
    })
    close(); toast(t('Targets updated'))
  }
  const titles = [t('What do you want?'), t('About you'), t('How fast?'), t('Your numbers')]
  return <>
    <div className="row between" style={{ marginBottom: 4 }}>
      <h3 className="row" style={{ gap: 8, margin: 0 }}><Icon name="target" style={{ color: 'var(--yellow)' }} />{t('How many calories do I need?')}</h3>
      <span className="small dim">{step + 1} / {STEPS}</span>
    </div>
    <div className="wprog" style={{ margin: '8px 0 14px' }}><i style={{ width: ((step + 1) / STEPS) * 100 + '%', background: 'var(--yellow)' }} /></div>
    <h4 className="sec" style={{ marginTop: 0 }}>{titles[step]}</h4>

    {step === 0 && <>
      <Choice options={GOALS} value={a.goal} onChange={v => set({ goal: v })} label={GOAL_LABEL} icon={GOAL_ICON}
        desc={{ lose: 'Eat a bit less than you burn, keep your muscle', maintain: 'Eat what you burn', gain: 'Eat a bit more than you burn, train hard' }} />
      {S.dietPlan && <div className="small muted" style={{ lineHeight: 1.5 }}><Icon name="info" style={{ fontSize: 13, marginRight: 5 }} />{t('You have a plan from your nutritionist. Their numbers come first — use this only if they told you to adjust on your own.')}</div>}
    </>}

    {step === 1 && <>
      <div className="seg-range" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          {['male', 'female'].map(x => <button key={x} className={'chip' + (a.sex === x ? ' on' : '')} style={{ flex: 1 }} onClick={() => set({ sex: x })}>{t(x === 'male' ? 'Male' : 'Female')}</button>)}
        </div>
        <div className="small dim" style={{ marginTop: 4 }}>{t('Used only for the resting-energy equation.')}</div>
      </div>
      <div className="row cfgrow" style={{ marginBottom: 8 }}>
        <Stepper label={t('Age')} value={a.age} step={1} decimal={false} onChange={v => set({ age: v })} />
        <Stepper label={t('Height (cm)')} value={a.heightCm} step={1} decimal={false} onChange={v => set({ heightCm: v })} />
        <Stepper label={t('Weight') + ' (' + unit + ')'} value={a.weight} step={0.5} onChange={v => set({ weight: v })} />
      </div>
      <div className="small muted" style={{ margin: '10px 0 6px' }}>{t('How active are you in a normal week?')}</div>
      <Choice options={ACTIVITY} value={a.activity} onChange={v => set({ activity: v })} label={ACTIVITY_LABEL} />
    </>}

    {step === 2 && <>
      {a.goal === 'maintain'
        ? <div className="small muted" style={{ lineHeight: 1.5, marginBottom: 12 }}>{t('To maintain, you eat roughly what you burn. Nothing to choose here.')}</div>
        : <Choice options={PACES} value={a.pace} onChange={v => set({ pace: v })} label={PACE_LABEL} desc={PACE_DESC} />}
      {a.goal !== 'maintain' && <>
        <div className="small muted" style={{ margin: '10px 0 6px' }}>{t('Target weight (optional) — to estimate the date')}</div>
        <div className="row cfgrow"><Stepper label={t('Target weight') + ' (' + unit + ')'} value={a.targetW || 0} step={0.5} onChange={v => set({ targetW: v || null })} /></div>
      </>}
    </>}

    {step === 3 && res && <>
      <div className="meal-hero" style={{ marginBottom: 12 }}>
        <div className="meal-kcal"><b>{fmtNum(res.kcal)}</b><span>{t('kcal a day')}</span></div>
        <div className="meal-macros">
          <div><i style={{ background: 'var(--blue)' }} /><b>{res.protein} g</b><span>{t('Protein')}</span></div>
          <div><i style={{ background: 'var(--orange)' }} /><b>{res.carbs} g</b><span>{t('Carbs')}</span></div>
          <div><i style={{ background: 'var(--yellow)' }} /><b>{res.fat} g</b><span>{t('Fat')}</span></div>
        </div>
      </div>
      <div className="small" style={{ lineHeight: 1.6, marginBottom: 10 }}>
        {a.goal === 'maintain'
          ? t('Your body burns about {0} kcal a day with your activity. Eating around that keeps your weight where it is.', fmtNum(res.maintenance))
          : a.goal === 'lose'
            ? t('Your body burns about {0} kcal a day. Eating {1} less puts you on track to lose about {2} {3} a week.', fmtNum(res.maintenance), fmtNum(res.deficit), fmtNum(Math.round(fromKg(res.weeklyKg, unit) * 100) / 100), unit)
            : t('Your body burns about {0} kcal a day. Eating {1} more supports muscle gain of roughly {2} {3} a week.', fmtNum(res.maintenance), fmtNum(-res.deficit), fmtNum(Math.round(fromKg(res.weeklyKg, unit) * 100) / 100), unit)}
        {res.eta && ' ' + t('At that pace you would reach {0} {1} around {2}.', fmtNum(a.targetW), unit, fmtDate(res.eta, true))}
      </div>
      {res.floorApplied && <div className="row small" style={{ gap: 6, color: 'var(--orange)', marginBottom: 8 }}><Icon name="info" style={{ fontSize: 14 }} />{t('We kept the calories at a safe minimum. Going lower is something to do only with a professional.')}</div>}
      {res.capped && !res.floorApplied && <div className="row small" style={{ gap: 6, color: 'var(--orange)', marginBottom: 8 }}><Icon name="info" style={{ fontSize: 14 }} />{t('The pace was capped at 1% of your body weight a week, the limit for losing fat without losing muscle.')}</div>}
      <div className="small muted" style={{ marginBottom: 6 }}>{t('Protein is set high on purpose: it keeps muscle while you change weight. Fat covers about 28% of calories; carbs fill the rest and fuel your training.')}</div>
      <button className="linkbtn small" onClick={() => sourcesSheet(res)}>{t('Where do these numbers come from?')}</button>
      <div className="card small muted" style={{ marginTop: 12, lineHeight: 1.5, borderLeft: '3px solid var(--yellow)' }}><Icon name="shield" style={{ fontSize: 13, marginRight: 6, color: 'var(--yellow)' }} />{t(DISCLAIMER)}</div>
      <div className="small dim" style={{ margin: '10px 0 12px' }}>{t('We will ask you to review this in 4 weeks, or sooner if your weight moves 3 kg, because what you burn changes as you change.')}</div>
    </>}

    {err && step >= 1 && <div className="small" style={{ color: 'var(--red)', margin: '6px 0 10px' }}>{t(err)}</div>}
    <div className="row" style={{ gap: 8, marginTop: 8 }}>
      {step > 0 && <Button icon="chevronLeft" onClick={() => setStep(s => s - 1)} style={{ flex: 1 }}>{t('Back')}</Button>}
      {step < STEPS - 1
        ? <Button variant="primary" trailingIcon="chevronRight" disabled={!!err} onClick={() => setStep(s => (s === 1 && a.goal === 'maintain' ? 3 : s + 1))} style={{ flex: 2 }}>{t('Next')}</Button>
        : <Button variant="primary" icon="check" disabled={!res} onClick={save} style={{ flex: 2 }}>{t('Use these targets')}</Button>}
    </div>
  </>
}
export const goalWizardSheet = () => ui().openSheet(close => <GoalWizard close={close} />)

function Sources({ res, close }) {
  return <>
    <h3>{t('Where do these numbers come from?')}</h3>
    <div className="small muted" style={{ lineHeight: 1.6 }}>
      <p><b>{t('Resting energy')}:</b> {t('Mifflin-St Jeor equation (1990), the one with the best accuracy in adults in comparisons by the Academy of Nutrition and Dietetics.')}{res ? ' ' + t('Yours: about {0} kcal.', fmtNum(res.bmr)) : ''}</p>
      <p><b>{t('Daily burn')}:</b> {t('resting energy times an activity factor between 1.2 (mostly sitting) and 1.9 (very active).')}{res ? ' ' + t('Yours: about {0} kcal.', fmtNum(res.maintenance)) : ''}</p>
      <p><b>{t('Deficit or surplus')}:</b> {t('10–25% of the daily burn. About 7,700 kcal correspond to one kilo of body fat, so 500 kcal a day is roughly half a kilo a week. Health agencies (WHO, CDC) recommend no more than 0.5–1 kg a week; the app never plans more than 1% of body weight a week and never goes under 1,200 kcal (women) or 1,500 kcal (men).')}</p>
      <p><b>{t('Protein')}:</b> {t('1.6–2.2 g per kg of body weight (International Society of Sports Nutrition position stand), higher in a deficit to protect muscle.')}</p>
      <p><b>{t('Fat and carbs')}:</b> {t('fat around 25–30% of calories for hormones and satiety; carbohydrates fill the rest and fuel training.')}</p>
      <p>{t('These are population averages: your real burn can differ by 10–15%. Weigh yourself a few times a week and adjust with the review the app suggests.')}</p>
    </div>
    <div style={{ height: 10 }} /><Button onClick={close}>{t('Done')}</Button>
  </>
}
export const sourcesSheet = res => ui().openSheet(close => <Sources res={res} close={close} />)
