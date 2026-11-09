import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePagesConfig as v } from '../scripts/pages-config';

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
const URL_ = 'https://abcdefghij.supabase.co';

test('valid staging config passes (legacy anon JWT and publishable key)', () => {
  assert.equal(v('staging', 'staging', URL_, jwt('anon')), null);
  assert.equal(v('staging', 'staging', URL_, 'sb_publishable_synthetic'), null);
});
test('rejects modern secret key, legacy service_role JWT, other roles, junk', () => {
  assert.match(v('staging', 'staging', URL_, 'sb_secret_synthetic')!, /secret/);
  assert.match(v('staging', 'staging', URL_, jwt('service_role'))!, /secret/);
  assert.match(v('staging', 'staging', URL_, jwt('authenticated'))!, /anon/);
  assert.match(v('staging', 'staging', URL_, 'eyJnotajwt')!, /anon/);
  assert.match(v('staging', 'staging', URL_, 'whatever')!, /anon|publishable/);
});
test('rejects environment mismatch, missing values, wrong host or scheme', () => {
  assert.match(v('staging', 'production', URL_, jwt('anon'))!, /APP_ENV/);
  assert.ok(v('staging', undefined, URL_, jwt('anon')));
  assert.ok(v('staging', 'staging', '', jwt('anon')));
  assert.match(v('staging', 'staging', 'https://example.com', jwt('anon'))!, /supabase\.co/);
  assert.ok(v('staging', 'staging', 'http://abcdefghij.supabase.co', jwt('anon')));
});
test('error messages never contain the key', () => {
  const k = jwt('service_role');
  assert.equal(v('staging', 'staging', URL_, k)!.includes(k), false);
});
