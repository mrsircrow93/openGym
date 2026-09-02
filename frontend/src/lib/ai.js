// Bring-your-own AI key.
//
// By default the AI features (natural-language set logging, the coach read-out, exercise
// swaps, photo identification) run through the server's own Anthropic key — see api/server.js.
// That means every user spends the instance owner's credits, and it needs a backend at all.
//
// This module lets a user paste THEIR OWN Anthropic key instead. When one is set, the four AI
// helpers in api.js call the Anthropic API directly from the browser with that key, and the
// server is never involved. Two consequences worth knowing:
//   · The key is stored in localStorage on this device only. It is never synced to the server,
//     never written into the profile state, and never leaves the browser except in the request
//     to Anthropic's own API.
//   · Because the call is client-side, AI keeps working on a fully static deploy (e.g. Netlify
//     with no backend) — the one thing that otherwise needs the Node server.
//
// The system prompts and tool schemas below mirror api/server.js; the server remains the
// reference implementation, this is the same thing moved client-side for the BYO-key path.

import { useStore } from '../store/useStore.js'

const KEY_LS = 'gym_ai_key'
const MODEL_LS = 'gym_ai_model'
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

// Offered in Settings. Any string works if typed manually, but these cover the common tiers.
export const AI_MODELS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 — fast & cheap' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5 — balanced' },
  { value: 'claude-opus-5', label: 'Opus 5 — most capable' },
]

export const getAIKey = () => { try { return localStorage.getItem(KEY_LS) || '' } catch { return '' } }
export const hasUserKey = () => !!getAIKey()
export function setAIKey(k) {
  try { if (k) localStorage.setItem(KEY_LS, k.trim()); else localStorage.removeItem(KEY_LS) } catch { /* private mode */ }
}
export const getAIModel = () => { try { return localStorage.getItem(MODEL_LS) || DEFAULT_MODEL } catch { return DEFAULT_MODEL } }
export function setAIModel(m) { try { localStorage.setItem(MODEL_LS, m || DEFAULT_MODEL) } catch { /* private mode */ } }

const ENDPOINT = 'https://api.anthropic.com/v1/messages'

// Direct browser → Anthropic call. `anthropic-dangerous-direct-browser-access` is Anthropic's
// documented opt-in that enables CORS for browser-originated requests; without it the browser
// blocks the response. The key used is the user's own, calling their own account.
async function callDirect({ system, messages, tools, tool_choice, max_tokens }) {
  const key = getAIKey()
  if (!key) throw new Error('No API key set')
  let r
  try {
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: getAIModel(), max_tokens: max_tokens || 1024, system, messages, tools, tool_choice })
    })
  } catch { throw new Error('Could not reach the AI service — check your connection') }
  if (!r.ok) {
    let msg = 'AI request failed (' + r.status + ')'
    try { const e = await r.json(); if (e?.error?.message) msg = e.error.message } catch { /* non-JSON error */ }
    if (r.status === 401) msg = 'That API key was rejected — check it and try again'
    if (r.status === 429) msg = 'Your Anthropic account is rate-limited — try again shortly'
    throw new Error(msg)
  }
  return r.json()
}

// Cheap round-trip used by the Settings "Test" button — proves the key works end to end.
export async function testAIKey() {
  const r = await callDirect({ max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] })
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim()
  return { ok: true, text }
}

const toolInput = (r, name) => {
  const call = (r.content || []).find(b => b.type === 'tool_use' && (!name || b.name === name))
  if (!call) throw new Error('No structured reply from the model')
  return call.input
}

/* ---- the four helpers, mirroring api/server.js ---- */

export async function directParseSet(text, exercise, unit) {
  const r = await callDirect({
    max_tokens: 300,
    system: `Parse a spoken/typed description of one set of a strength exercise into numbers. ` +
      `Weight unit is ${unit === 'lb' ? 'pounds' : 'kilograms'} unless the person says otherwise. ` +
      `Leave a field null if it truly isn't mentioned or implied. Set confident=false only if you ` +
      `cannot extract sets or reps at all.`,
    messages: [{ role: 'user', content: (exercise ? `Exercise: ${exercise}\n` : '') + String(text || '').slice(0, 300) }],
    tools: [{
      name: 'log_set',
      description: 'The parsed set',
      input_schema: {
        type: 'object',
        properties: {
          sets: { type: ['integer', 'null'], description: 'number of sets performed' },
          reps: { type: ['integer', 'null'], description: 'reps per set' },
          weight: { type: ['number', 'null'], description: 'load used, in the given unit' },
          confident: { type: 'boolean' }
        },
        required: ['confident']
      }
    }],
    tool_choice: { type: 'tool', name: 'log_set' }
  })
  return { ok: true, ...toolInput(r, 'log_set') }
}

export async function directCoach() {
  const S = useStore.getState().S
  const recent = (S.workouts || []).slice(-15).map(w => ({
    date: w.d,
    entries: (w.entries || []).map(e => ({
      id: e.id, target: e.target,
      sets: (e.sets || []).map(s => ({ done: !!s.done, r: s.r, w: s.w, sec: s.sec, min: s.min }))
    }))
  }))
  const routines = (S.routines || []).map(r => ({ name: r.name, prog: r.prog || 'linear', exCount: (r.ex || []).length }))
  const r = await callDirect({
    max_tokens: 700,
    system: `You are a concise, encouraging strength-training coach reviewing a client's recent logged ` +
      `workouts (raw JSON: routines they follow, then up to 15 sessions with each exercise's target vs what ` +
      `was actually done — "done" sets counted as hit). Weight unit is ${S.unit || 'kg'}. Exercise ids are ` +
      `from a public exercise database and not human-readable — refer to exercises by their role (e.g. ` +
      `"your pressing work", "the leg curl") rather than by id. Write 150-250 words in plain language: ` +
      `what's trending well, where reps/weight have stalled across sessions, and 1-3 concrete, specific ` +
      `suggestions (e.g. a deload, a technique check, adding a set). No markdown headers, just prose. ` +
      `Respond in ${S.lang === 'es' ? 'Spanish' : 'English'}.`,
    messages: [{ role: 'user', content: JSON.stringify({ routines, recent }) }]
  })
  const text = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
  if (!text) throw new Error('No reply from the model')
  return { ok: true, text }
}

export async function directIdentify(image, mediaType) {
  const mt = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mediaType) ? mediaType : 'image/jpeg'
  const r = await callDirect({
    max_tokens: 300,
    system: 'You identify gym equipment and exercises from a photo taken on a gym floor. Give your single ' +
      'best guess, even from a partial or blurry view — a gym-goer just pointed a phone at a machine or a ' +
      'move mid-rep and wants it logged, not a hedge.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mt, data: image } },
        { type: 'text', text: 'What exercise/machine is this? If nothing exercise-related is visible, say so via confidence: "none".' }
      ]
    }],
    tools: [{
      name: 'identify_exercise',
      description: 'The identified exercise',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'common exercise name, lowercase' },
          bodyPart: { type: 'string', enum: ['back', 'cardio', 'chest', 'lower arms', 'lower legs', 'neck', 'shoulders', 'upper arms', 'upper legs', 'waist'] },
          equipment: { type: 'string', description: 'e.g. "leverage machine", "dumbbell", "cable", "barbell", "body weight"' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low', 'none'] },
          note: { type: 'string', description: 'one short clause on what gave it away, or why confidence is low/none' }
        },
        required: ['name', 'bodyPart', 'equipment', 'confidence']
      }
    }],
    tool_choice: { type: 'tool', name: 'identify_exercise' }
  })
  return { ok: true, ...toolInput(r, 'identify_exercise') }
}

export async function directAlternatives(exercise, candidates, reason) {
  const ex = exercise || {}
  const cands = (Array.isArray(candidates) ? candidates : []).slice(0, 150)
  const r = await callDirect({
    max_tokens: 500,
    system: `A lifter mid-workout wants to swap the exercise "${ex.name}"` +
      (ex.target ? ` (trains ${ex.target})` : '') + (ex.equipment ? `, done with ${ex.equipment}` : '') + `. ` +
      (reason ? `Their reason for swapping: "${reason}". ` : '') +
      `Choose 3-5 alternatives from the provided candidate list that train the same muscle and are the ` +
      `closest substitutes given the reason. Only pick ids that appear in the candidate list. Order them ` +
      `best-first. For each, give a short reason (max ~8 words) for why it's a good swap here.`,
    messages: [{ role: 'user', content: JSON.stringify({ current: ex, candidates: cands }) }],
    tools: [{
      name: 'suggest_alternatives',
      description: 'The chosen alternative exercises',
      input_schema: {
        type: 'object',
        properties: {
          alternatives: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'exercise id, MUST be one from the candidate list' },
                why: { type: 'string', description: 'short reason this is a good swap' }
              },
              required: ['id', 'why']
            }
          }
        },
        required: ['alternatives']
      }
    }],
    tool_choice: { type: 'tool', name: 'suggest_alternatives' }
  })
  const valid = new Set(cands.map(c => c.id))
  const alternatives = (toolInput(r, 'suggest_alternatives').alternatives || []).filter(a => valid.has(a.id)).slice(0, 6)
  return { ok: true, alternatives }
}
