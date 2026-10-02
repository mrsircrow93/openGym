// "Continue with Google": the client (web button or the native picker in the store apps) hands
// us a Google ID token; we verify it here with Google's published keys and nothing else — no
// client secret, no server-side OAuth dance, no password ever touches this server.
//
// Checks, in order: RS256 signature against the current JWKS (cached an hour, refetched once
// on an unknown kid), issuer, audience (one of OUR client ids: web, iOS, Android), expiry, and
// that Google says the email is verified. Returns { sub, email, name, picture } or throws.
import crypto from 'node:crypto';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

let jwks = { keys: [], at: 0 };
async function keysFor(kid, fetchImpl = fetch) {
  const fresh = Date.now() - jwks.at < 60 * 60_000;
  if (!fresh || !jwks.keys.some(k => k.kid === kid)) {
    const r = await fetchImpl(JWKS_URL);
    if (!r.ok) throw new Error('google jwks ' + r.status);
    jwks = { keys: (await r.json()).keys || [], at: Date.now() };
  }
  return jwks.keys.find(k => k.kid === kid) || null;
}

const b64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export async function verifyGoogleIdToken(token, audiences, opts = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  let header, payload;
  try { header = JSON.parse(b64u(parts[0]).toString('utf8')); payload = JSON.parse(b64u(parts[1]).toString('utf8')); }
  catch { throw new Error('malformed token'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('unexpected algorithm');
  const jwk = opts.jwk || await keysFor(header.kid, opts.fetch);
  if (!jwk) throw new Error('unknown signing key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, b64u(parts[2]));
  if (!ok) throw new Error('bad signature');
  const now = Math.floor((opts.now || Date.now()) / 1000);
  if (!ISSUERS.has(payload.iss)) throw new Error('bad issuer');
  if (!audiences.includes(payload.aud)) throw new Error('token is for another app');
  if (!payload.exp || payload.exp < now - 60) throw new Error('token expired');
  if (payload.iat && payload.iat > now + 300) throw new Error('token from the future');
  if (!payload.sub) throw new Error('no subject');
  if (!payload.email || payload.email_verified !== true) throw new Error('google account has no verified email');
  return { sub: String(payload.sub), email: String(payload.email).toLowerCase(), name: String(payload.name || payload.given_name || '').slice(0, 40), picture: payload.picture || null };
}
