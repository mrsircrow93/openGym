// Boots the real API: uploading a reference clip writes a private file, serving it needs the
// owner's session and byte ranges, and another account cannot reach it by id.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../api/server.js')
const PORT = 4300 + Math.floor(Math.random() * 100)
const BASE = `http://127.0.0.1:${PORT}`
const haveFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()
let proc, dir
const T = {}

const call = (p, { as, body, method, headers = {} } = {}) => fetch(BASE + p, {
  method: method || (body !== undefined ? 'POST' : 'GET'),
  headers: { 'content-type': 'application/json', ...(as ? { authorization: 'Bearer ' + T[as] } : {}), ...headers },
  body: body !== undefined ? JSON.stringify(body) : undefined
})
const j = async r => ({ ...(await r.json().catch(() => ({}))), http: r.status })
const clip = secs => {
  const f = path.join(dir, 'c' + secs + '.mp4')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=160x120:rate=10:duration=${secs}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', f])
  return fs.readFileSync(f).toString('base64')
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exm-'))
  proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, LOG_JSON: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((resolve, reject) => { proc.stdout.on('data', d => { if (String(d).includes('gym-api on')) resolve() }); proc.on('exit', c => reject(new Error('exited ' + c))); setTimeout(() => reject(new Error('no start')), 8000) })
  for (const [name, email] of [['ana', 'ana@example.com'], ['mal', 'mallory@example.com']]) {
    const r = await j(await call('/api/auth/register', { body: { email, name, password: 'correct horse battery ' + name, client: 'mobile' } }))
    T[name] = r.token
  }
}, 20000)
afterAll(() => { proc?.kill(); try { fs.rmSync(dir, { recursive: true, force: true }) } catch {} })

describe('exercise reference media', () => {
  it('needs a session', async () => {
    expect((await call('/api/exercise-media', { body: { image: 'x' } })).status).toBe(401)
    expect((await call('/api/exercise-media?id=abcj')).status).toBe(401)
  })
  it('refuses anything that is not a real image or clip', async () => {
    const svg = Buffer.from('<svg onload=alert(1)></svg>').toString('base64')
    expect((await j(await call('/api/exercise-media', { as: 'ana', body: { image: svg } }))).http).toBe(400)
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]).toString('base64')
    expect((await j(await call('/api/exercise-media', { as: 'ana', body: { video: exe } }))).http).toBe(400)
  })
  it('stores a JPEG and serves it back to its owner only', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 7)]).toString('base64')
    const up = await j(await call('/api/exercise-media', { as: 'ana', body: { image: jpeg } }))
    expect(up.http).toBe(200); expect(up.kind).toBe('image'); expect(up.id).toMatch(/j$/)
    const get = await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'ana' })
    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toBe('image/jpeg')
    expect(get.headers.get('x-content-type-options')).toBe('nosniff')
    expect(get.headers.get('cache-control')).toContain('private')
    expect((await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'mal' })).status).toBe(404)
    expect((await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'mal', method: 'DELETE' })).status).toBe(200)
    expect((await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'ana' })).status).toBe(200)
  })
  it('cannot be walked out of its own folder', async () => {
    for (const bad of ['../../db.json', '/etc/passwd', '..%2F..%2Fsecret']) {
      expect((await call('/api/exercise-media?id=' + encodeURIComponent(bad), { as: 'ana' })).status).toBe(404)
    }
  })
  it.skipIf(!haveFfmpeg)('stores a short clip, serves byte ranges, and deletes it', async () => {
    const up = await j(await call('/api/exercise-media', { as: 'ana', body: { video: clip(2) } }))
    expect(up.http).toBe(200); expect(up.kind).toBe('video'); expect(up.id).toMatch(/m$/); expect(up.seconds).toBeLessThan(3)
    const full = await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'ana' })
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    const total = +full.headers.get('content-length')
    const part = await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'ana', headers: { range: 'bytes=0-99' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe(`bytes 0-99/${total}`)
    expect((await part.arrayBuffer()).byteLength).toBe(100)
    const bad = await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'ana', headers: { range: `bytes=${total + 10}-` } })
    expect(bad.status).toBe(416)
    expect((await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'ana', method: 'DELETE' })).status).toBe(200)
    expect((await call('/api/exercise-media?id=' + encodeURIComponent(up.id), { as: 'ana' })).status).toBe(404)
  })
  it.skipIf(!haveFfmpeg)('refuses a clip that is too long', async () => {
    const r = await j(await call('/api/exercise-media', { as: 'ana', body: { video: clip(20) } }))
    expect(r.http).toBe(400); expect(r.error).toMatch(/8 seconds/)
  })
})
