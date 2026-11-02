import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeOnce, filterSnapshot, validateEndpoints } from './bridge.mjs';

test('bridge shares only a bounded, pseudonymous allowlist', () => {
  const agents = filterSnapshot({ threads: Array.from({ length: 30 }, (_, i) => ({
    id: `private-thread-${i}`, title: 'SECRET TASK', message: 'SECRET PROMPT', files: '/private/path', cost: 22, provider: 'codex', status: 'running',
  })) }, 'salt');
  assert.equal(agents.length, 24);
  assert.deepEqual(Object.keys(agents[0]).sort(), ['id', 'provider', 'status']);
  assert.ok(!JSON.stringify(agents).includes('SECRET'));
  assert.ok(!JSON.stringify(agents).includes('private'));
  assert.equal(agents[0].id, filterSnapshot({ threads: [{ id: 'private-thread-0', provider: 'codex', status: 'running' }] }, 'salt')[0].id);
  assert.notEqual(agents[0].id, filterSnapshot({ threads: [{ id: 'private-thread-0', provider: 'codex', status: 'running' }] }, 'other salt')[0].id);
  assert.deepEqual(filterSnapshot({ threads: [{ id: 'x', provider: 'unknown', status: 'running' }] }, 'salt'), []);
});

test('bridge rejects insecure remote targets and nonlocal or credential-bearing sources', () => {
  assert.throws(() => validateEndpoints('http://remote.example', 'http://localhost:5174'));
  assert.throws(() => validateEndpoints('https://building.example', 'https://remote.example'));
  assert.throws(() => validateEndpoints('https://user:secret@building.example', 'http://localhost:5174'));
  assert.throws(() => validateEndpoints('https://building.example/path', 'http://localhost:5174'));
  assert.ok(validateEndpoints('https://building.example', 'http://localhost:5174'));
});

test('source failure clears shared snapshot instead of leaving stale data or simulating activity', async () => {
  const calls = [];
  const result = await bridgeOnce({ server: new URL('http://localhost:5173'), source: new URL('http://localhost:5174'), token: 'secret', salt: 'salt', fetcher: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new Error('offline');
    return { ok: true };
  } });
  assert.deepEqual(result, { available: false, count: 0 });
  assert.deepEqual(JSON.parse(calls[1].options.body), { agents: [] });
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[0].options.headers, undefined);
});

test('revoked publishing credentials are surfaced, never silently retried as a different identity', async () => {
  let count = 0;
  await assert.rejects(bridgeOnce({ server: new URL('http://localhost:5173'), source: new URL('http://localhost:5174'), token: 'secret', salt: 'salt', fetcher: async () => {
    count++;
    return count === 1 ? { ok: true, json: async () => ({ threads: [] }) } : { ok: false, status: 401 };
  } }), /HTTP 401/);
  assert.equal(count, 2);
});
