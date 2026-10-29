/** End-to-end permission checks against a real HTTP server and temporary SQLite state. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBuildingHandler } from './building.ts';

type Client = { cookie?: string };
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'office-api-'));
  const dbPath = join(dir, 'building.sqlite');
  let clock = Date.now();
  let api = createBuildingHandler({ dbPath, now: () => clock });
  let server: Server;
  let base = '';
  const start = async () => {
    server = createServer(api.handle);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    base = `http://127.0.0.1:${address.port}`;
  };
  const stop = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
    api.close();
  };
  await start();
  const request = async (path: string, method = 'GET', input?: unknown, client: Client = {}, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...(input === undefined ? {} : { 'content-type': 'application/json' }), ...extra };
    if (client.cookie) headers.cookie = client.cookie;
    const res = await fetch(`${base}/api/building${path}`, { method, headers, body: input === undefined ? undefined : JSON.stringify(input) });
    const data = await res.json() as any;
    const cookie = res.headers.get('set-cookie');
    if (cookie) client.cookie = cookie.split(';')[0];
    return { status: res.status, data, headers: res.headers };
  };
  const register = async (handle: string) => {
    const client: Client = {};
    const response = await request('/register', 'POST', { handle, name: handle, password: 'correct-horse-battery' }, client);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return { client, ...response.data } as { client: Client; user: { id: string; handle: string; name: string }; office: { id: string } };
  };
  return {
    request, register, get base() { return base; },
    advance: (ms: number) => { clock += ms; },
    restart: async () => { await stop(); api = createBuildingHandler({ dbPath, now: () => clock }); await start(); },
    close: async () => { await stop(); rmSync(dir, { recursive: true, force: true }); },
  };
}
const synthetic = [{ id: 'opaque-agent', provider: 'codex', status: 'running' }];

test('registration, login, persisted sessions and logout', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/session')).status, 401);
    const alice = await f.register('alice');
    const res = await f.request('/session', 'GET', undefined, alice.client);
    assert.equal(res.data.user.handle, 'alice');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert(alice.client.cookie?.startsWith('building_session='));
    assert(!JSON.stringify(res.data).includes('password'));
    await f.restart();
    assert.equal((await f.request('/session', 'GET', undefined, alice.client)).status, 200);
    assert.equal((await f.request('/login', 'POST', { handle: 'alice', password: 'wrong-password-value' })).status, 401);
    const login: Client = {};
    const logged = await f.request('/login', 'POST', { handle: 'ALICE', password: 'correct-horse-battery' }, login);
    assert.equal(logged.status, 200);
    assert(logged.headers.get('set-cookie')?.includes('HttpOnly; SameSite=Strict'));
    assert.equal((await f.request('/logout', 'POST', {}, login)).status, 200);
    assert.equal((await f.request('/session', 'GET', undefined, login)).status, 401);
    assert.equal((await f.request('/register', 'POST', { handle: 'alice', name: 'Other', password: 'another-long-password' })).status, 409);
    f.advance(8 * 86_400_000);
    assert.equal((await f.request('/session', 'GET', undefined, alice.client)).status, 401);
  } finally { await f.close(); }
});

test('offices are undiscoverable without consent; invitations are single-use and grants revoke immediately', async () => {
  const f = await fixture();
  try {
    const a = await f.register('alice'); const b = await f.register('bobby'); const c = await f.register('carol');
    assert.equal((await f.request('/floors', 'GET', undefined, b.client)).data.floors.length, 1);
    assert.equal((await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).status, 404);
    const invitation = await f.request('/invites', 'POST', { scope: 'activity' }, a.client);
    assert.equal(invitation.status, 201);
    assert.equal((await f.request('/accept', 'POST', { token: invitation.data.token }, a.client)).status, 400);
    assert.equal((await f.request('/accept', 'POST', { token: invitation.data.token }, b.client)).status, 200);
    assert.equal((await f.request('/accept', 'POST', { token: invitation.data.token }, c.client)).status, 404);
    assert.equal((await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).status, 200);
    const grant = (await f.request('/grants', 'GET', undefined, a.client)).data.grants[0];
    assert.equal((await f.request(`/grants/${grant.id}`, 'DELETE', {}, c.client)).status, 404);
    assert.equal((await f.request(`/grants/${grant.id}`, 'DELETE', {}, a.client)).status, 200);
    assert.equal((await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).status, 404);
    assert.equal((await f.request('/floors', 'GET', undefined, b.client)).data.floors.length, 1);
  } finally { await f.close(); }
});

test('published snapshots whitelist data, enforce scope, and vanish on pause or stale presence', async () => {
  const f = await fixture();
  try {
    const a = await f.register('alice'); const b = await f.register('bobby');
    const invite = (await f.request('/invites', 'POST', { scope: 'presence' }, a.client)).data;
    await f.request('/accept', 'POST', { token: invite.token }, b.client);
    const privateAgent = { ...synthetic[0], name: 'secret-name', title: 'secret-title', transcript: 'secret-prompt', file: '/secret/path' };
    assert.equal((await f.request('/publish', 'POST', { agents: [privateAgent], officeId: b.office.id }, a.client)).status, 200);
    const own = (await f.request(`/offices/${a.office.id}`, 'GET', undefined, a.client)).data;
    assert.deepEqual(own.agents, [{ ...synthetic[0], name: 'Agent 1', area: 'general' }]);
    assert(!JSON.stringify(own).includes('secret'));
    const presence = (await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).data;
    assert.deepEqual(presence.agents, []); assert.equal(presence.office.agentCount, 0); assert.equal(presence.office.online, true);
    const activity = (await f.request('/invites', 'POST', { scope: 'activity' }, a.client)).data;
    await f.request('/accept', 'POST', { token: activity.token }, b.client);
    assert.equal((await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).data.agents.length, 1);
    f.advance(46_000);
    const stale = (await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).data;
    assert.equal(stale.office.online, false); assert.deepEqual(stale.agents, []); assert.equal(stale.office.agentCount, 0);
    await f.request('/publish', 'POST', { agents: synthetic }, a.client);
    await f.request('/office', 'POST', { paused: true, name: 'Quiet floor' }, a.client);
    assert.deepEqual((await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).data.agents, []);
    assert.equal((await f.request('/publish', 'POST', { agents: synthetic }, a.client)).status, 409);
    await f.request('/office', 'POST', { paused: false }, a.client);
    assert.deepEqual((await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).data.agents, []);
    assert.equal((await f.request('/grants', 'GET', undefined, a.client)).data.grants.length, 1);
  } finally { await f.close(); }
});

test('invitation cancellation, expiry, and concurrent redemption cannot grant excess access', async () => {
  const f = await fixture();
  try {
    const a = await f.register('alice'); const b = await f.register('bobby'); const c = await f.register('carol');
    const invitation = (await f.request('/invites', 'POST', { scope: 'activity' }, a.client)).data;
    const listing = (await f.request('/invites', 'GET', undefined, a.client)).data.invites;
    assert.equal(listing.length, 1); assert.equal(listing[0].token, undefined);
    assert.equal((await f.request(`/invites/${listing[0].id}`, 'DELETE', {}, b.client)).status, 404);
    await f.request(`/invites/${listing[0].id}`, 'DELETE', {}, a.client);
    assert.equal((await f.request('/accept', 'POST', { token: invitation.token }, b.client)).status, 404);
    const expired = (await f.request('/invites', 'POST', { scope: 'activity' }, a.client)).data;
    f.advance(86_400_001);
    assert.equal((await f.request('/accept', 'POST', { token: expired.token }, b.client)).status, 404);
    const race = (await f.request('/invites', 'POST', { scope: 'activity' }, a.client)).data;
    const responses = await Promise.all([b, c].map((u) => f.request('/accept', 'POST', { token: race.token }, u.client)));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 404]);
  } finally { await f.close(); }
});

test('publisher credentials only publish their owner snapshot and revoke/expire independently', async () => {
  const f = await fixture();
  try {
    const a = await f.register('alice'); const b = await f.register('bobby');
    const credential = (await f.request('/publisher-tokens', 'POST', {}, a.client)).data;
    const auth = { authorization: `Bearer ${credential.token}` };
    assert.equal((await f.request('/publish', 'POST', { agents: synthetic, officeId: b.office.id }, {}, auth)).status, 200);
    assert.equal((await f.request('/session', 'GET', undefined, {}, auth)).status, 401);
    assert.equal((await f.request('/invites', 'POST', { scope: 'activity' }, {}, auth)).status, 401);
    assert.equal((await f.request('/publisher-tokens', 'GET', undefined, {}, auth)).status, 401);
    assert.equal((await f.request(`/offices/${b.office.id}`, 'GET', undefined, b.client)).data.agents.length, 0);
    assert.equal((await f.request(`/publisher-tokens/${credential.id}`, 'DELETE', {}, b.client)).status, 404);
    const listing = (await f.request('/publisher-tokens', 'GET', undefined, a.client)).data.tokens;
    assert.equal(listing[0].token, undefined);
    await f.request(`/publisher-tokens/${credential.id}`, 'DELETE', {}, a.client);
    assert.equal((await f.request('/publish', 'POST', { agents: synthetic }, {}, auth)).status, 401);
    const expiring = (await f.request('/publisher-tokens', 'POST', {}, a.client)).data;
    f.advance(31 * 86_400_000);
    assert.equal((await f.request('/publish', 'POST', { agents: synthetic }, {}, { authorization: `Bearer ${expiring.token}` })).status, 401);
  } finally { await f.close(); }
});

test('methods, origins, malformed bodies and oversized inputs are rejected', async () => {
  const f = await fixture();
  try {
    const a = await f.register('alice');
    assert.equal((await f.request('/office', 'POST', { name: 'Hijack' }, a.client, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await f.request('/office', 'POST', { name: 'Okay' }, a.client, { origin: f.base })).status, 200);
    assert.equal((await f.request('/office', 'GET', undefined, a.client)).status, 405);
    assert.equal((await f.request('/office', 'PUT', {}, a.client)).status, 405);
    assert.equal((await f.request('/office', 'POST', { paused: 'yes' }, a.client)).status, 400);
    assert.equal((await f.request('/publish', 'POST', { agents: Array(25).fill(synthetic[0]) }, a.client)).status, 400);
    assert.equal((await f.request('/publish', 'POST', { agents: [synthetic[0], synthetic[0]] }, a.client)).status, 400);
    assert.equal((await f.request('/publish', 'POST', { agents: [{ id: 'x', provider: 'unknown', status: 'running' }] }, a.client)).status, 400);
    assert.equal((await f.request('/publish', 'POST', { agents: [{ ...synthetic[0], id: 'x'.repeat(101) }] }, a.client)).status, 400);
    assert.equal((await f.request('/publish', 'POST', { agents: [{ ...synthetic[0], id: '<img src=x onerror=alert(1)>' }] }, a.client)).status, 400);
    const raw = await fetch(`${f.base}/api/building/office`, { method: 'POST', headers: { cookie: a.client.cookie!, 'content-type': 'application/json' }, body: '{broken' });
    assert.equal(raw.status, 400);
    const noType = await fetch(`${f.base}/api/building/office`, { method: 'POST', headers: { cookie: a.client.cookie! }, body: '{}' });
    assert.equal(noType.status, 415);
    assert.equal((await f.request('/office', 'POST', { name: 'x'.repeat(40_000) }, a.client)).status, 413);
  } finally { await f.close(); }
});

test('auth abuse is rate limited without trusting spoofed forwarding headers', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 20; i++) {
      const res = await f.request('/login', 'POST', {}, {}, { 'x-forwarded-for': `10.0.0.${i}` });
      assert.equal(res.status, 400);
    }
    assert.equal((await f.request('/register', 'POST', {})).status, 429);
    f.advance(15 * 60_000 + 1);
    assert.equal((await f.request('/register', 'POST', {})).status, 400);
  } finally { await f.close(); }
});

test('character names and work areas are owner-controlled, durable and limited to activity access', async () => {
  const f = await fixture();
  try {
    const a = await f.register('alice'); const b = await f.register('bobby');
    await f.request('/publish', 'POST', { agents: [{ ...synthetic[0], name: 'Injected', area: 'backend' }] }, a.client);
    assert.equal((await f.request('/characters', 'GET', undefined, a.client)).data.characters[0].area, 'general');
    assert.equal((await f.request('/characters/opaque-agent', 'POST', { name: 'Cody', area: 'frontend' }, b.client)).status, 404);
    assert.equal((await f.request('/characters/opaque-agent', 'POST', { name: 'Cody', area: 'frontend' }, a.client)).status, 200);
    assert.equal((await f.request('/characters/opaque-agent', 'POST', { name: 'x'.repeat(33), area: 'frontend' }, a.client)).status, 400);
    assert.equal((await f.request('/characters/opaque-agent', 'POST', { name: 'Cody', area: 'private/project/path' }, a.client)).status, 400);
    const key = (await f.request('/publisher-tokens', 'POST', {}, a.client)).data;
    assert.equal((await f.request('/characters/opaque-agent', 'POST', { name: 'Changed', area: 'backend' }, {}, { authorization: `Bearer ${key.token}` })).status, 401);
    await f.restart();
    await f.request('/publish', 'POST', { agents: synthetic }, a.client);
    const own = (await f.request(`/offices/${a.office.id}`, 'GET', undefined, a.client)).data;
    assert.equal(own.agents[0].name, 'Cody'); assert.equal(own.agents[0].area, 'frontend');
    assert.deepEqual(own.office.areas, [{ area: 'frontend', count: 1 }]);
    const invite = (await f.request('/invites', 'POST', { scope: 'presence' }, a.client)).data;
    await f.request('/accept', 'POST', { token: invite.token }, b.client);
    const presence = (await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).data;
    assert.deepEqual(presence.office.areas, []); assert.deepEqual(presence.agents, []);
    const activity = (await f.request('/invites', 'POST', { scope: 'activity' }, a.client)).data;
    await f.request('/accept', 'POST', { token: activity.token }, b.client);
    assert.equal((await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).data.agents[0].name, 'Cody');
    f.advance(46_000);
    assert.deepEqual((await f.request(`/offices/${a.office.id}`, 'GET', undefined, b.client)).data.office.areas, []);
    await f.request('/office', 'POST', { paused: true }, a.client);
    await f.request('/office', 'POST', { paused: false }, a.client);
    await f.request('/publish', 'POST', { agents: synthetic }, a.client);
    assert.equal((await f.request('/characters', 'GET', undefined, a.client)).data.characters[0].name, 'Cody');
  } finally { await f.close(); }
});

test('slow request bodies cannot undo a pause or reuse revoked credentials', async () => {
  const f = await fixture();
  try {
    const a = await f.register('alice');
    const held = async (route: string, prefix: string, headers: Record<string, string>) => {
      let finish!: (value: { status: number; data: any }) => void;
      const response = new Promise<{ status: number; data: any }>((resolve) => { finish = resolve; });
      const req = httpRequest(`${f.base}/api/building${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => finish({ status: res.statusCode!, data: JSON.parse(data) }));
      });
      req.on('error', (error) => { throw error; });
      await new Promise<void>((resolve) => req.write(prefix, () => resolve()));
      return { end: async (suffix: string) => { req.end(suffix); return response; } };
    };
    const rename = await held('/office', '{"name":', { cookie: a.client.cookie! });
    await f.request('/office', 'POST', { paused: true }, a.client);
    const renamed = await rename.end('"Renamed"}');
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.office.paused, true);
    await f.request('/office', 'POST', { paused: false }, a.client);
    const credential = (await f.request('/publisher-tokens', 'POST', {}, a.client)).data;
    const publishing = await held('/publish', '{"agents":', { authorization: `Bearer ${credential.token}` });
    await f.request(`/publisher-tokens/${credential.id}`, 'DELETE', {}, a.client);
    assert.equal((await publishing.end(`${JSON.stringify(synthetic)}}`)).status, 401);
    const editing = await held('/office', '{"name":', { cookie: a.client.cookie! });
    await f.request('/logout', 'POST', {}, a.client);
    assert.equal((await editing.end('"Should not apply"}')).status, 401);
  } finally { await f.close(); }
});

test('owner room style persists; only authorized activity guests receive it', async () => {
  const f = await fixture();
  try {
    const owner = await f.register('decorator'); const guest = await f.register('visitor'); const stranger = await f.register('stranger');
    const appearance = { theme: 'loft', layout: 'lounge', lighting: 'warm' };
    assert.equal((await f.request('/office', 'POST', { appearance: { ...appearance, theme: 'unknown' } }, owner.client)).status, 400);
    assert.equal((await f.request('/office', 'POST', { appearance }, owner.client)).status, 200);
    await f.restart();
    assert.deepEqual((await f.request('/session', 'GET', undefined, owner.client)).data.office.appearance, appearance);
    assert.equal((await f.request(`/offices/${owner.office.id}`, 'GET', undefined, stranger.client)).status, 404);
    for (const scope of ['presence', 'activity']) {
      const invite = await f.request('/invites', 'POST', { scope }, owner.client);
      await f.request('/accept', 'POST', { token: invite.data.token }, guest.client);
      const snapshot = await f.request(`/offices/${owner.office.id}`, 'GET', undefined, guest.client);
      assert.equal(snapshot.status, 200);
      assert.deepEqual(snapshot.data.office.appearance, scope === 'activity' ? appearance : undefined);
    }
    // Updating a visitor's own style never changes the host's style.
    await f.request('/office', 'POST', { appearance: { theme: 'campus', layout: 'focus', lighting: 'cool' } }, guest.client);
    assert.deepEqual((await f.request(`/offices/${owner.office.id}`, 'GET', undefined, guest.client)).data.office.appearance, appearance);
    const grants = await f.request('/grants', 'GET', undefined, owner.client);
    assert.equal((await f.request(`/grants/${grants.data.grants[0].id}`, 'DELETE', {}, owner.client)).status, 200);
    assert.equal((await f.request(`/offices/${owner.office.id}`, 'GET', undefined, guest.client)).status, 404);
  } finally { await f.close(); }
});
