// Someone's existing routine (coach's PDF, gym card photo) -> routine objects. The model
// transcribes (api: import-routine) and this file turns that into something the app can save:
// each exercise is matched to the library by its canonical English name; what does not match
// becomes a custom exercise with the name as written, so nothing on the sheet is lost.
import { EXIDX, isCardio } from './exercises.js'
import { defaultConfig } from './history.js'
import { uid } from './format.js'
import { GLYPHS, DEFAULT_GLYPH } from './glyphs.js'
import { matchExercise } from './import-csv.js'

const clampInt = (v, lo, hi, d) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d }

// The model's muscle labels -> the dataset's body parts, for the exercises we have to invent.
const MUSCLE_BP = {
  chest: 'chest', back: 'back', shoulders: 'shoulders', biceps: 'upper arms', triceps: 'upper arms', forearms: 'lower arms',
  quads: 'upper legs', hamstrings: 'upper legs', glutes: 'upper legs', calves: 'lower legs', abs: 'waist',
  cardio: 'cardio', 'full body': 'upper legs', other: 'upper legs'
}

const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

// The canonical names the model is asked for, mapped by hand to the dataset entry people
// mean. The generic matcher refuses to guess between near-identical entries (good) but the
// dataset's own phrasing is odd ("sled 45° leg press", "lever lying leg curl"), so the
// everyday vocabulary is spelled out. Extend this table to improve import accuracy.
const CANON = {
  'barbell bench press': '0025', 'bench press': '0025', 'barbell incline bench press': '0047', 'incline barbell bench press': '0047', 'incline bench press': '0047',
  'barbell decline bench press': '0033', 'decline bench press': '0033', 'close grip bench press': '0030', 'barbell close grip bench press': '0030',
  'dumbbell bench press': '0289', 'dumbbell incline press': '0314', 'dumbbell incline bench press': '0314', 'incline dumbbell press': '0314', 'incline dumbbell bench press': '0314',
  'dumbbell fly': '0308', 'dumbbell incline fly': '0319', 'incline dumbbell fly': '0319', 'cable fly': '0227', 'cable crossover': '1269', 'cable chest fly': '0227', 'pec deck': '0596', 'machine fly': '0596', 'machine chest fly': '0596', 'chest press machine': '0596',
  'push up': '0662', 'chest dip': '0251', 'dip': '0251', 'parallel bar dip': '0251', 'triceps dip': '0814', 'bench dip': '0812', 'assisted dip': '0019',
  'barbell squat': '0043', 'squat': '0043', 'back squat': '0043', 'barbell back squat': '0043', 'barbell front squat': '0042', 'front squat': '0042', 'goblet squat': '1760', 'dumbbell goblet squat': '1760', 'kettlebell goblet squat': '0534',
  'hack squat': '0743', 'machine hack squat': '0743', 'smith machine squat': '0770', 'smith squat': '0770', 'leg press': '0739', 'machine leg press': '0739',
  'barbell lunge': '0054', 'dumbbell lunge': '0336', 'lunge': '0336', 'walking lunge': '1460', 'bulgarian split squat': '0410', 'dumbbell bulgarian split squat': '0410', 'split squat': '0410', 'dumbbell step up': '0431', 'step up': '0431',
  'leg extension': '0585', 'machine leg extension': '0585', 'lying leg curl': '0586', 'leg curl': '0586', 'seated leg curl': '0599', 'machine leg curl': '0586',
  'barbell deadlift': '0032', 'deadlift': '0032', 'conventional deadlift': '0032', 'sumo deadlift': '0117', 'barbell sumo deadlift': '0117', 'trap bar deadlift': '0811', 'dumbbell deadlift': '0300',
  'barbell romanian deadlift': '0085', 'romanian deadlift': '0085', 'dumbbell romanian deadlift': '1459', 'stiff leg deadlift': '0085', 'barbell good morning': '0044', 'good morning': '0044',
  'barbell hip thrust': '1409', 'hip thrust': '1409', 'glute bridge': '3013', 'barbell glute bridge': '1409',
  'standing calf raise': '1372', 'barbell standing calf raise': '1372', 'dumbbell standing calf raise': '0417', 'bodyweight calf raise': '1373', 'seated calf raise': '0594', 'machine seated calf raise': '0594', 'calf press': '0738', 'leg press calf raise': '0738',
  'hip abduction machine': '0597', 'hip adduction machine': '0598', 'hip abduction': '0597', 'hip adduction': '0598',
  'lat pulldown': '2330', 'cable lat pulldown': '2330', 'wide grip lat pulldown': '0198', 'pulldown': '2330', 'pull up': '0652', 'chin up': '1326', 'assisted pull up': '0017',
  'barbell row': '0027', 'barbell bent over row': '0027', 'bent over row': '0027', 'pendlay row': '0027', 'dumbbell row': '0292', 'one arm dumbbell row': '0292', 'single arm dumbbell row': '0292', 'dumbbell one arm row': '0292', 'dumbbell bent over row': '0293',
  'cable seated row': '0861', 'seated cable row': '0861', 'seated row': '0861', 'cable row': '0861', 'machine row': '0861', 't bar row': '1349', 'cable straight arm pulldown': '0199',
  'face pull': '0233', 'cable face pull': '0233', 'rear delt fly': '0378', 'dumbbell rear delt fly': '0378', 'reverse fly': '0378', 'dumbbell reverse fly': '0378', 'rear delt row': '0202',
  'barbell shrug': '0095', 'dumbbell shrug': '0406', 'shrug': '0095', 'hyperextension': '0489', 'back extension': '0489', 'machine back extension': '0573',
  'barbell overhead press': '0091', 'overhead press': '0091', 'military press': '0091', 'barbell military press': '0091', 'barbell shoulder press': '0091', 'standing barbell press': '0091', 'dumbbell shoulder press': '0405', 'dumbbell overhead press': '0405', 'seated dumbbell shoulder press': '0405', 'arnold press': '2137', 'dumbbell arnold press': '2137',
  'dumbbell lateral raise': '0334', 'lateral raise': '0334', 'side lateral raise': '0334', 'cable lateral raise': '0178', 'dumbbell front raise': '0310', 'front raise': '0310', 'barbell upright row': '0120', 'upright row': '0120', 'dumbbell upright row': '0437',
  'barbell curl': '0031', 'biceps curl': '0294', 'dumbbell curl': '0294', 'dumbbell biceps curl': '0294', 'alternating dumbbell curl': '0285', 'hammer curl': '0313', 'dumbbell hammer curl': '0313', 'ez bar curl': '0447', 'ez barbell curl': '0447',
  'preacher curl': '0070', 'dumbbell preacher curl': '0372', 'incline dumbbell curl': '0318', 'dumbbell incline curl': '0318', 'cable curl': '0868', 'concentration curl': '0297',
  'cable triceps pushdown': '0241', 'triceps pushdown': '0241', 'cable pushdown': '0201', 'rope pushdown': '0200', 'cable rope pushdown': '0200', 'triceps rope pushdown': '0200',
  'skull crusher': '0060', 'barbell skull crusher': '0060', 'lying triceps extension': '0060', 'cable overhead triceps extension': '0194', 'overhead triceps extension': '2188', 'dumbbell overhead triceps extension': '2188', 'dumbbell triceps extension': '2188', 'triceps kickback': '0333', 'dumbbell kickback': '0333', 'dumbbell triceps kickback': '0333',
  'crunch': '0274', 'sit up': '0735', 'hanging leg raise': '0472', 'lying leg raise': '0620', 'leg raise': '0620', 'hanging knee raise': '0011', 'russian twist': '0687', 'ab wheel rollout': '0103', 'mountain climber': '0630', 'burpee': '1160',
  'kettlebell swing': '0549', 'barbell thruster': '3305', 'barbell clean and press': '0028',
  'treadmill': '0684', 'treadmill run': '0684', 'running': '0685', 'run': '0685', 'jog': '0685', 'stationary bike': '2138', 'bike': '2138', 'cycling': '2138', 'spinning': '2138', 'elliptical': '2141', 'stair climber': '2311', 'stairmaster': '2311', 'jump rope': '2612', 'rowing machine': '2331',
}
// Spelling the model (or a coach) uses -> the words the table and the dataset use.
const NORM = [
  [/-/g, ' '], [/\b(flyes|flys|flies)\b/g, 'fly'], [/\bdips\b/g, 'dip'], [/\b(push ups?|pushups?)\b/g, 'push up'], [/\b(pull ups?|pullups?)\b/g, 'pull up'],
  [/\b(chin ups?|chinups?)\b/g, 'chin up'], [/\bsingle arm\b/g, 'one arm'], [/\bdb\b/g, 'dumbbell'], [/\bbb\b/g, 'barbell'], [/\bkb\b/g, 'kettlebell'], [/\bmachine\b(?=.*\bmachine\b)/g, ''],
  [/\b(tricep)\b/g, 'triceps'], [/\b(bicep)\b/g, 'biceps'], [/\bcurls\b/g, 'curl'], [/\brows\b/g, 'row'], [/\braises\b/g, 'raise'], [/\bpresses\b/g, 'press'], [/\bsquats\b/g, 'squat'], [/\blunges\b/g, 'lunge'],
  [/\bstanding\b/g, ''], [/\bseated\b(?! calf| leg curl| row| cable| dumbbell)/g, ''], [/\s+/g, ' '],
]
const canonKey = n => NORM.reduce((k, [re, to]) => k.replace(re, to), String(n || '').toLowerCase()).trim()

// Library id for a transcribed exercise: curated table first (canonical English name, then
// the name as written), then the generic word-bag matcher, else null — never a guess.
export function matchImported(e) {
  const tries = [e.name_en, e.name].map(x => clean(x, 80)).filter(Boolean)
  for (const n of tries) { const id = CANON[canonKey(n)]; if (id && EXIDX[id]) return id }
  for (const n of tries) { const id = matchExercise(n); if (id && EXIDX[id]) return id }
  return null
}

// { routines, week, custom, matched, created } — `custom` are new entries for S.customEx,
// which the caller must push AND registerCustom() before the routines are usable.
export function materializeImport(parsed, S, maxDays = 7) {
  const routines = [], week = {}, custom = [], taken = new Set()
  const existing = new Map((S.customEx || []).map(c => [c.n.toLowerCase(), c.id]))
  let matched = 0, created = 0
  for (const r of (parsed && parsed.routines) || []) {
    const ex = []
    for (const e of r.exercises || []) {
      const name = clean(e.name, 60) || clean(e.name_en, 60)
      if (!name) continue
      let id = matchImported(e)
      if (id) matched++
      else {
        id = existing.get(name.toLowerCase())
        if (!id) {
          id = 'c' + uid()
          const c = { id, n: name, bp: MUSCLE_BP[e.muscle] || 'upper legs', desc: '', tg: '', eq: 'custom', custom: true }
          custom.push(c); existing.set(name.toLowerCase(), id); created++
        }
      }
      const cardio = EXIDX[id] ? isCardio(id) : e.muscle === 'cardio'
      const cfg = cardio || (!EXIDX[id] && e.minutes > 0)
        ? { ...defaultConfig(id, 'cardio'), mode: 'cardio', min: clampInt(e.minutes, 1, 180, 20) }
        : e.seconds > 0 && !(e.reps > 0)
          ? { ...defaultConfig(id, 'time'), sec: clampInt(e.seconds, 5, 600, 45) }
          : { ...defaultConfig(id, 'reps'), reps: clampInt(e.reps, 1, 50, 10) }
      if (cfg.mode !== 'cardio') {
        cfg.sets = clampInt(e.sets, 1, 10, cfg.sets || 3)
        if (e.rest > 0) cfg.rest = clampInt(e.rest, 15, 600, 90)
      }
      const note = [clean(e.weight, 20), clean(e.note, 100)].filter(Boolean).join(' · ')
      if (note) cfg.note = note.slice(0, 120)
      ex.push({ id, ...cfg })
    }
    if (!ex.length) continue
    const rid = uid()
    routines.push({ id: rid, name: clean(r.name, 40) || 'Workout', emoji: GLYPHS.includes(r.glyph) ? r.glyph : DEFAULT_GLYPH, prog: 'linear', ex })
    for (const d of r.days || []) { const k = clampInt(d, 0, 6, -1); if (k >= 0 && !taken.has(k) && taken.size < maxDays) { taken.add(k); week[k] = rid } }
  }
  // No weekdays on the sheet: lay the sessions out so the week view isn't empty. One routine
  // (a full-body plan) runs Mon/Wed/Fri — or as often as the sheet says; several routines
  // rotate through the week in order. The person can still move days in the preview.
  if (!Object.keys(week).length && routines.length) Object.assign(week, defaultWeek(routines, parsed && parsed.daysPerWeek))
  return { routines, week, custom, matched, created, dropped: 0 }
}

const ORDER = [1, 3, 5, 2, 4, 6, 0]   // Mon, Wed, Fri first, then fill in
export function defaultWeek(routines, daysPerWeek) {
  const week = {}
  if (!routines.length) return week
  const n = Math.min(7, Math.max(routines.length, +daysPerWeek || (routines.length === 1 ? 3 : routines.length === 2 ? 4 : routines.length)))
  const days = n <= 3 ? ORDER.slice(0, n).sort((a, b) => (a || 7) - (b || 7)) : n === 4 ? [1, 2, 4, 5] : [1, 2, 3, 4, 5, 6, 0].slice(0, n)
  days.forEach((d, i) => { week[d] = routines[i % routines.length].id })
  return week
}
