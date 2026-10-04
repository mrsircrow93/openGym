import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { freshGoals, markGoalsSeen } from './lib/goals.js'
import GoalCelebration from './components/GoalCelebration.jsx'
import { bindUI } from './components/ui.jsx'
import { ACCENTS, todayISO } from './lib/format.js'
import { setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import { Mark } from './components/Logo.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Settings from './views/Settings.jsx'
import Nutrition from './views/Nutrition.jsx'
import Admin from './views/Admin.jsx'
import { Verify, Reset, Paywall } from './views/Account.jsx'
import Legal from './views/Legal.jsx'
import Badges, { NewBadgesSheet } from './views/Badges.jsx'
import { newBadges } from './lib/badges.js'
import { locked } from './lib/entitlements.js'
import { MOBILE } from './lib/mobile.js'
import { syncHealth } from './lib/health.js'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f3f5f1' : '#121212'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  // Achievements: when the history produces a badge the person hasn't seen, celebrate once.
  // Checked when the number of workouts, meals or weigh-ins changes, never mid-workout.
  const openSheet = useUI(s => s.openSheet)
  useEffect(() => {
    if (!ready || S.active || !(S.workouts || []).length) return
    const fresh = newBadges(S)
    if (!fresh.length) return
    // First run with history (or an account that predates achievements): count what's already
    // earned as seen, quietly — it all shows in Progress. Only new ones from now on get a party.
    if (!S.badgesSeen || S.celebrations === false) { useStore.getState().update(st => { st.badgesSeen = [...new Set([...(st.badgesSeen || []), ...fresh.map(b => b.id)])] }, false); return }
    const ids = fresh.map(b => b.id)
    const tm = setTimeout(() => {
      useStore.getState().update(st => { st.badgesSeen = [...new Set([...(st.badgesSeen || []), ...ids])] })
      openSheet(close => <NewBadgesSheet ids={ids} close={close} />, { kind: 'center' })
    }, 900)
    return () => clearTimeout(tm)
  }, [ready, !!S.active, (S.workouts || []).length, (S.meals || []).length, (S.bodyweight || []).length, (S.steps || []).length])
  // Daily goals (water, steps, protein, calories, target weight): a small celebration the first
  // time each one is reached that day. First run seeds what is already met so nobody gets
  // cheered for yesterday's water on install.
  const waterNow = ((S.water || []).find(w => w.d === todayISO()) || {}).ml || 0
  const stepsNow = ((S.steps || []).find(r => r.d === todayISO()) || {}).n || 0
  const mealsNow = (S.meals || []).filter(m => m.d === todayISO()).reduce((a, m) => a + (m.items || []).reduce((b, i) => b + (+i.kcal || 0), 0), 0)
  useEffect(() => {
    if (!ready || S.active) return
    const fresh = freshGoals(S)
    if (!fresh.length) return
    // Off in Settings: still mark them seen, so turning it back on doesn't replay the day.
    if (!S.goalsSeen || S.celebrations === false) { useStore.getState().update(st => markGoalsSeen(st, fresh), false); return }
    const tm = setTimeout(() => {
      useStore.getState().update(st => markGoalsSeen(st, fresh))
      openSheet(close => <GoalCelebration goals={fresh} close={close} />, { kind: 'center' })
    }, 700)
    return () => clearTimeout(tm)
  }, [ready, !!S.active, waterNow, stepsNow, mealsNow, (S.bodyweight || []).length])
  // Store app: refresh steps/weight from the phone's health store on launch and whenever the
  // app comes back to the foreground (quietly — the Settings card has the interactive path).
  useEffect(() => {
    if (!MOBILE || !user || !S.health?.on) return
    const run = () => { if (document.visibilityState === 'visible') syncHealth(useStore.getState().update).catch(() => {}) }
    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [MOBILE, !!user, !!S.health?.on])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
  useEffect(() => { setLang(S.lang || 'es') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang || 'es' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  // Links from the account emails work whether or not someone is signed in on this device.
  const authLink = loc.pathname === '/verify' ? <Verify /> : loc.pathname === '/reset' ? <Reset /> : (loc.pathname === '/terms' || loc.pathname === '/privacy') ? <Legal /> : null
  if (authLink) return <><div id="app" className="vfade"><ErrorBoundary>{authLink}</ErrorBoundary></div><Toast /></>
  // Trial over, no subscription: the paywall is the whole app until that changes.
  if (user && locked(user)) return <><div id="app" className="vfade"><ErrorBoundary><Paywall /></ErrorBoundary></div><Modals /><Toast /></>
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', color: 'var(--acc)', opacity: .8 }}>
        <Mark size={56} />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? <Login /> : (
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/plans" element={<Paywall />} />
              <Route path="/nutrition" element={<Nutrition />} />
              <Route path="/badges" element={<Badges />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          )}
        </ErrorBoundary>
      </div>
      <TabBar onStart={startFlow} />
      <RestTimer />
      <Modals />
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
