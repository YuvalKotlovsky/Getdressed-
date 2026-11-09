import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache, type KV } from '../src/storage/cache';
import { emptyAppData } from '../src/cloud/scope';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** storage whose setItem takes `delay` ms, like a slow disk */
function slowKv(delay: number) {
  const m = new Map<string, string>();
  const kv: KV = {
    getItem: async (k) => m.get(k) ?? null,
    setItem: (k, v) => new Promise((r) => setTimeout(() => { m.set(k, v); r(); }, delay)),
    removeItem: async (k) => { m.delete(k); },
  };
  return { kv, m };
}

test('a save in flight at sign-out cannot recreate the old account cache', async () => {
  const { kv, m } = slowKv(30);
  const c = createCache(kv);
  const inflight = c.save(emptyAppData(A)); // started before sign-out, finishes late
  await c.clear(A); // sign-out
  await inflight;
  assert.equal(m.has(`wmw:v2:${A}`), false);
});

test('clearing account A never touches account B, and B can write right away', async () => {
  const { kv, m } = slowKv(10);
  const c = createCache(kv);
  await c.save(emptyAppData(B));
  const slowA = c.save(emptyAppData(A));
  await c.clear(A);
  await c.save(emptyAppData(B));
  await slowA;
  assert.equal(m.has(`wmw:v2:${A}`), false);
  assert.equal(m.has(`wmw:v2:${B}`), true);
});

test('after sign-out the same account signing in again starts from the removal, not from stale data', async () => {
  const { kv, m } = slowKv(10);
  const c = createCache(kv);
  const old = c.save(emptyAppData(A));
  await c.clear(A);
  await old;
  assert.equal(await c.read(A), null); // nothing left to expose
  await c.save(emptyAppData(A)); // the new session writes after the removal
  assert.equal(m.has(`wmw:v2:${A}`), true);
});

test('a failing write reports false and does not break the queue', async () => {
  const kv: KV = { getItem: async () => null, setItem: async () => { throw new Error('full'); }, removeItem: async () => {} };
  const c = createCache(kv);
  assert.equal(await c.save(emptyAppData(A)), false);
  await c.clear(A);
});
