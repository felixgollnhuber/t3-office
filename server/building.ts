import { isCharacterStyle, cleanCharacterStyle } from '../src/character-style.ts';
import { DEFAULT_APPEARANCE, isAppearance } from '../src/appearance.ts';
/** Consent-based building API. It stores only accounts, grants and explicitly published status snapshots, never local T3 data. */
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

const derive = promisify(scrypt);
const DAY = 86_400_000;
const STALE = 45_000;
const MAX_BODY = 32_768;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const providers = new Set(['claude', 'codex', 'cursor', 'gemini']);
const statuses = new Set(['running', 'waiting', 'idle', 'failed', 'completed']);
const areas = new Set(['general', 'frontend', 'backend', 'design', 'testing', 'research', 'operations']);
type Next = () => void;
type Row = Record<string, string | number | null>;
type User = { id: string; handle: string; name: string };
type Agent = { id: string; name: string; provider: string; status: string; area?: string };
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function fail(status: number, message: string): never { throw new ApiError(status, message); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Expected a JSON object.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, min = 1): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(400, `Invalid ${label}.`);
  return value.trim();
}
function scope(value: unknown): 'presence' | 'activity' {
  if (value !== 'presence' && value !== 'activity') fail(400, 'Choose presence or activity sharing.');
  return value;
}
function passwordInput(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 256) fail(400, 'Use a password between 12 and 256 characters.');
  return value;
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'Send application/json.');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) fail(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (e) { if (e instanceof ApiError) throw e; return fail(400, 'Invalid JSON.'); }
}

export function createBuildingHandler(options: { dbPath?: string; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const path = options.dbPath ?? resolve('.local/building.sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, name TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS offices(id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE REFERENCES users(id), name TEXT NOT NULL, paused INTEGER NOT NULL DEFAULT 0, updated INTEGER, agents TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites(id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, office TEXT NOT NULL REFERENCES offices(id), scope TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, office TEXT NOT NULL REFERENCES offices(id), user TEXT NOT NULL REFERENCES users(id), scope TEXT NOT NULL, UNIQUE(office,user));
    CREATE TABLE IF NOT EXISTS publisher_tokens(id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, user TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS characters(office TEXT NOT NULL REFERENCES offices(id), agent TEXT NOT NULL, name TEXT NOT NULL, area TEXT NOT NULL, PRIMARY KEY(office,agent));
    CREATE INDEX IF NOT EXISTS grants_user ON grants(user);
    CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
    CREATE TABLE IF NOT EXISTS character_styles(office TEXT NOT NULL REFERENCES offices(id), agent TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(office,agent));
    CREATE TABLE IF NOT EXISTS appearance(office TEXT PRIMARY KEY REFERENCES offices(id), value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS invites_office ON invites(office);
  `);
  const one = (sql: string, ...values: (string | number)[]) => db.prepare(sql).get(...values) as Row | undefined;
  const all = (sql: string, ...values: (string | number)[]) => db.prepare(sql).all(...values) as Row[];
  const run = (sql: string, ...values: (string | number)[]) => db.prepare(sql).run(...values);
  const ownOffice = (user: User) => one('SELECT * FROM offices WHERE owner=?', user.id)!;
  const appearance = (office: Row) => {
    const row = one('SELECT value FROM appearance WHERE office=?', String(office.id));
    return row ? JSON.parse(String(row.value)) : DEFAULT_APPEARANCE;
  };
  const characters = (office: Row) => {
    const profiles = new Map(all('SELECT agent,name,area FROM characters WHERE office=?', String(office.id)).map((p) => [p.agent, p]));
    const styles = new Map(all('SELECT agent,value FROM character_styles WHERE office=?', String(office.id)).map((p) => [p.agent, JSON.parse(String(p.value))]));
    return (JSON.parse(String(office.agents)) as Agent[]).map((a) => {
      const profile = profiles.get(a.id);
      return { ...a, name: profile ? String(profile.name) : a.name, area: profile ? String(profile.area) : 'general', ...(styles.has(a.id) ? { style: styles.get(a.id) } : {}) };
    });
  };
  const session = (user: User) => {
    const office = ownOffice(user);
    return { user, office: { id: office.id, name: office.name, paused: !!office.paused, appearance: appearance(office) } };
  };
  const authenticate = (req: IncomingMessage): User => {
    const raw = req.headers.cookie?.split(';').map((p) => p.trim()).find((p) => p.startsWith('building_session='))?.slice('building_session='.length);
    if (!raw || !/^[\w-]{43}$/.test(raw)) fail(401, 'Sign in to enter the building.');
    const row = one('SELECT u.id,u.handle,u.name FROM users u JOIN sessions s ON s.user=u.id WHERE s.token=? AND s.expires>?', hash(raw), now());
    if (!row) fail(401, 'Your session has expired. Sign in again.');
    return row as User;
  };
  const authenticatePublisher = (req: IncomingMessage): User => {
    const raw = req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];
    const row = raw ? one('SELECT u.id,u.handle,u.name FROM users u JOIN publisher_tokens t ON t.user=u.id WHERE t.token=? AND t.expires>?', hash(raw), now()) : undefined;
    if (!row) fail(401, 'Publisher credential is invalid or expired.');
    return row as User;
  };
  const cookie = (req: IncomingMessage, res: ServerResponse, value: string, maxAge: number) => {
    const secure = !!(req.socket as { encrypted?: boolean }).encrypted;
    res.setHeader('Set-Cookie', `building_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  };
  const startSession = (req: IncomingMessage, res: ServerResponse, user: User) => {
    const raw = token();
    run('DELETE FROM sessions WHERE expires<=?', now());
    run('INSERT INTO sessions VALUES(?,?,?)', hash(raw), user.id, now() + 7 * DAY);
    cookie(req, res, raw, 7 * DAY / 1000);
  };
  const floor = (office: Row, user: User, level: string) => {
    const isOwner = office.owner === user.id;
    const online = !office.paused && typeof office.updated === 'number' && now() - office.updated < STALE;
    const agents = characters(office);
    const visibleActivity = online && (isOwner || level === 'activity');
    const counts = new Map<string, number>();
    if (visibleActivity) for (const a of agents) counts.set(a.area, (counts.get(a.area) ?? 0) + 1);
    return {
      id: office.id, name: office.name,
      ownerName: one('SELECT name FROM users WHERE id=?', String(office.owner))!.name,
      isOwner, scope: isOwner ? 'owner' : level, online,
      ...(isOwner ? { paused: !!office.paused } : {}),
      ...(isOwner || level === 'activity' ? { appearance: appearance(office) } : {}),
      updatedAt: office.updated, agentCount: isOwner || (level === 'activity' && online) ? agents.length : 0,
      areas: [...counts].map(([area, count]) => ({ area, count })),
    };
  };
  const rates = new Map<string, { until: number; count: number }>();
  const limitAuth = (req: IncomingMessage) => {
    for (const [key, value] of rates) if (value.until <= now()) rates.delete(key);
    const key = req.socket.remoteAddress ?? 'local';
    const current = rates.get(key) ?? { until: now() + 15 * 60_000, count: 0 };
    current.count++;
    rates.set(key, current);
    if (current.count > 20) fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  };
  const handle = (req: IncomingMessage, res: ServerResponse, next: Next = () => { res.statusCode = 404; res.end(); }) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== '/api/building' && !pathname.startsWith('/api/building/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const reply = (status: number, data: unknown) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    void (async () => {
      const method = req.method ?? 'GET';
      if (!['GET', 'POST', 'DELETE'].includes(method)) fail(405, 'Method not allowed.');
      const origin = req.headers.origin;
      if (origin) {
        const protocol = (req.socket as { encrypted?: boolean }).encrypted ? 'https:' : 'http:';
        if (origin !== `${protocol}//${req.headers.host}`) fail(403, 'Cross-origin requests are not allowed.');
      }
      const route = pathname.slice('/api/building'.length) || '/';
      const match = (path: string, allowed: string[]) => {
        if (route !== path) return false;
        if (!allowed.includes(method)) fail(405, 'Method not allowed.');
        return true;
      };
      if (match('/register', ['POST'])) {
        limitAuth(req);
        const input = await body(req);
        const handle = text(input.handle, 'handle', 32, 3).toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(handle)) fail(400, 'Use letters, numbers, underscores or hyphens for your handle.');
        const name = text(input.name, 'name', 60);
        const password = passwordInput(input.password);
        if (one('SELECT id FROM users WHERE handle=?', handle)) fail(409, 'That handle is already taken.');
        const salt = randomBytes(16).toString('hex');
        const key = (await derive(password, salt, 64)) as Buffer;
        const user = { id: randomUUID(), handle, name };
        db.exec('BEGIN IMMEDIATE');
        try {
          // Check after the asynchronous password derivation as well: simultaneous requests may race.
          if (one('SELECT id FROM users WHERE handle=?', handle)) fail(409, 'That handle is already taken.');
          run('INSERT INTO users VALUES(?,?,?,?,?)', user.id, handle, name, salt, key.toString('hex'));
          run('INSERT INTO offices(id,owner,name) VALUES(?,?,?)', randomUUID(), user.id, `${name}’s office`);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        startSession(req, res, user);
        return reply(201, session(user));
      }
      if (match('/login', ['POST'])) {
        limitAuth(req);
        const input = await body(req);
        const handle = text(input.handle, 'handle', 32, 3).toLowerCase();
        const password = passwordInput(input.password);
        const row = one('SELECT * FROM users WHERE handle=?', handle);
        const key = (await derive(password, row ? String(row.salt) : 'invalid-account-salt', 64)) as Buffer;
        if (!row || !timingSafeEqual(key, Buffer.from(String(row.password), 'hex'))) fail(401, 'Incorrect handle or password.');
        const user = { id: String(row.id), handle: String(row.handle), name: String(row.name) };
        startSession(req, res, user);
        return reply(200, session(user));
      }
      let user: User;
      if (route === '/publish' && method === 'POST' && req.headers.authorization) {
        user = authenticatePublisher(req);
      } else {
        // A bearer credential must never gain session permissions on another route.
        if (req.headers.authorization) fail(401, 'Publisher credentials can only publish activity.');
        user = authenticate(req);
      }
      const authorizedBody = async () => {
        const input = await body(req);
        // A request body may arrive slowly while a session/key is revoked in another request.
        user = req.headers.authorization ? authenticatePublisher(req) : authenticate(req);
        return input;
      };
      const office = ownOffice(user);
      if (match('/session', ['GET'])) return reply(200, session(user));
      if (match('/logout', ['POST'])) {
        await authorizedBody();
        const raw = req.headers.cookie!.split(';').map((p) => p.trim()).find((p) => p.startsWith('building_session='))!.slice('building_session='.length);
        run('DELETE FROM sessions WHERE token=?', hash(raw));
        cookie(req, res, '', 0);
        return reply(200, { ok: true });
      }
      if (match('/floors', ['GET'])) {
        const offices = all('SELECT o.*, COALESCE(g.scope,\'owner\') AS scope FROM offices o LEFT JOIN grants g ON g.office=o.id AND g.user=? WHERE o.owner=? OR g.id IS NOT NULL ORDER BY o.owner=? DESC,o.name', user.id, user.id, user.id);
        return reply(200, { floors: offices.map((o) => floor(o, user, String(o.scope))) });
      }
      if (match('/office', ['POST'])) {
        const input = await authorizedBody();
        const current = ownOffice(user);
        if (input.name === undefined && input.paused === undefined && input.appearance === undefined) fail(400, 'Choose an office name or sharing status.');
        if (input.appearance !== undefined && !isAppearance(input.appearance)) fail(400, 'Invalid office appearance.');
        const name = input.name === undefined ? String(current.name) : text(input.name, 'office name', 80);
        if (input.paused !== undefined && typeof input.paused !== 'boolean') fail(400, 'Invalid sharing status.');
        const paused = input.paused === undefined ? Number(current.paused) : Number(input.paused);
        // Pausing removes the snapshot; resuming cannot accidentally republish old activity.
        run('UPDATE offices SET name=?,paused=?,agents=CASE WHEN ?=1 THEN \'[]\' ELSE agents END,updated=CASE WHEN ?=1 THEN NULL ELSE updated END WHERE id=?', name, paused, paused, paused, String(office.id));
        if (input.appearance !== undefined) run('INSERT INTO appearance VALUES(?,?) ON CONFLICT(office) DO UPDATE SET value=excluded.value', String(office.id), JSON.stringify({ theme: input.appearance.theme, layout: input.appearance.layout, lighting: input.appearance.lighting }));
        return reply(200, session(user));
      }
      if (match('/publish', ['POST'])) {
        const input = await authorizedBody();
        if (!Array.isArray(input.agents) || input.agents.length > 24) fail(400, 'Publish up to 24 agents.');
        const seen = new Set<string>();
        const agents = input.agents.map((value, i) => {
          const agent = object(value);
          const id = text(agent.id, 'agent ID', 100);
          if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail(400, 'Use opaque alphanumeric agent IDs.');
          if (seen.has(id) || !providers.has(String(agent.provider)) || !statuses.has(String(agent.status))) fail(400, 'Invalid or duplicate agent.');
          seen.add(id);
          return { id, name: `Agent ${i + 1}`, provider: String(agent.provider), status: String(agent.status) };
        });
        // Re-read after consuming the request so a concurrent pause is respected.
        if (ownOffice(user).paused) fail(409, 'Sharing is paused. Resume before publishing.');
        run('UPDATE offices SET agents=?,updated=? WHERE owner=?', JSON.stringify(agents), now(), user.id);
        return reply(200, { ok: true, agentCount: agents.length });
      }
      if (match('/characters', ['GET'])) return reply(200, { characters: characters(office) });
      const characterMatch = route.match(/^\/characters\/([a-zA-Z0-9_-]+)$/);
      if (characterMatch) {
        if (method !== 'POST') fail(405, 'Method not allowed.');
        const input = await authorizedBody();
        const current = ownOffice(user);
        const id = characterMatch[1];
        const exists = characters(current).some((a) => a.id === id) || one('SELECT agent FROM characters WHERE office=? AND agent=?', String(current.id), id);
        if (!exists) fail(404, 'Character not found in your office.');
        if (input.style !== undefined && !isCharacterStyle(input.style)) fail(400, 'Choose a valid character style.');
        const name = text(input.name, 'character name', 32);
        if (/[\u0000-\u001f\u007f]/.test(name)) fail(400, 'Use a visible character name.');
        if (typeof input.area !== 'string' || !areas.has(input.area)) fail(400, 'Choose a valid work area.');
        if (!one('SELECT agent FROM characters WHERE office=? AND agent=?', String(current.id), id) && Number(one('SELECT COUNT(*) AS count FROM characters WHERE office=?', String(current.id))!.count) >= 256) fail(409, 'This office has reached its character profile limit.');
        run('INSERT INTO characters VALUES(?,?,?,?) ON CONFLICT(office,agent) DO UPDATE SET name=excluded.name,area=excluded.area', String(current.id), id, name, input.area);
        if (input.style !== undefined) run('INSERT INTO character_styles VALUES(?,?,?) ON CONFLICT(office,agent) DO UPDATE SET value=excluded.value', String(current.id), id, JSON.stringify(cleanCharacterStyle(input.style)));
        return reply(200, { ok: true });
      }
      const officeMatch = route.match(/^\/offices\/([\w-]+)$/);
      if (officeMatch) {
        if (method !== 'GET') fail(405, 'Method not allowed.');
        const selected = one('SELECT * FROM offices WHERE id=?', officeMatch[1]);
        if (!selected) fail(404, 'Office not found.');
        const level = selected.owner === user.id ? 'owner' : one('SELECT scope FROM grants WHERE office=? AND user=?', officeMatch[1], user.id)?.scope;
        if (!level) fail(404, 'Office not found.');
        const summary = floor(selected, user, String(level));
        const visible = level === 'owner' || (level === 'activity' && summary.online);
        return reply(200, { office: summary, agents: visible ? characters(selected) : [] });
      }
      if (match('/invites', ['GET', 'POST'])) {
        if (method === 'GET') return reply(200, { invites: all('SELECT id,scope,expires AS expiresAt FROM invites WHERE office=? AND expires>? ORDER BY expires DESC', String(office.id), now()) });
        const input = await authorizedBody();
        const level = scope(input.scope);
        const raw = token();
        const expiresAt = now() + DAY;
        run('DELETE FROM invites WHERE expires<=?', now());
        if (Number(one('SELECT COUNT(*) AS count FROM invites WHERE office=?', String(office.id))!.count) >= 50) fail(409, 'Cancel an existing invitation before creating another.');
        run('INSERT INTO invites VALUES(?,?,?,?,?)', randomUUID(), hash(raw), String(office.id), level, expiresAt);
        return reply(201, { token: raw, expiresAt });
      }
      const inviteMatch = route.match(/^\/invites\/([\w-]+)$/);
      if (inviteMatch) {
        if (method !== 'DELETE') fail(405, 'Method not allowed.');
        await authorizedBody();
        const result = run('DELETE FROM invites WHERE id=? AND office=?', inviteMatch[1], String(office.id));
        if (!result.changes) fail(404, 'Invitation not found.');
        return reply(200, { ok: true });
      }
      if (match('/accept', ['POST'])) {
        const input = await authorizedBody();
        const raw = text(input.token, 'invitation', 100);
        db.exec('BEGIN IMMEDIATE');
        try {
          const invitation = one('SELECT * FROM invites WHERE token=? AND expires>?', hash(raw), now());
          if (!invitation) fail(404, 'Invitation is invalid, expired or already used.');
          if (invitation.office === office.id) fail(400, 'You already own this office.');
          run('INSERT INTO grants VALUES(?,?,?,?) ON CONFLICT(office,user) DO UPDATE SET scope=excluded.scope', randomUUID(), String(invitation.office), user.id, String(invitation.scope));
          run('DELETE FROM invites WHERE id=?', String(invitation.id));
          db.exec('COMMIT');
          return reply(200, { officeId: invitation.office });
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      if (match('/publisher-tokens', ['GET', 'POST'])) {
        if (method === 'GET') return reply(200, { tokens: all('SELECT id,expires AS expiresAt FROM publisher_tokens WHERE user=? AND expires>? ORDER BY expires DESC', user.id, now()) });
        await authorizedBody();
        run('DELETE FROM publisher_tokens WHERE expires<=?', now());
        if (Number(one('SELECT COUNT(*) AS count FROM publisher_tokens WHERE user=?', user.id)!.count) >= 10) fail(409, 'Revoke an existing publisher before creating another.');
        const id = randomUUID();
        const raw = token();
        const expiresAt = now() + 30 * DAY;
        run('INSERT INTO publisher_tokens VALUES(?,?,?,?)', id, hash(raw), user.id, expiresAt);
        return reply(201, { token: raw, id, expiresAt });
      }
      const publisherMatch = route.match(/^\/publisher-tokens\/([\w-]+)$/);
      if (publisherMatch) {
        if (method !== 'DELETE') fail(405, 'Method not allowed.');
        await authorizedBody();
        const result = run('DELETE FROM publisher_tokens WHERE id=? AND user=?', publisherMatch[1], user.id);
        if (!result.changes) fail(404, 'Publisher credential not found.');
        return reply(200, { ok: true });
      }
      if (match('/grants', ['GET'])) return reply(200, { grants: all('SELECT g.id,u.name AS userName,u.handle AS userHandle,g.scope FROM grants g JOIN users u ON u.id=g.user WHERE g.office=? ORDER BY u.name', String(office.id)) });
      const grantMatch = route.match(/^\/grants\/([\w-]+)$/);
      if (grantMatch) {
        if (method !== 'DELETE') fail(405, 'Method not allowed.');
        await authorizedBody();
        const result = run('DELETE FROM grants WHERE id=? AND office=?', grantMatch[1], String(office.id));
        if (!result.changes) fail(404, 'Access grant not found.');
        return reply(200, { ok: true });
      }
      fail(404, 'Building endpoint not found.');
    })().catch((e: unknown) => {
      if (res.destroyed || res.writableEnded) return;
      reply(e instanceof ApiError ? e.status : 500, { error: e instanceof ApiError ? e.message : 'The building could not complete that request.' });
    });
  };
  return { handle, close: () => db.close() };
}

export function buildingApi(options: { dbPath?: string } = {}): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    const api = createBuildingHandler(options);
    server.middlewares.use(api.handle);
    server.httpServer?.once('close', api.close);
  };
  return { name: 'office-building-api', configureServer: mount, configurePreviewServer: mount };
}
