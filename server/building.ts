import { githubLogin } from './github-login.ts';
import type { GitHubIdentityBroker } from './github-identity.ts';
import { humanSchema, humanRoute, revokeHumanAccess, leaveHumanRooms } from './humans.ts';
import { isCharacterStyle, cleanCharacterStyle } from '../src/character-style.ts';
import { DEFAULT_APPEARANCE, isAppearance, cleanAppearance } from '../src/appearance.ts';
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

export function createBuildingHandler(options: { dbPath?: string; now?: () => number; github?: GitHubIdentityBroker } = {}) {
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
    CREATE TABLE IF NOT EXISTS focus_sessions(id TEXT PRIMARY KEY, office TEXT NOT NULL UNIQUE REFERENCES offices(id), started INTEGER NOT NULL, ends INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS focus_members(session TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE, user TEXT NOT NULL REFERENCES users(id), quiet INTEGER NOT NULL, PRIMARY KEY(session,user));
    CREATE INDEX IF NOT EXISTS focus_members_user ON focus_members(user);
    CREATE TABLE IF NOT EXISTS moments(id TEXT PRIMARY KEY, office TEXT NOT NULL REFERENCES offices(id), title TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS moments_office_created ON moments(office,created);
    CREATE TABLE IF NOT EXISTS doorbell_prefs(user TEXT PRIMARY KEY REFERENCES users(id),enabled INTEGER NOT NULL,dnd INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS doorbell_requests(id TEXT PRIMARY KEY,requester TEXT NOT NULL REFERENCES users(id),host TEXT NOT NULL REFERENCES users(id),session TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,quiet INTEGER NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS doorbell_session ON doorbell_requests(session);
    CREATE TABLE IF NOT EXISTS doorbell_cooldown(requester TEXT NOT NULL,host TEXT NOT NULL,last INTEGER NOT NULL,PRIMARY KEY(requester,host));


  `);
  humanSchema(db);
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
    const previous=res.getHeader('Set-Cookie');const cookies=Array.isArray(previous)?previous:previous?[String(previous)]:[];
    res.setHeader('Set-Cookie', [...cookies,`building_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`]);
  };
  const startSession = (req: IncomingMessage, res: ServerResponse, user: User) => {
    const raw = token();
    run('DELETE FROM sessions WHERE expires<=?', now());
    run('INSERT INTO sessions VALUES(?,?,?)', hash(raw), user.id, now() + 7 * DAY);
    cookie(req, res, raw, 7 * DAY / 1000);
    if(options.github)identityRoutes.clearProof(req,res);
  };
  const floor = (office: Row, user: User, level: string) => {
    const isOwner = office.owner === user.id;
    const online = !office.paused && typeof office.updated === 'number' && now() - office.updated < STALE;
    const agents = characters(office);
    const visibleActivity = online && (isOwner || level === 'activity');
    const latestMoment = isOwner || level === 'activity' ? one('SELECT id,title,kind,created FROM moments WHERE office=? AND created>=? ORDER BY created DESC,id DESC LIMIT 1', String(office.id), now() - 7 * DAY) : undefined;
    const counts = new Map<string, number>();
    if (visibleActivity) for (const a of agents) counts.set(a.area, (counts.get(a.area) ?? 0) + 1);
    return {
      id: office.id, name: office.name,
      ownerName: one('SELECT name FROM users WHERE id=?', String(office.owner))!.name,
      isOwner, scope: isOwner ? 'owner' : level, online,
      ...(isOwner ? { paused: !!office.paused } : {}),
      ...(isOwner || level === 'activity' ? { appearance: appearance(office) } : {}),
      ...(latestMoment ? { moment: { id: latestMoment.id, title: latestMoment.title, kind: latestMoment.kind, createdAt: latestMoment.created } } : {}),
      updatedAt: office.updated, agentCount: isOwner || (level === 'activity' && online) ? agents.length : 0,
      areas: [...counts].map(([area, count]) => ({ area, count })),
    };
  };
  // Social information is explicitly entered/joined; it is never derived from agent work.
  const access = (officeId: string, user: User) => {
    const selected = one('SELECT owner FROM offices WHERE id=?', officeId);
    return selected?.owner === user.id ? 'owner' : one('SELECT scope FROM grants WHERE office=? AND user=?', officeId, user.id)?.scope;
  };
  const doorbellPref = (id:string) => {const r=one('SELECT enabled,dnd FROM doorbell_prefs WHERE user=?',id);return {enabled:!!r?.enabled,dnd:!!r?.dnd};};
  const pruneSocial = () => {
    run('DELETE FROM focus_sessions WHERE ends<=?', now());
    run('DELETE FROM doorbell_cooldown WHERE last<?',now()-DAY);
    run('DELETE FROM moments WHERE created<?', now() - 7 * DAY);
    run('DELETE FROM doorbell_requests WHERE expires<=? OR NOT EXISTS(SELECT 1 FROM focus_sessions f JOIN grants g ON g.office=f.office WHERE f.id=doorbell_requests.session AND g.user=doorbell_requests.requester)',now());
  };
  const focus = (row: Row, user: User) => {
    const officeId = String(row.office);
    const members = all(`SELECT u.id AS userId,u.name,m.quiet FROM focus_members m JOIN users u ON u.id=m.user JOIN offices o ON o.id=? WHERE m.session=? AND (o.owner=u.id OR EXISTS(SELECT 1 FROM grants g WHERE g.office=o.id AND g.user=u.id)) ORDER BY u.id`, officeId, String(row.id));
    const host = one('SELECT o.name AS officeName,u.id AS hostId,u.name AS hostName FROM offices o JOIN users u ON u.id=o.owner WHERE o.id=?', officeId)!;
    const isHost = host.hostId === user.id;
    const joined = members.some(m => m.userId === user.id);
    const bell = doorbellPref(String(host.hostId));
    return { doorbell:bell.dnd ? 'dnd' : bell.enabled ? 'approval' : 'open', id: row.id, officeId, officeName: host.officeName, hostId: host.hostId, hostName: host.hostName, startedAt: row.started, endsAt: row.ends, participantCount: members.length, participants: isHost || joined ? members.map(m => ({ userId: m.userId, name: m.name, quiet: !!m.quiet })) : [], isHost, joined };
  };
  const moment = (row: Row, user: User) => {
    const owner = one('SELECT o.name AS officeName,u.id AS ownerId,u.name AS ownerName FROM offices o JOIN users u ON u.id=o.owner WHERE o.id=?', String(row.office))!;
    return { id: row.id, officeId: row.office, officeName: owner.officeName, ownerName: owner.ownerName, title: row.title, kind: row.kind, createdAt: row.created, isOwner: owner.ownerId === user.id };
  };
  const quietInput = (value: unknown) => { if (typeof value !== 'boolean') fail(400, 'Choose a quiet preference.'); return value; };
  const activeMembership = (user: User) => one('SELECT f.id FROM focus_sessions f JOIN focus_members m ON m.session=f.id WHERE m.user=? AND f.ends>?', user.id, now());
  const rates = new Map<string, { until: number; count: number }>();
  const limitAuth = (req: IncomingMessage) => {
    for (const [key, value] of rates) if (value.until <= now()) rates.delete(key);
    const key = req.socket.remoteAddress ?? 'local';
    const current = rates.get(key) ?? { until: now() + 15 * 60_000, count: 0 };
    current.count++;
    rates.set(key, current);
    if (current.count > 20) fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
  };
  const identityRoutes=githubLogin(db,options.github,now);
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
      const localAuthContext=method==='POST'&&['/register','/login','/logout'].includes(route)?identityRoutes.localIntent(req,fail):null;
      if(await identityRoutes({req,res,route,method,body:()=>body(req),reply,fail,current:()=>{try{return authenticate(req);}catch(error){if(error instanceof ApiError&&error.status===401)return null;throw error;}},limit:()=>limitAuth(req),startSession:user=>startSession(req,res,user)}))return;
      if (match('/register', ['POST'])) {
        limitAuth(req);
        const authIntent=localAuthContext;
        const input = await body(req);identityRoutes.checkIntent(authIntent,fail);
        if(options.github){try{authenticate(req);fail(409,'An account is already signed in. Sign out first.');}catch(error){if(!(error instanceof ApiError&&error.status===401))throw error;}}
        const handle = text(input.handle, 'handle', 32, 3).toLowerCase();
        if (!/^[a-z0-9_-]+$/.test(handle)) fail(400, 'Use letters, numbers, underscores or hyphens for your handle.');
        const name = text(input.name, 'name', 60);
        const password = passwordInput(input.password);
        if (one('SELECT id FROM users WHERE handle=?', handle)) fail(409, 'That handle is already taken.');
        const salt = randomBytes(16).toString('hex');
        const key = (await derive(password, salt, 64)) as Buffer;identityRoutes.checkIntent(authIntent,fail);
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
        const authIntent=localAuthContext;
        const input = await body(req);identityRoutes.checkIntent(authIntent,fail);
        if(options.github){try{authenticate(req);fail(409,'An account is already signed in. Sign out first.');}catch(error){if(!(error instanceof ApiError&&error.status===401))throw error;}}
        const handle = text(input.handle, 'handle', 32, 3).toLowerCase();
        const password = passwordInput(input.password);
        const row = one('SELECT * FROM users WHERE handle=?', handle);
        const key = (await derive(password, row ? String(row.salt) : 'invalid-account-salt', 64)) as Buffer;identityRoutes.checkIntent(authIntent,fail);
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
        if (input.actorId !== undefined && input.actorId !== user.id) fail(409, 'Your account changed. Reopen this action before continuing.');
        return input;
      };
      const office = ownOffice(user);
      if(route==='/human'||route==='/rooms'||route.startsWith('/rooms/')){await humanRoute({db,now,user:()=>user,route,method,body:authorizedBody,reply,fail});return;}
      if (match('/session', ['GET'])) return reply(200, session(user));
      if (route.startsWith('/doorbell')) pruneSocial();
      if (route === '/social' || route === '/focus' || route.startsWith('/focus/') || route === '/moments' || route.startsWith('/moments/')) pruneSocial();
      if (match('/social', ['GET'])) {
        const sessions = all(`SELECT f.* FROM focus_sessions f JOIN offices o ON o.id=f.office WHERE o.owner=? OR EXISTS(SELECT 1 FROM grants g WHERE g.office=o.id AND g.user=?) ORDER BY f.started DESC`, user.id, user.id);
        const moments = all(`SELECT m.* FROM moments m JOIN offices o ON o.id=m.office WHERE o.owner=? OR EXISTS(SELECT 1 FROM grants g WHERE g.office=o.id AND g.user=? AND g.scope='activity') ORDER BY m.created DESC,m.id DESC LIMIT 20`, user.id, user.id);
        return reply(200, { viewerId: user.id, serverNow: now(), sessions: sessions.map(r => focus(r, user)), moments: moments.map(r => moment(r, user)) });
      }
      if (match('/doorbell', ['GET','POST'])) {
        if(method==='POST'){
          const input=await authorizedBody();pruneSocial();
          const selected=one('SELECT f.*,o.owner FROM focus_sessions f JOIN offices o ON o.id=f.office WHERE f.id=?',text(input.sessionId,'session',80));
          if(!selected||selected.owner===user.id||!access(String(selected.office),user))fail(404,'Session unavailable.');
          const pref=doorbellPref(String(selected.owner));if(!pref.enabled||pref.dnd)fail(409,'The doorbell is unavailable.');
          if(activeMembership(user))fail(409,'Leave your current focus session first.');
          const quiet=quietInput(input.quiet);
          if(one('SELECT last FROM doorbell_cooldown WHERE requester=? AND host=? AND last>?',user.id,String(selected.owner),now()-60_000))fail(429,'Wait one minute before ringing again.');
          if(Number(one("SELECT COUNT(*) AS count FROM doorbell_requests WHERE session=? AND status='pending'",String(selected.id))!.count)>=12)fail(429,'The doorbell is busy. Try later.');
          const id=randomUUID();run('INSERT INTO doorbell_requests VALUES(?,?,?,?,?,?,?,?)',id,user.id,String(selected.owner),String(selected.id),Number(quiet),now(),now()+120_000,'pending');
          run('INSERT INTO doorbell_cooldown VALUES(?,?,?) ON CONFLICT(requester,host) DO UPDATE SET last=excluded.last',user.id,String(selected.owner),now());
          return reply(201,{id});
        }
        const rows=all("SELECT r.*,u.name AS requesterName,h.name AS hostName,o.name AS officeName FROM doorbell_requests r JOIN users u ON u.id=r.requester JOIN users h ON h.id=r.host JOIN focus_sessions f ON f.id=r.session JOIN offices o ON o.id=f.office WHERE r.requester=? OR (r.host=? AND r.status='pending') ORDER BY r.created DESC",user.id,user.id);
        const project=(r:Row)=>({id:r.id,sessionId:r.session,requesterName:r.requesterName,hostName:r.hostName,officeName:r.officeName,quiet:!!r.quiet,expiresAt:r.expires,status:r.status});
        const sessions=all('SELECT f.*,o.owner FROM focus_sessions f JOIN offices o ON o.id=f.office JOIN grants g ON g.office=f.office WHERE g.user=? AND o.owner<>?',user.id,user.id).map(r=>({...focus(r,user)}));
        return reply(200,{viewerId:user.id,...doorbellPref(user.id),incoming:rows.filter(r=>r.host===user.id).map(project),outgoing:rows.filter(r=>r.requester===user.id).map(project),sessions});
      }
      if(match('/doorbell/settings',['POST'])){
        const input=await authorizedBody();if(typeof input.enabled!=='boolean'||typeof input.dnd!=='boolean')fail(400,'Choose doorbell and quiet settings.');
        run('INSERT INTO doorbell_prefs VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET enabled=excluded.enabled,dnd=excluded.dnd',user.id,Number(input.enabled),Number(input.dnd));
        if(!input.enabled||input.dnd)run("UPDATE doorbell_requests SET status='declined' WHERE host=? AND status='pending'",user.id);
        return reply(200,{ok:true});
      }
      const bellMatch=route.match(/^\/doorbell\/([\w-]+)(?:\/(accept|decline))?$/);
      if(bellMatch){
        const action=bellMatch[2];if(method!==(action?'POST':'DELETE'))fail(405,'Method not allowed.');
        await authorizedBody();pruneSocial();const r=one('SELECT * FROM doorbell_requests WHERE id=?',bellMatch[1]);
        if(!r||(action?r.host!==user.id:r.requester!==user.id))fail(404,'Request unavailable.');
        if(!action){run('DELETE FROM doorbell_requests WHERE id=?',String(r.id));return reply(200,{ok:true});}
        if(r.status!=='pending')fail(409,'Request already handled.');
        if(action==='decline'){run("UPDATE doorbell_requests SET status='declined' WHERE id=?",String(r.id));return reply(200,{ok:true});}
        const pref=doorbellPref(user.id);if(!pref.enabled||pref.dnd)fail(409,'The doorbell is silenced.');
        const f=one('SELECT * FROM focus_sessions WHERE id=?',String(r.session));const guest=one('SELECT id,handle,name FROM users WHERE id=?',String(r.requester)) as User;
        if(!f||!access(String(f.office),guest))fail(404,'Request unavailable.');
        const active=activeMembership(guest);if(active&&active.id!==f.id)fail(409,'Your friend is already in another session.');
        if(!active&&Number(one('SELECT COUNT(*) AS count FROM focus_members WHERE session=?',String(f.id))!.count)>=24)fail(409,'This session is full.');
        run('INSERT INTO focus_members VALUES(?,?,?) ON CONFLICT(session,user) DO NOTHING',String(f.id),guest.id,Number(r.quiet));
        run("UPDATE doorbell_requests SET status='accepted' WHERE id=?",String(r.id));return reply(200,{ok:true});
      }
      if (match('/focus', ['POST'])) {
        const input = await authorizedBody(); pruneSocial();
        if (input.minutes !== 25 && input.minutes !== 50) fail(400, 'Choose a 25 or 50 minute session.');
        const quiet = quietInput(input.quiet);
        if (activeMembership(user) || one('SELECT id FROM focus_sessions WHERE office=?', String(ownOffice(user).id))) fail(409, 'Leave or end your current focus session first.');
        const id = randomUUID(), officeId = String(ownOffice(user).id), started = now(), ends = started + input.minutes * 60_000;
        db.exec('BEGIN IMMEDIATE');
        try {
          run('INSERT INTO focus_sessions VALUES(?,?,?,?)', id, officeId, started, ends);
          run('INSERT INTO focus_members VALUES(?,?,?)', id, user.id, Number(quiet));
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        return reply(201, focus(one('SELECT * FROM focus_sessions WHERE id=?', id)!, user));
      }
      const focusMatch = route.match(/^\/focus\/([\w-]+)(?:\/(join|leave))?$/);
      if (focusMatch) {
        const action = focusMatch[2];
        if (method !== (action ? 'POST' : 'DELETE')) fail(405, 'Method not allowed.');
        const input = await authorizedBody(); pruneSocial();
        const selected = one('SELECT * FROM focus_sessions WHERE id=?', focusMatch[1]);
        if (!selected || !access(String(selected.office), user)) fail(404, 'Focus session not found.');
        const isHost = access(String(selected.office), user) === 'owner';
        if (!action) {
          if (!isHost) fail(404, 'Focus session not found.');
          run('DELETE FROM focus_sessions WHERE id=?', focusMatch[1]);
          return reply(200, { ok: true });
        }
        if (action === 'leave') {
          if (isHost) fail(409, 'End your hosted session instead of leaving it.');
          run('DELETE FROM focus_members WHERE session=? AND user=?', focusMatch[1], user.id);
          return reply(200, { ok: true });
        }
        const quiet = quietInput(input.quiet);
        const pref=doorbellPref(String(one('SELECT owner FROM offices WHERE id=?',String(selected.office))!.owner));
        if((pref.enabled||pref.dnd) && !isHost && !one('SELECT user FROM focus_members WHERE session=? AND user=?',String(selected.id),user.id))fail(403,'Ring the doorbell and wait for host approval.');
        const membership = activeMembership(user);
        if (membership && membership.id !== selected.id) fail(409, 'Leave or end your current focus session first.');
        if (!one('SELECT user FROM focus_members WHERE session=? AND user=?', focusMatch[1], user.id) && Number(one('SELECT COUNT(*) AS count FROM focus_members WHERE session=?', focusMatch[1])!.count) >= 24) fail(409, 'This focus session is full.');
        run('INSERT INTO focus_members VALUES(?,?,?) ON CONFLICT(session,user) DO UPDATE SET quiet=excluded.quiet', focusMatch[1], user.id, Number(quiet));
        return reply(200, focus(selected, user));
      }
      if (match('/moments', ['POST'])) {
        const input = await authorizedBody();
        const title = text(input.title, 'milestone title', 80);
        if (/[\u0000-\u001f\u007f]/.test(title)) fail(400, 'Use a visible milestone title.');
        if (!['shipped', 'milestone', 'helped'].includes(String(input.kind))) fail(400, 'Choose a milestone type.');
        const id = randomUUID(), officeId = String(ownOffice(user).id);
        run('INSERT INTO moments VALUES(?,?,?,?,?)', id, officeId, title, String(input.kind), now());
        // Bound each office and keep the newest publication even when timestamps tie.
        run('DELETE FROM moments WHERE office=? AND id<>? AND id NOT IN (SELECT id FROM moments WHERE office=? AND id<>? ORDER BY created DESC,id DESC LIMIT 19)', officeId, id, officeId, id);
        return reply(201, moment(one('SELECT * FROM moments WHERE id=?', id)!, user));
      }
      const momentMatch = route.match(/^\/moments\/([\w-]+)$/);
      if (momentMatch) {
        if (method !== 'DELETE') fail(405, 'Method not allowed.');
        await authorizedBody();
        if (!run('DELETE FROM moments WHERE id=? AND office=?', momentMatch[1], String(ownOffice(user).id)).changes) fail(404, 'Milestone not found.');
        return reply(200, { ok: true });
      }

      if (match('/logout', ['POST'])) {
        const authIntent=localAuthContext;await authorizedBody();identityRoutes.checkIntent(authIntent,fail);
        const raw = req.headers.cookie!.split(';').map((p) => p.trim()).find((p) => p.startsWith('building_session='))!.slice('building_session='.length);
        leaveHumanRooms(db,user.id);
        run('DELETE FROM sessions WHERE token=?', hash(raw));
        cookie(req, res, '', 0);
        if(options.github)identityRoutes.clearProof(req,res);
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
        if (input.appearance !== undefined) run('INSERT INTO appearance VALUES(?,?) ON CONFLICT(office) DO UPDATE SET value=excluded.value', String(office.id), JSON.stringify(cleanAppearance(input.appearance)));
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
        const revoked = one('SELECT user FROM grants WHERE id=? AND office=?', grantMatch[1], String(office.id));
        if(revoked)revokeHumanAccess(db,String(office.id),String(revoked.user));
        if (revoked) run('DELETE FROM focus_members WHERE user=? AND session IN (SELECT id FROM focus_sessions WHERE office=?)', String(revoked.user), String(office.id));
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

export function buildingApi(options: { dbPath?: string; github?: GitHubIdentityBroker } = {}): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    const api = createBuildingHandler(options);
    server.middlewares.use(api.handle);
    server.httpServer?.once('close', api.close);
  };
  return { name: 'office-building-api', configureServer: mount, configurePreviewServer: mount };
}
