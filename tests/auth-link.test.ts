import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthCallback } from '../src/auth/callback';
import { describeAuthError } from '../src/auth/errors';

test('callback: success fragment is recognised and tokens are never returned', () => {
  const r = parseAuthCallback('#access_token=SECRET&refresh_token=SECRET2&expires_in=3600&token_type=bearer&type=signup');
  assert.deepEqual(r, { kind: 'session' });
});
test('callback: expired / used / invalid links', () => {
  assert.deepEqual(parseAuthCallback('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), { kind: 'error', reason: 'expired' });
  assert.deepEqual(parseAuthCallback('', '?error=access_denied&error_code=bad_jwt'), { kind: 'error', reason: 'invalid' });
});
test('callback: plain page load is nothing', () => {
  assert.deepEqual(parseAuthCallback('', ''), { kind: 'none' });
  assert.deepEqual(parseAuthCallback('#/closet', '?x=1'), { kind: 'none' });
});

test('rate limits are told apart', () => {
  const cooldown = describeAuthError({ code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 42 seconds.', status: 429 });
  assert.equal(cooldown.kind, 'cooldown'); assert.equal(cooldown.retryAfterSec, 42); assert.match(cooldown.text, /42/);
  const quota = describeAuthError({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded', status: 429 });
  assert.equal(quota.kind, 'email-quota'); assert.equal(quota.retryAfterSec, undefined);
  const req = describeAuthError({ code: 'over_request_rate_limit', message: 'Request rate limit reached', status: 429 });
  assert.equal(req.kind, 'request-rate');
  assert.notEqual(cooldown.text, quota.text); assert.notEqual(quota.text, req.text);
});
test('other errors map to Hebrew and never leak server text', () => {
  assert.match(describeAuthError({ code: 'weak_password' }).text, /חלשה/);
  assert.match(describeAuthError({ code: 'email_address_invalid', message: 'Email address "x" is invalid' }).text, /לא תקינה/);
  assert.equal(describeAuthError({ code: 'weird', message: 'Secret internal detail' }).text.includes('Secret'), false);
});
test('an unrelated ?code= parameter is not mistaken for a confirmation', () => {
  assert.deepEqual(parseAuthCallback('', '?code=abc'), { kind: 'none' });
});
test('cooldown of one second is worded in the singular', () => {
  assert.match(describeAuthError({ code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 1 seconds.' }).text, /שנייה אחת/);
});
