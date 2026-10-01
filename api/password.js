// Password hashing for email accounts (docs/ACCOUNTS.md §2). scrypt from node:crypto — no new
// dependency. The encoding carries its own parameters so they can be raised later and old
// hashes still verify; callers re-hash on the next successful login when needsRehash() says so.
import crypto from 'node:crypto';

const PARAMS = { N: 32768, r: 8, p: 1, keylen: 32 };
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function hashPassword(password, params = PARAMS) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 128 * params.N * params.r * 2 });
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, salt, hash] = String(stored || '').split('$');
    if (algo !== 'scrypt') return false;
    const expect = Buffer.from(hash, 'base64url');
    const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), expect.length, { N: +N, r: +r, p: +p, maxmem: 128 * N * r * 2 });
    return got.length === expect.length && crypto.timingSafeEqual(got, expect);
  } catch { return false; }
}

export function needsRehash(stored) {
  const [algo, N, r, p] = String(stored || '').split('$');
  return algo !== 'scrypt' || +N !== PARAMS.N || +r !== PARAMS.r || +p !== PARAMS.p;
}

// A hash of a random password, verified against on logins for unknown emails so a wrong
// email and a wrong password take the same time (no account enumeration by timing).
export const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

// Policy: length only, plus a short list of the passwords everyone tries first. No
// composition rules — length beats symbols, and rules push people to "Password1!".
const COMMON = new Set(['password', 'contraseña', '12345678', '123456789', '1234567890', 'qwerty123', 'password1', 'password123',
  '11111111', '00000000', 'iloveyou', 'sunshine', 'football', 'baseball', 'princess', 'welcome1', 'abc12345', 'letmein1',
  'qwertyuiop', 'admin123', 'adminadmin', 'passw0rd', 'p@ssw0rd', 'trustno1', 'whatever', 'dragon123', 'monkey123', 'shadow123',
  'master123', 'superman', 'michael1', 'jennifer', 'jordan23', 'liverpool', 'starwars', 'computer', 'internet', 'gymgymgym',
  'opengym1', 'opengym123', 'mexico123', 'america1', 'chivas123', 'aaaaaaaa', 'asdfghjk', 'zxcvbnm1', '87654321', '12341234']);
export function passwordProblem(pw) {
  const s = String(pw || '');
  if (s.length < PASSWORD_MIN) return 'too short';
  if (s.length > PASSWORD_MAX) return 'too long';
  if (COMMON.has(s.toLowerCase())) return 'too common';
  return null;
}
