// Raw app screenshots from the demo build at iPhone 6.7" size (1290x2796 = 430x932 @3x).
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
const OUT = process.argv[2] || 'shots'; const LANG = process.argv[3] || 'es'
fs.mkdirSync(OUT, { recursive: true })
const srv = spawn('python3', ['-m', 'http.server', '4173', '--bind', '127.0.0.1'], { cwd: 'dist-demo', stdio: 'ignore' })
await new Promise(r => setTimeout(r, 800))
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: LANG === 'en' ? 'en-US' : 'es-MX', colorScheme: 'dark', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1' })
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:4173/#/home'); await page.waitForTimeout(2500)
// language + theme live in the profile state; also seed today's meals, steps, water and a few
// past meal days so Home and Nutrition look lived-in (the demo seed only covers workouts).
await page.evaluate(lang => {
  const KEY = 'gym_state_v1'
  const S = JSON.parse(localStorage.getItem(KEY) || '{}')
  S.lang = lang; S.theme = 'dark'
  const iso = d => { const x = new Date(); x.setDate(x.getDate() - d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') }
  const item = (name, portion, grams, kcal, protein, carbs, fat) => ({ name, portion, grams, kcal, protein, carbs, fat, sugar: 4, fiber: 3, sodium: 300 })
  const es = lang !== 'en'
  const day = (d, k) => ([
    { id: 'm' + d + 'a', d: iso(d), t: '08:10', type: 'breakfast', name: es ? 'Avena con plátano y huevo' : 'Oats with banana and eggs', ai: true, items: [item(es ? 'Avena cocida' : 'Cooked oats', '1 taza', 240, 160, 6, 27, 3), item(es ? 'Plátano' : 'Banana', '1 pieza', 120, 105, 1.3, 27, 0.4), item(es ? 'Huevos revueltos' : 'Scrambled eggs', '2 piezas', 110, 180, 13, 2, 13)] },
    { id: 'm' + d + 'b', d: iso(d), t: '14:20', type: 'lunch', name: es ? 'Pollo a la plancha con arroz' : 'Grilled chicken with rice', ai: true, items: [item(es ? 'Pechuga de pollo' : 'Chicken breast', '150 g', 150, 248, 46, 0, 5), item(es ? 'Arroz integral' : 'Brown rice', '1 taza', 195, 215, 5, 45, 1.8), item(es ? 'Ensalada verde' : 'Green salad', '1 plato', 120, 45, 2, 6, 2)] },
    ...(k ? [{ id: 'm' + d + 'c', d: iso(d), t: '19:40', type: 'dinner', name: es ? 'Salmón con verduras' : 'Salmon with vegetables', ai: true, items: [item(es ? 'Salmón' : 'Salmon', '140 g', 140, 290, 30, 0, 18), item(es ? 'Verduras al vapor' : 'Steamed vegetables', '1 taza', 150, 70, 3, 12, 1)] }] : []),
    ...(k ? [{ id: 'm' + d + 'd', d: iso(d), t: '17:00', type: 'snack', name: es ? 'Yogur griego con nuez' : 'Greek yogurt with walnuts', ai: false, items: [item(es ? 'Yogur griego' : 'Greek yogurt', '170 g', 170, 100, 17, 6, 0.7), item(es ? 'Nuez' : 'Walnuts', '20 g', 20, 130, 3, 3, 13)] }] : [])
  ])
  S.meals = [...day(0, false), ...day(1, true), ...day(2, true), ...day(3, true), ...day(4, true), ...day(5, true), ...day(6, true)]
  S.steps = [{ d: iso(0), n: 6420, src: 'health' }, { d: iso(1), n: 9120, src: 'health' }, { d: iso(2), n: 8410, src: 'health' }]
  S.water = [{ d: iso(0), ml: 1250 }, { d: iso(1), ml: 2250 }]
  S.celebrations = false
  localStorage.setItem(KEY, JSON.stringify(S))
}, LANG)
await page.reload(); await page.waitForTimeout(2000)   // hash-only navigation never re-reads the state
const routes = [['home', '/home'], ['plan', '/plan'], ['nutrition', '/nutrition'], ['stats', '/stats'], ['badges', '/badges'], ['history', '/history'], ['settings', '/settings']]
for (const [name, r] of routes) {
  await page.goto('http://127.0.0.1:4173/#' + r); await page.waitForTimeout(1800)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}
await browser.close(); srv.kill()
