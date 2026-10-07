// Reference clips are the one place a user uploads a container format, so the inspector has to
// decide from the bytes: real structure, known brand, short enough, nothing exotic at top level.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import { inspectVideo, inspectImage } from '../../../api/upload.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-'))
const have = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()
const make = (name, args) => { const f = path.join(tmp, name); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, f]); return fs.readFileSync(f).toString('base64') }
const src = (secs, rate = 12) => ['-f', 'lavfi', '-i', `testsrc=size=240x180:rate=${rate}:duration=${secs}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p']

describe('inspectVideo', () => {
  it('rejects anything that is not an ISO media file', () => {
    expect(inspectVideo('').ok).toBe(false)
    expect(inspectVideo(Buffer.from('not a video, just text pretending to be one').toString('base64')).error).toMatch(/not a plain MP4/)
    expect(inspectVideo(Buffer.from('\x00\x00\x00\x20ftypEVIL' + 'x'.repeat(64)).toString('base64')).ok).toBe(false)
  })
  it('rejects a JPEG sent as a clip, and a clip sent as a photo', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]).toString('base64')
    expect(inspectVideo(jpeg).ok).toBe(false)
    expect(inspectImage(jpeg).ok).toBe(true)
  })
  it.skipIf(!have)('accepts a short clip and reports its length', () => {
    const r = inspectVideo(make('ok.mp4', src(3)))
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('video')
    expect(r.mediaType).toBe('video/mp4')
    expect(r.seconds).toBeGreaterThan(2.5)
    expect(r.seconds).toBeLessThan(3.6)
  })
  it.skipIf(!have)('refuses a clip longer than the reference limit', () => {
    expect(inspectVideo(make('long.mp4', src(20))).error).toMatch(/under 8 seconds/)
  })
  it.skipIf(!have)('refuses a file whose bytes were tampered with after the header', () => {
    const good = Buffer.from(make('t.mp4', src(2)), 'base64')
    const cut = good.subarray(0, Math.floor(good.length / 2))        // truncated: box runs past the end
    expect(inspectVideo(cut.toString('base64')).ok).toBe(false)
    const spliced = Buffer.concat([good, Buffer.from('\x00\x00\x00\x10evil' + 'abcdefgh')])
    expect(inspectVideo(spliced.toString('base64')).ok).toBe(false)   // unknown top-level box
  })
  it.skipIf(!have)('refuses a clip over the size cap, padding and all', () => {
    // a structurally valid file made big with a 'free' box: size is checked before structure
    const good = Buffer.from(make('pad.mp4', src(2)), 'base64')
    const padLen = 7 * 1024 * 1024
    const pad = Buffer.alloc(padLen); pad.writeUInt32BE(padLen, 0); pad.write('free', 4, 'latin1')
    expect(inspectVideo(Buffer.concat([good, pad]).toString('base64')).error).toMatch(/6 MB/)
  })
})
