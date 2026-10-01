import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, needsRehash, passwordProblem } from './password.js';

test('hash / verify round-trip, wrong password fails', () => {
  const h = hashPassword('correct horse battery');
  assert.ok(h.startsWith('scrypt$32768$8$1$'));
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('correct horse batterx', h), false);
  assert.equal(verifyPassword('', h), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
});

test('two hashes of the same password differ (random salt)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'));
});

test('parameter upgrade is detected', () => {
  const old = hashPassword('pw', { N: 16384, r: 8, p: 1, keylen: 32 });
  assert.equal(verifyPassword('pw', old), true);
  assert.equal(needsRehash(old), true);
  assert.equal(needsRehash(hashPassword('pw')), false);
});

test('policy: length and common list only', () => {
  assert.equal(passwordProblem('short'), 'too short');
  assert.equal(passwordProblem('Password1'), 'too common');
  assert.equal(passwordProblem('x'.repeat(129)), 'too long');
  assert.equal(passwordProblem('mi perro se llama tobi 2019'), null);
});
