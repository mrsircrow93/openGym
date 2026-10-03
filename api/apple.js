// "Continue with Apple": same shape as google.js — the client (Apple JS popup on the web, the
// native sheet in the iOS app) hands us Apple's identity token and we verify it against Apple's
// published keys. No private key or secret is needed for this; those only matter for token
// refresh and server notifications, which this flow does not use.
import crypto from 'node:crypto';

const JWKS_URL = 'https://appleid.apple.com/auth/keys';
const ISSUER = 'https://appleid.apple.com';

let jwks = { keys: [], at: 0 };
async function keysFor(kid, fetchImpl = fetch) {
  const fresh = Date.now() - jwks.at < 60 * 60_000;
  if (!fresh || !jwks.keys.some(k => k.kid === kid)) {
    const r = await fetchImpl(JWKS_URL);
    if (!r.ok) throw new Error('apple jwks ' + r.status);
    jwks = { keys: (await r.json()).keys || [], at: Date.now() };
  }
  return jwks.keys.find(k => k.kid === kid) || null;
}
const b64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Returns { sub, email, emailVerified, isPrivateEmail } or throws. Apple sends the email claim
// on every sign-in (a relay address when the person hid theirs); the name only comes once, in
// the authorization response, so the client passes it alongside.
export async function verifyAppleIdToken(token, audiences, opts = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  let header, payload;
  try { header = JSON.parse(b64u(parts[0]).toString('utf8')); payload = JSON.parse(b64u(parts[1]).toString('utf8')); }
  catch { throw new Error('malformed token'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('unexpected algorithm');
  const jwk = opts.jwk || await keysFor(header.kid, opts.fetch);
  if (!jwk) throw new Error('unknown signing key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (!crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, b64u(parts[2]))) throw new Error('bad signature');
  const now = Math.floor((opts.now || Date.now()) / 1000);
  if (payload.iss !== ISSUER) throw new Error('bad issuer');
  if (!audiences.includes(payload.aud)) throw new Error('token is for another app');
  if (!payload.exp || payload.exp < now - 60) throw new Error('token expired');
  if (!payload.sub) throw new Error('no subject');
  if (!payload.email) throw new Error('apple account shared no email');
  const ev = payload.email_verified === true || payload.email_verified === 'true';
  return { sub: String(payload.sub), email: String(payload.email).toLowerCase(), emailVerified: ev, isPrivateEmail: payload.is_private_email === true || payload.is_private_email === 'true' };
}
