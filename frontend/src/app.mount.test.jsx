// @vitest-environment jsdom
// Boots the whole app once in a browser-like DOM. Catches the class of bug a build cannot:
// a name used without import, a hook outside a component, a crash in the first render.
import { describe, it, expect, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

describe('app boots', () => {
  it('renders the first screen without throwing', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    // jsdom under Node 22+ has no usable localStorage: give the app a plain in-memory one.
    const mem = new Map()
    const ls = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear(), key: i => [...mem.keys()][i] || null, get length() { return mem.size } }
    Object.defineProperty(window, 'localStorage', { value: ls, configurable: true }); Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
    if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    if (!window.scrollTo) window.scrollTo = () => {}
    if (!HTMLCanvasElement.prototype.getContext) HTMLCanvasElement.prototype.getContext = () => null
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 503, text: async () => '{}', json: async () => ({}) }))
    const errors = []
    const origError = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ')); origError(...a) }
    window.addEventListener('error', e => errors.push(String(e.message)))
    const { default: App } = await import('./App.jsx')
    const el = document.createElement('div'); el.id = 'root'; document.body.appendChild(el)
    await act(async () => { createRoot(el).render(<App />); await new Promise(r => setTimeout(r, 300)) })
    const fatal = errors.filter(m => /is not defined|Cannot read|is not a function|Invalid hook|Minified React error/i.test(m))
    expect(fatal).toEqual([])
    expect(document.body.textContent.length).toBeGreaterThan(20)
  })
})
