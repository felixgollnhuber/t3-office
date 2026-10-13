import type { ToolKind } from './desk';
import type { Provider, Status } from './data';
import { INTERNS, NAMES, type AgentSource, type SourceEvent, type Thread, type TranscriptItem } from './source';
import type { Account, Pool, UsageGroup, UsageSource } from './usage';
import { S } from './i18n/t3';

/** A live thread from the local T3 Code app (via the dev server's /api/t3 bridge). */
export interface T3Thread extends Thread {
  /** opens the thread in T3's web UI (needs a paired browser session) */
  url: string;
  project: string;
  projectId: string;
  /** latest tool call, or that it is waiting on you */
  activity: string;
  /** first sentence of the latest assistant message */
  message: string;
  providerLabel: string;
  fullModel: string;
  runStatus: string;
  updatedAt: number;
  runStartedAt: number;
}

export interface T3Team {
  index: number;
  name: string;
  short: string;
  overflowOf: string | null;
  projects: { title: string; ids: string[]; threads: number }[];
}

/** The server sends tool calls as a code plus the raw value; the words are chosen here. */
interface WireLabel {
  code: string;
  v?: string;
}

function labelText(l: WireLabel | null | undefined): string {
  const v = l?.v ?? '';
  switch (l?.code) {
    case 'waiting':
      return S.waiting;
    case 'script':
      return S.script(v);
    case 'edit':
      return S.edit(v || S.file);
    case 'web':
      return S.web(v);
    case 'webSearch':
      return S.webSearch;
    case 'find':
      return S.find(v);
    case 'fileSearch':
      return S.fileSearch;
    case 'read':
      return S.read(v);
    case 'delegate':
      return v ? S.delegate(v) : S.delegates;
    case 'compact':
      return S.compacted;
  }
  return v;
}

/** the server's stand-in for the title of a project that no longer exists */
const UNKNOWN_PROJECT = '@unknown';
const projectName = (title: string) => (title.startsWith(UNKNOWN_PROJECT) ? S.unknownProject + title.slice(UNKNOWN_PROJECT.length) : title);

/** why the bridge could not answer, from the server's reason code */
function reasonText(code: string, detail = '') {
  if (code === 'db-missing') return S.dbMissing(detail);
  if (code === 'not-running') return S.notRunning(detail);
  if (code === 'no-runtime') return S.noRuntime;
  if (code === 'read-failed') return S.readFailed(detail);
  if (code === 'no-data') return S.noQuotaData;
  if (code === 'no-provider') return S.noProvider;
  return detail || code;
}

const CURSOR_NOTE: Record<string, string> = { autoPercentUsed: S.cursorAuto, apiPercentUsed: S.cursorApi };

interface WireEvent {
  id: string;
  kind: ToolKind | 'compact';
  label: WireLabel;
  at: number;
  /** a test run and how it went; `ok` is null while it runs or when the result can't be told */
  tests?: { cmd: string; ok: boolean | null };
}

interface WirePr {
  key: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'draft' | 'merged' | 'closed';
  checks: 'passing' | 'failing' | 'pending' | null;
  linkedAt: number;
}

interface WireTranscript {
  ok: boolean;
  items: { id: string; at: number; role: TranscriptItem['role']; text?: string; more?: boolean; by?: 'user' | 'agent'; kind?: TranscriptItem['kind']; label?: WireLabel; state?: 'running' | 'failed' }[];
}

/** a PR that was linked longer ago than this is old news when it first shows up */
const PR_FRESH = 10 * 60_000;
const prLabel = (p: WirePr) => `#${p.number}${p.title ? ` ${p.title}` : ''}`;

interface WireThread {
  id: string;
  title: string;
  provider: Provider;
  providerInstanceId: string;
  providerLabel: string;
  model: string;
  status: Status;
  runStatus: string;
  team: number;
  projectId: string;
  project: string;
  parentId: string | null;
  managerId: string | null;
  updatedAt: number;
  lastActiveAt: number;
  runStartedAt: number;
  toolCalls: number;
  files: number;
  context: number;
  cost: number;
  tps: number;
  activity: WireLabel;
  message: string;
  events: WireEvent[];
  prs?: WirePr[];
  url: string;
}

interface Snapshot {
  ok: boolean;
  reason?: string;
  fetchedAt: string;
  environmentId: string;
  webBase: string;
  teams: T3Team[];
  threads: WireThread[];
  boss: { id: string; reports: number; orders: { id: string; at: number; kind: 'launch' | 'send'; target: string; text: string }[] } | null;
  totals: { runs: number; tokens: number; cost: number; queued: number; running: number; waiting: number };
}

export interface T3Options {
  /** poll interval in seconds */
  interval?: number;
  /** hours of inactivity after which an unsettled thread drops out */
  hours?: number;
  /** desks in the whole office for root threads (the floor has 36 seats, a few stay spare) */
  seats?: number;
  internsPerParent?: number;
}

const PRIO: Record<Status, number> = { running: 0, waiting: 1, failed: 2, completed: 3, idle: 4 };
/** an id that just walked out is not re-seated before its old worker has left the building */
const COOLDOWN = 25_000;
/** a seated thread keeps its desk at least this long before it can be bumped by a busier one */
const MIN_STAY = 20_000;

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** claude-opus-5-5 -> opus 5.5, cursor-grok-4.5-fast -> grok 4.5-fast, default -> auto */
export function shortModel(model: string) {
  if (!model || model === 'default') return 'auto';
  return model
    .replace(/^(claude|cursor)-/, '')
    .replace(/-(\d+)-(\d+)(?=$|-)/, ' $1.$2')
    .slice(0, 18);
}

async function getJson<T>(url: string, timeout = 8000): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), cache: 'no-store' });
  const body = (await res.json()) as T & { ok?: boolean; reason?: string; detail?: string };
  if (!res.ok || body.ok === false) throw new Error(body.reason ? reasonText(body.reason, body.detail) : `HTTP ${res.status}`);
  return body;
}

/** true when the dev server can read a running local T3 Code app */
export async function detectT3(): Promise<boolean> {
  try {
    await getJson('/api/t3/status', 5000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Live T3 threads for the office. Polls /api/t3/threads, keeps at most `seats` root threads in the office
 * (busy threads bump idle ones), and turns snapshot differences into the same events the demo emits.
 */
export class T3Source implements AgentSource {
  private list: T3Thread[] = [];
  private fns: ((e: SourceEvent) => void)[] = [];
  private seen = new Map<string, Set<string>>();
  private seatedAt = new Map<string, number>();
  private leftAt = new Map<string, number>();
  private tpsTarget = new Map<string, number>();
  private queue: { at: number; e: SourceEvent }[] = [];
  private pending: Snapshot | null = null;
  private inflight = false;
  private pollT = 0;
  private clock = 0;
  private snap: Snapshot | null = null;
  private opts: Required<T3Options>;
  /** last fetch error, cleared on success; the office keeps showing the last good snapshot meanwhile */
  error: string | null = null;
  hidden = 0;
  private chief: T3Thread | null = null;
  private ordersSeen = new Set<string>();
  /** per thread: test runs whose result has been reported (or was already in when the thread was first seen) */
  private testsDone = new Map<string, Set<string>>();
  /** per thread: its pull requests as last seen, to tell what changed; outlives the thread's stay in the office */
  private prsSeen = new Map<string, Map<string, { state: WirePr['state']; checks: WirePr['checks'] }>>();

  private constructor(opts: T3Options) {
    this.opts = { interval: 3, hours: 12, seats: 32, internsPerParent: 6, ...opts };
  }

  /** resolves once the first snapshot is in, so the office can seat everyone at startup */
  static async connect(opts: T3Options = {}) {
    const s = new T3Source(opts);
    s.apply(await s.fetch(), true);
    return s;
  }

  subscribe(fn: (e: SourceEvent) => void) {
    this.fns.push(fn);
  }
  private emit(e: SourceEvent) {
    for (const f of this.fns) f(e);
  }
  threads(): T3Thread[] {
    return this.list;
  }
  thread(id: string) {
    return this.list.find((t) => t.id === id) ?? (this.chief?.id === id ? this.chief : undefined);
  }
  /** the orchestrator: the thread that launched or steers most of the others; it sits in the boss office */
  boss() {
    return this.chief;
  }
  teams(): T3Team[] {
    return (this.snap?.teams ?? []).map((t) => ({
      ...t,
      name: projectName(t.name),
      short: projectName(t.short),
      projects: t.projects.map((p) => ({ ...p, title: projectName(p.title) })),
    }));
  }
  totals() {
    const t = this.snap?.totals;
    return { runs: t?.runs ?? 0, tokens: t?.tokens ?? 0, cost: t?.cost ?? 0, queued: t?.queued ?? 0 };
  }
  get fetchedAt() {
    return this.snap ? Date.parse(this.snap.fetchedAt) : 0;
  }

  url(id: string) {
    return this.thread(id)?.url ?? null;
  }
  /** opens the thread in T3's web UI in a new tab; returns false when the id is unknown */
  openThread(id: string) {
    const url = this.url(id);
    if (!url) return false;
    window.open(url, '_blank', 'noopener');
    return true;
  }
  /** brings the T3 Code desktop app to the front (it has no URL scheme that selects a thread) */
  async focusApp() {
    const res = await fetch('/api/t3/focus', { method: 'POST' });
    return res.ok;
  }

  /** the latest part of the thread's conversation, oldest first */
  async transcript(id: string): Promise<TranscriptItem[]> {
    const w = await getJson<WireTranscript>(`/api/t3/thread?id=${encodeURIComponent(id)}`);
    return w.items.map((i) => ({
      id: i.id,
      at: i.at,
      role: i.role,
      text: i.label ? labelText(i.label) : (i.text ?? ''),
      ...(i.more ? { more: true } : {}),
      ...(i.by ? { by: i.by } : {}),
      ...(i.kind ? { kind: i.kind } : {}),
      ...(i.state ? { state: i.state } : {}),
    }));
  }

  /**
   * Finished test runs and pull request news of one thread (also the boss) as events. Whatever is already there
   * when the thread is first seen is the baseline and stays silent.
   */
  private happenings(w: WireThread, at: number) {
    const done = this.testsDone.get(w.id);
    const final = w.events.filter((e) => e.tests && e.tests.ok !== null);
    if (done) for (const e of final) if (!done.has(e.id)) this.queue.push({ at, e: { type: 'tests', id: w.id, ok: e.tests!.ok!, label: e.tests!.cmd } });
    this.testsDone.set(w.id, new Set(final.map((e) => e.id)));

    const before = this.prsSeen.get(w.id);
    const now = new Map((w.prs ?? []).map((p) => [p.key, { state: p.state, checks: p.checks }]));
    if (before) {
      for (const p of w.prs ?? []) {
        const was = before.get(p.key);
        const label = prLabel(p);
        if (!was && (p.state === 'open' || p.state === 'draft') && Date.now() - p.linkedAt < PR_FRESH) this.queue.push({ at, e: { type: 'pr', id: w.id, state: 'opened', label } });
        if (was && was.checks !== p.checks && (p.checks === 'passing' || p.checks === 'failing') && p.state !== 'closed') this.queue.push({ at, e: { type: 'ci', id: w.id, ok: p.checks === 'passing', label } });
        if (was && was.state !== 'merged' && p.state === 'merged') this.queue.push({ at: at + 0.6, e: { type: 'pr', id: w.id, state: 'merged', label } });
      }
    }
    this.prsSeen.set(w.id, now);
  }

  private fetch() {
    return getJson<Snapshot>(`/api/t3/threads?hours=${this.opts.hours}&seats=${this.opts.seats}`);
  }

  private poll() {
    if (this.inflight) return;
    this.inflight = true;
    this.fetch()
      .then((s) => {
        this.pending = s;
        this.error = null;
      })
      .catch((e: Error) => (this.error = e.message))
      .finally(() => (this.inflight = false));
  }

  update(dt: number) {
    this.clock += dt;
    this.pollT += dt;
    if (this.pollT >= this.opts.interval) {
      this.pollT = 0;
      this.poll();
    }
    if (this.pending) {
      const s = this.pending;
      this.pending = null;
      this.apply(s, false);
    }
    while (this.queue.length && this.queue[0].at <= this.clock) {
      const { e } = this.queue.shift()!;
      if (e.type !== 'order' && e.type !== 'add') {
        const t = this.thread(e.id);
        if (!t || t.settled) continue;
      }
      this.emit(e);
    }
    for (const t of this.list) {
      if (t.status !== 'running') {
        t.tps = Math.max(0, t.tps - dt * 80);
        continue;
      }
      // threads without token data (Cursor) still type at a plausible pace
      const target = this.tpsTarget.get(t.id) || 50 + (hash(t.id) % 90);
      const jitter = (Math.sin(this.clock * 0.7 + (hash(t.id) % 100)) + Math.sin(this.clock * 1.9)) * 0.12 * target;
      t.tps += (target + jitter - t.tps) * Math.min(1, dt * 1.5);
    }
  }

  /** which wire threads get a desk (or tag along as an intern) this round */
  private choose(snap: Snapshot) {
    const now = Date.now();
    const byId = new Map(snap.threads.map((t) => [t.id, t]));
    const current = new Map(this.list.filter((t) => !t.settled).map((t) => [t.id, t]));
    const cooling = (id: string) => !current.has(id) && now - (this.leftAt.get(id) ?? 0) < COOLDOWN;
    const rank = (a: WireThread, b: WireThread) => PRIO[a.status] - PRIO[b.status] || b.updatedAt - a.updatedAt;
    const teamFor = (w: WireThread) => current.get(w.id)?.team ?? w.team;

    const roots = snap.threads.filter((t) => !t.parentId && !cooling(t.id) && t.id !== snap.boss?.id);
    const all = [...roots].sort(rank);
    const keep = all.filter((t) => current.has(t.id));
    const wait = all.filter((t) => !current.has(t.id));
    // more seated than seats (e.g. a shrinking seat count): drop the quietest
    while (keep.length > this.opts.seats) keep.pop();
    while (keep.length < this.opts.seats && wait.length) keep.push(wait.shift()!);
    // a busy thread outside bumps an idle one that has had its desk for a while
    for (const w of wait) {
      if (w.status !== 'running' && w.status !== 'waiting') break;
      const idx = keep.map((k, i) => [k, i] as const).reverse().find(([k]) => (k.status === 'idle' || k.status === 'completed') && now - (this.seatedAt.get(k.id) ?? 0) > MIN_STAY)?.[1];
      if (idx === undefined) break;
      keep.splice(idx, 1, w);
    }
    for (const t of keep) t.team = teamFor(t);
    const chosen: WireThread[] = [...keep];

    const seated = new Set(chosen.map((t) => t.id));
    const interns = new Map<string, number>();
    // children after their parents; idle subagents have nothing to help with
    const depth = (t: WireThread) => {
      let d = 0;
      for (let c = t; c.parentId && d < 8; d++) c = byId.get(c.parentId) ?? { ...c, parentId: null };
      return d;
    };
    for (const t of snap.threads.filter((x) => x.parentId).sort((a, b) => depth(a) - depth(b) || rank(a, b))) {
      if (cooling(t.id) || !seated.has(t.parentId!) || t.status === 'idle') continue;
      const n = interns.get(t.parentId!) ?? 0;
      if (n >= this.opts.internsPerParent) continue;
      interns.set(t.parentId!, n + 1);
      seated.add(t.id);
      chosen.push(t);
    }
    this.hidden = snap.threads.length - chosen.length;
    return chosen;
  }

  private nameFor(w: WireThread) {
    const used = new Set(this.list.filter((t) => !t.settled).map((t) => t.name));
    const pool = w.parentId ? INTERNS : NAMES[w.provider] ?? NAMES.cursor;
    const start = hash(w.id) % pool.length;
    for (let i = 0; i < pool.length; i++) {
      const n = pool[(start + i) % pool.length];
      if (!used.has(n)) return n;
    }
    let k = 2;
    while (used.has(`${pool[start]} ${k}`)) k++;
    return `${pool[start]} ${k}`;
  }

  private create(w: WireThread): T3Thread {
    return {
      id: w.id,
      name: this.nameFor(w),
      title: w.title,
      provider: w.provider,
      model: shortModel(w.model),
      team: w.team,
      status: w.status,
      tps: 0,
      toolCalls: w.toolCalls,
      files: w.files,
      context: w.context,
      cost: w.cost,
      settled: false,
      ...(w.parentId ? { parentId: w.parentId } : {}),
      ...(w.managerId ? { managerId: w.managerId } : {}),
      url: w.url,
      project: projectName(w.project),
      projectId: w.projectId,
      lastActiveAt: w.lastActiveAt || w.updatedAt,
      activity: labelText(w.activity),
      message: w.message,
      providerLabel: w.providerLabel,
      fullModel: w.model,
      runStatus: w.runStatus,
      updatedAt: w.updatedAt,
      runStartedAt: w.runStartedAt,
    };
  }

  private updateChief(snap: Snapshot, initial: boolean, spread: number) {
    const b = snap.boss;
    const w = b ? snap.threads.find((t) => t.id === b.id) : undefined;
    if (!b || !w) {
      this.chief = null;
      return;
    }
    if (this.chief?.id !== w.id) this.chief = { ...this.create(w), name: w.title };
    const c = this.chief;
    Object.assign(c, {
      title: w.title, name: w.title, model: shortModel(w.model), fullModel: w.model, status: w.status, toolCalls: w.toolCalls, files: w.files,
      context: w.context, cost: w.cost, activity: labelText(w.activity), message: w.message, runStatus: w.runStatus, updatedAt: w.updatedAt, url: w.url,
      lastActiveAt: w.lastActiveAt || w.updatedAt,
    });
    this.happenings(w, this.clock + spread);
    c.tps = w.tps;
    const fresh = b.orders.filter((o) => !this.ordersSeen.has(o.id));
    for (const o of b.orders) this.ordersSeen.add(o.id);
    if (initial) return;
    // launches show up in the same poll as the newcomer: give them a moment to walk in
    fresh.forEach((o, i) => this.queue.push({ at: this.clock + (i / Math.max(1, fresh.length)) * spread + (o.kind === 'launch' ? 2.5 : 0), e: { type: 'order', id: c.id, target: o.target, kind: o.kind, text: o.text } }));
  }

  private apply(snap: Snapshot, initial: boolean) {
    this.snap = snap;
    const now = Date.now();
    const chosen = this.choose(snap);
    const keep = new Set(chosen.map((t) => t.id));

    // walk-outs first, so their names and desks are free for newcomers
    const leaving = this.list.filter((t) => !t.settled && !keep.has(t.id));
    const leavingIds = new Set(leaving.map((t) => t.id));
    for (const t of leaving) {
      t.settled = true;
      this.leftAt.set(t.id, now);
      this.seen.delete(t.id);
      // the office sends interns home together with their parent
      if (!t.parentId || !leavingIds.has(t.parentId)) this.emit({ type: 'settle', id: t.id });
    }
    if (leaving.length) setTimeout(() => (this.list = this.list.filter((t) => !t.settled)), 0);

    const spread = Math.max(0.5, this.opts.interval * 0.9);
    for (const w of chosen) {
      this.tpsTarget.set(w.id, w.tps);
      // after the tool calls of this round, so a test result follows the call that started it
      this.happenings(w, this.clock + spread);
      const t = this.list.find((x) => x.id === w.id && !x.settled);
      const ids = new Set(w.events.map((e) => e.id));
      if (!t) {
        const fresh = this.create(w);
        this.list.push(fresh);
        this.seatedAt.set(w.id, now);
        this.seen.set(w.id, ids);
        if (!initial) this.emit({ type: 'add', thread: fresh });
        continue;
      }
      t.title = w.title;
      t.model = shortModel(w.model);
      t.fullModel = w.model;
      t.toolCalls = w.toolCalls;
      t.files = w.files;
      t.context = w.context;
      t.cost = w.cost;
      t.activity = labelText(w.activity);
      t.message = w.message;
      t.runStatus = w.runStatus;
      t.updatedAt = w.updatedAt;
      t.lastActiveAt = w.lastActiveAt || w.updatedAt;
      t.runStartedAt = w.runStartedAt;
      t.url = w.url;
      if (w.managerId) t.managerId = w.managerId;
      else delete t.managerId;
      if (t.status !== w.status) {
        const from = t.status;
        t.status = w.status;
        this.emit({ type: 'status', id: t.id, from, to: w.status });
      }
      const seen = this.seen.get(w.id) ?? new Set<string>();
      const fresh = w.events.filter((e) => !seen.has(e.id));
      fresh.forEach((e, i) => {
        const at = this.clock + (i / fresh.length) * spread;
        this.queue.push({ at, e: e.kind === 'compact' ? { type: 'compact', id: w.id } : { type: 'tool', id: w.id, kind: e.kind, label: labelText(e.label) } });
      });
      this.seen.set(w.id, ids);
    }
    this.updateChief(snap, initial, spread);
    this.queue.sort((a, b) => a.at - b.at);

    for (const [id, at] of this.leftAt) if (now - at > COOLDOWN * 4) this.leftAt.delete(id);
    for (const id of this.seatedAt.keys()) if (!keep.has(id)) this.seatedAt.delete(id);
  }
}

interface WireUsage {
  ok: boolean;
  fetchedAt: string;
  /** a pool's `note` is the id of the T3 window it explains */
  groups: { provider: Provider; label: string; checkedAt: string; pools: (Pool & { kind?: string })[] }[];
  missing: { provider: string; instanceId: string; reason: string; detail?: string }[];
}

/** Rate-limit pools as T3 shows them in its usage view (read from T3's provider caches, refreshed every 30 s). */
export class T3Usage implements UsageSource {
  private data: UsageGroup[] = [];
  private t = 0;
  private inflight = false;
  missing: WireUsage['missing'] = [];
  checkedAt: Partial<Record<Provider, number>> = {};
  error: string | null = null;

  private constructor(private interval: number) {}

  static async connect(interval = 30) {
    const u = new T3Usage(interval);
    await u.refresh().catch(() => {});
    return u;
  }

  groups() {
    return this.data;
  }

  update(dt: number, _running: Record<Provider, number>) {
    this.t += dt;
    if (this.t >= this.interval && !this.inflight) {
      this.t = 0;
      this.refresh().catch(() => {});
    }
  }

  async refresh() {
    this.inflight = true;
    try {
      const w = await getJson<WireUsage>('/api/t3/usage');
      this.data = w.groups.map((g) => ({
        provider: g.provider,
        label: g.label,
        pools: g.pools.map(
          (p): Pool => ({
            id: p.id,
            label: p.label,
            left: p.left,
            resetAt: p.resetAt,
            trend: p.trend,
            ...(p.delta ? { delta: p.delta } : {}),
            ...(p.note && CURSOR_NOTE[p.note] ? { note: CURSOR_NOTE[p.note] } : {}),
            ...(p.accounts ? { accounts: p.accounts.map((a): Account => ({ ...a })) } : {}),
          }),
        ),
      }));
      this.checkedAt = Object.fromEntries(w.groups.map((g) => [g.provider, Date.parse(g.checkedAt)]));
      this.missing = w.missing.map((m) => ({ ...m, reason: reasonText(m.reason, m.detail) }));
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
      throw e;
    } finally {
      this.inflight = false;
    }
  }
}
