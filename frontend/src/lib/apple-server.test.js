// api/apple.js is plain Node; exercise the ID-token checks with a throw-away RSA key so no
// network and no real Google token are needed.
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { verifyAppleIdToken } from '../../../api/apple.js'

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const now = 1_800_000_000_000
const AUD = ['app.vantixgym.web', 'app.vantixgym.mobile']
function token(overrides = {}, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }) {
  const payload = { iss: 'https://appleid.apple.com', aud: AUD[0], sub: '1234567890', email: 'Ana@Example.com', email_verified: true, iat: now / 1000 - 10, exp: now / 1000 + 3600, ...overrides }
  const h = b64u(header), p = b64u(payload)
  const sig = crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url')
  return h + '.' + p + '.' + sig
}
const verify = (t, o = {}) => verifyAppleIdToken(t, AUD, { jwk, now, ...o })

describe('verifyAppleIdToken', () => {
  it('accepts a good token and normalises the email', async () => {
    const r = await verify(token())
    expect(r).toMatchObject({ sub: '1234567890', email: 'ana@example.com', emailVerified: true })
  })
  it('accepts any of our client ids', async () => {
    expect((await verify(token({ aud: AUD[1] }))).sub).toBe('1234567890')
  })
  it('rejects a token for another app', async () => {
    await expect(verify(token({ aud: 'com.other.app' }))).rejects.toThrow(/another app/)
  })
  it('rejects a bad issuer and an expired token; reports unverified email', async () => {
    await expect(verify(token({ iss: 'https://evil.example' }))).rejects.toThrow(/issuer/)
    await expect(verify(token({ exp: now / 1000 - 3600 }))).rejects.toThrow(/expired/)
    await expect((await verify(token({ email_verified: 'false' }))).emailVerified).toBe(false)
  })
  it('rejects a tampered payload and a wrong algorithm', async () => {
    const t = token()
    const [h, , s] = t.split('.')
    const forged = h + '.' + b64u({ iss: 'https://appleid.apple.com', aud: AUD[0], sub: '999', email: 'x@y.z', email_verified: true, exp: now / 1000 + 100 }) + '.' + s
    await expect(verify(forged)).rejects.toThrow(/signature/)
    await expect(verify(token({}, { alg: 'HS256', kid: 'k1' }))).rejects.toThrow(/algorithm/)
    await expect(verify('not.a.token')).rejects.toThrow()
  })
  it('refuses when the signing key is unknown', async () => {
    await expect(verifyAppleIdToken(token(), AUD, { jwk: null, now, fetch: async () => ({ ok: true, json: async () => ({ keys: [] }) }) })).rejects.toThrow(/unknown signing key/)
  })
})
