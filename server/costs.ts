import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { open as openFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * GET /api/t3/costs?range=24h|7d|30d|90d — the numbers of T3 Code's Usage page.
 *
 * T3 does not take these from its orchestration database: its UsageService scans the
 * providers' native transcripts (~/.claude/projects, ~/.codex/sessions, …) and keeps the
 * parsed records in ~/.t3/userdata/usage-scan-cache-v5.json. This reads that cache, follows
 * transcripts that grew since T3 last wrote it (from the stored resume offset), and prices
 * the records the way T3 does (LiteLLM table in usage-model-rates.json, fast/priority tiers,
 * cache savings, de-duplication). Everything is read-only.
 *
 * Extra, not on T3's page: cost per project and the top threads, from the provider turns of
 * the threads T3 itself ran (statev2.sqlite, index lookups only).
 */

type Kind = 'claude' | 'codex' | 'grok' | 'cursor' | 'opencode' | 'antigravity';
type Speed = 'standard' | 'fast' | 'ultrafast';
type Row = Record<string, unknown>;

const T3_HOME = process.env.T3_HOME ?? join(homedir(), '.t3');
const USERDATA = join(T3_HOME, 'userdata');
const SCAN_CACHE = join(USERDATA, 'usage-scan-cache-v5.json');
const RATES = join(USERDATA, 'usage-model-rates.json');
const SETTINGS = join(USERDATA, 'settings.json');
const DB_PATH = join(USERDATA, 'statev2.sqlite');
const CLAUDE_DIR = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
const CODEX_DIR = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');

const H = 3_600_000, DAY = 24 * H;
const MTIME_SLACK = 1.5 * DAY;
const MAX_DAYS = 90;
const TTL = 45_000;
const MAX_READ = 256 * 1024 * 1024;
const LABEL: Record<Kind, string> = { claude: 'Claude Code', codex: 'Codex', grok: 'Grok Build', cursor: 'Cursor', opencode: 'OpenCode', antigravity: 'Antigravity' };
const RANGES: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
const PROJECT_ALIASES: Record<string, string> = { 'No project': 'Scratch' };

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
const parse = <T,>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};
const readText = (path: string) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------- pricing (as T3's usagePricing.ts)

interface TokenRates { input: number; output: number; cacheRead: number; cacheWrite: number }
interface Rate extends TokenRates { fast: TokenRates | null; ultrafast: TokenRates | null }
type Doc = Record<string, Record<string, unknown>>;

function tokenRates(e: Record<string, unknown>, suffix: string, std?: TokenRates): TokenRates | null {
  const input = finite(e[`input_cost_per_token${suffix}`]);
  const output = finite(e[`output_cost_per_token${suffix}`]);
  if (input === null || output === null) return null;
  // blank cache rates: plain input on the standard tier, the standard cache ratio on faster tiers
  const cache = (name: string, field: 'cacheRead' | 'cacheWrite') =>
    finite(e[`${name}${suffix}`]) ?? (std && std.input > 0 ? (std[field] / std.input) * input : input);
  return { input, output, cacheRead: cache('cache_read_input_token_cost', 'cacheRead'), cacheWrite: cache('cache_creation_input_token_cost', 'cacheWrite') };
}

const scale = (r: TokenRates, k: number): TokenRates => ({ input: r.input * k, output: r.output * k, cacheRead: r.cacheRead * k, cacheWrite: r.cacheWrite * k });
const sameTokens = (a: TokenRates | null, b: TokenRates | null) =>
  a === null || b === null ? a === b : a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead && a.cacheWrite === b.cacheWrite;
const bare = (key: string) => key.slice(key.lastIndexOf('/') + 1);

function rateTable(doc: Doc) {
  const table = new Map<string, Rate>();
  for (const [name, e] of Object.entries(doc)) {
    if (!e || typeof e !== 'object') continue;
    const std = tokenRates(e, '');
    const key = name.trim().toLowerCase();
    if (!std || !key) continue;
    const spec = e.provider_specific_entry as Record<string, unknown> | undefined;
    const mult = spec && typeof spec === 'object' ? finite(spec.fast) : null;
    table.set(key, { ...std, fast: mult && mult > 0 ? scale(std, mult) : tokenRates(e, '_priority', std), ultrafast: tokenRates(e, '_ultrafast', std) });
  }
  const alias = new Map<string, Rate | null>();
  for (const [key, r] of table) {
    const a = bare(key);
    if (!a || a === key || table.has(a)) continue;
    const held = alias.get(a);
    if (held === undefined) alias.set(a, r);
    else if (held && !(sameTokens(held, r) && sameTokens(held.fast, r.fast) && sameTokens(held.ultrafast, r.ultrafast))) alias.set(a, null);
  }
  for (const [a, r] of alias) if (r) table.set(a, r);
  return table;
}

interface Pricing {
  table: Map<string, Rate>;
  overrides: Map<string, Rate>;
  aliases: Map<string, string>;
  resolved: Map<string, Rate | null>;
  fetchedAt: number;
}

const UNPRICEABLE = new Set(['<synthetic>', 'synthetic', 'opus', 'sonnet', 'haiku', 'fable']);
let pricing: (Pricing & { key: string }) | null = null;

function loadPricing(): Pricing {
  let key = '';
  try {
    key = `${statSync(RATES).mtimeMs}:${existsSync(SETTINGS) ? statSync(SETTINGS).mtimeMs : 0}`;
  } catch {
    // no rate table: everything is unpriced
  }
  if (pricing && pricing.key === key) return pricing;
  const doc = parse<{ fetchedAtMs?: number; document?: Doc }>(readText(RATES));
  const settings = parse<{ usagePriceOverrides?: Record<string, Record<string, number>>; usageModelAliases?: Record<string, string> }>(readText(SETTINGS)) ?? {};
  const overrides = new Map<string, Rate>();
  for (const [model, p] of Object.entries(settings.usagePriceOverrides ?? {})) {
    const i = (p.inputCostPerMillionTokens ?? 0) / 1e6;
    overrides.set(model.trim(), {
      input: i,
      output: (p.outputCostPerMillionTokens ?? 0) / 1e6,
      cacheRead: (p.cacheReadCostPerMillionTokens ?? p.inputCostPerMillionTokens ?? 0) / 1e6,
      cacheWrite: (p.cacheWriteCostPerMillionTokens ?? p.inputCostPerMillionTokens ?? 0) / 1e6,
      fast: null,
      ultrafast: null,
    });
  }
  // a -> b -> c resolves to c; loops stay unmapped
  const raw = settings.usageModelAliases ?? {};
  const aliases = new Map<string, string>();
  for (const model of Object.keys(raw)) {
    const seen = new Set([model]);
    let target = raw[model];
    while (Object.hasOwn(raw, target) && !seen.has(target)) {
      seen.add(target);
      target = raw[target];
    }
    if (!Object.hasOwn(raw, target)) aliases.set(model, target);
  }
  pricing = { key, table: rateTable(doc?.document ?? {}), overrides, aliases, resolved: new Map(), fetchedAt: doc?.fetchedAtMs ?? 0 };
  return pricing;
}

function rateOf(p: Pricing, model: string): Rate | null {
  const o = p.overrides.get(model.trim());
  if (o) return o;
  let r = p.resolved.get(model);
  if (r === undefined) {
    let key = model.trim().toLowerCase();
    if (key.includes('[')) key = key.slice(0, key.indexOf('['));
    const b = bare(key);
    r = !b || UNPRICEABLE.has(b) ? null : (p.table.get(key) ?? null);
    p.resolved.set(model, r);
  }
  return r;
}

interface Tokens { u: number; c: number; w: number; o: number; r: number }

const byCategory = (t: Tokens, r: TokenRates) => ({ input: t.u * r.input, cacheRead: t.c * r.cacheRead, cacheWrite: t.w * r.cacheWrite, output: t.o * r.output });
const sum4 = (c: { input: number; cacheRead: number; cacheWrite: number; output: number }) => c.input + c.cacheRead + c.cacheWrite + c.output;
const at = (r: Rate, s: Speed): TokenRates => (s === 'standard' ? null : r[s]) ?? r;

function price(p: Pricing, model: string, t: Tokens, speed: Speed, reported: number | null) {
  const rate = rateOf(p, model);
  const rep = p.overrides.has(model.trim()) ? null : reported;
  if (!rate) return { cost: rep ?? 0, source: rep === null ? 'unpriced' : 'reported', cat: null, premium: 0, savings: 0 };
  const rates = at(rate, speed);
  const list = byCategory(t, rates);
  const listCost = sum4(list);
  const savings = t.c * (rates.input - rates.cacheRead);
  if (rep !== null && listCost <= 0) return { cost: rep, source: 'reported', cat: null, premium: 0, savings };
  const k = rep === null ? 1 : rep / listCost;
  const premium = speed === 'standard' ? 0 : listCost - sum4(byCategory(t, rate));
  return {
    cost: rep ?? listCost,
    source: rep === null ? 'priced' : 'reported',
    cat: { input: list.input * k, cacheRead: list.cacheRead * k, cacheWrite: list.cacheWrite * k, output: list.output * k },
    premium: premium * k,
    savings,
  };
}

// ---------------------------------------------------------------- transcript records

interface Rec extends Tokens {
  ts: number;
  model: string;
  session: string;
  key: string | null;
  cost: number | null;
  speed: Speed;
}

interface CodexState {
  model: string;
  speed: Speed;
  sessionId: string;
  lastUsageSignature: string | null;
  sawSessionMeta: boolean;
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}

const codexInitial = (): CodexState => ({ model: '', speed: 'standard', sessionId: '', lastUsageSignature: null, sawSessionMeta: false, suppressingForkCopies: false, forkCopyAnchorMs: 0 });
const tsOf = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);

function parseClaude(line: string): Rec | null {
  if (!line.includes('"usage"')) return null;
  const rec = obj(parse(line));
  if (!rec || rec.type !== 'assistant') return null;
  const msg = obj(rec.message);
  const usage = obj(msg?.usage);
  const ts = tsOf(rec.timestamp);
  const model = str(msg?.model);
  if (!msg || !usage || ts === null || !model) return null;
  const id = typeof msg.id === 'string' ? msg.id : null;
  const req = typeof rec.requestId === 'string' ? rec.requestId : null;
  return {
    ts,
    model,
    session: str(rec.sessionId),
    u: count(usage.input_tokens),
    c: count(usage.cache_read_input_tokens),
    w: count(usage.cache_creation_input_tokens),
    o: count(usage.output_tokens),
    r: 0,
    key: id === null && req === null ? null : `${id ?? ''}:${req ?? ''}`,
    cost: finite(rec.costUSD),
    speed: usage.speed === 'fast' ? 'fast' : 'standard',
  };
}

/** Codex token_count events carry no model or tier: both come from earlier lines, kept in `st`. */
function parseCodex(line: string, st: CodexState): Rec | null {
  if (!line.includes('"token_count"') && !line.includes('"turn_context"') && !line.includes('"thread_settings_applied"') && !line.includes('"session_meta"')) return null;
  const rec = obj(parse(line));
  const p = obj(rec?.payload);
  if (!rec || !p) return null;
  if (rec.type === 'session_meta') {
    if (st.sawSessionMeta) return null;
    st.sawSessionMeta = true;
    const id = p.id ?? p.session_id;
    if (typeof id === 'string') st.sessionId = id;
    const metaTs = tsOf(rec.timestamp);
    const spawn = obj(obj(obj(p.source)?.subagent)?.thread_spawn);
    if (metaTs !== null && (typeof p.forked_from_id === 'string' || typeof spawn?.parent_thread_id === 'string')) {
      st.suppressingForkCopies = true;
      st.forkCopyAnchorMs = metaTs;
    }
    return null;
  }
  if (rec.type === 'turn_context') {
    if (typeof p.model === 'string') st.model = p.model;
    return null;
  }
  if (p.type === 'thread_settings_applied') {
    const s = obj(p.thread_settings);
    if (s) st.speed = s.service_tier === 'priority' || s.service_tier === 'fast' ? 'fast' : s.service_tier === 'ultrafast' ? 'ultrafast' : 'standard';
    return null;
  }
  if (p.type !== 'token_count') return null;
  const last = obj(obj(p.info)?.last_token_usage);
  const ts = tsOf(rec.timestamp);
  if (!last || ts === null || !st.model) return null;
  const sig = JSON.stringify(last);
  if (sig === st.lastUsageSignature) return null;
  st.lastUsageSignature = sig;
  if (st.suppressingForkCopies) {
    // a fork opens with the parent's history re-stamped in one burst
    if (ts - st.forkCopyAnchorMs < 1000) {
      st.forkCopyAnchorMs = ts;
      return null;
    }
    st.suppressingForkCopies = false;
  }
  const input = count(last.input_tokens), c = count(last.cached_input_tokens), w = count(last.cache_write_input_tokens), o = count(last.output_tokens);
  const u = Math.max(0, input - c - w);
  if (u + c + w + o === 0) return null;
  return { ts, model: st.model, session: st.sessionId, u, c, w, o, r: Math.min(o, count(last.reasoning_output_tokens)), key: null, cost: null, speed: st.speed };
}

interface FileState {
  provider: Kind;
  size: number;
  mtime: number;
  offset: number;
  state: CodexState | null;
  records: Rec[];
  live: boolean;
}

/** Parses complete lines from `offset` on; returns the records and the offset after the last newline. */
async function readFrom(path: string, provider: Kind, offset: number, state: CodexState | null, size: number) {
  const out: Rec[] = [];
  const len = Math.min(size - offset, MAX_READ);
  if (len <= 0) return { records: out, offset, state };
  const fh = await openFile(path, 'r');
  try {
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, offset);
    const st = provider === 'codex' ? { ...(state ?? codexInitial()) } : null;
    let start = 0;
    for (;;) {
      const nl = buf.indexOf(10, start);
      if (nl < 0 || nl >= bytesRead) break;
      let end = nl;
      if (end > start && buf[end - 1] === 13) end--;
      if (end > start) {
        const line = buf.toString('utf8', start, end);
        const r = st ? parseCodex(line, st) : provider === 'claude' ? parseClaude(line) : null;
        if (r) out.push(r);
      }
      start = nl + 1;
    }
    return { records: out, offset: offset + start, state: st };
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- T3's scan cache

interface CachedFile { provider: Kind; size: number; mtime: number; offset: number; state: CodexState | null; records: Rec[]; tail: number }
let scanCache: { mtime: number; files: Map<string, CachedFile> } | null = null;

const SPEEDS: Speed[] = ['standard', 'fast', 'ultrafast'];

function loadScanCache() {
  let mtime = 0;
  try {
    mtime = statSync(SCAN_CACHE).mtimeMs;
  } catch {
    scanCache = { mtime: 0, files: new Map() };
    return scanCache;
  }
  if (scanCache && scanCache.mtime === mtime) return scanCache;
  type Doc5 = { version?: number; models?: string[]; sessions?: string[]; files?: Record<string, { s: number; m: number; p: Kind; r: unknown[][]; t: unknown[][]; o: number; cs: CodexState | null }> };
  const doc = parse<Doc5>(readText(SCAN_CACHE));
  const files = new Map<string, CachedFile>();
  if (doc && (doc.version ?? 0) >= 4 && Array.isArray(doc.models) && Array.isArray(doc.sessions) && doc.files) {
    const models = doc.models, sessions = doc.sessions;
    const decode = (rows: unknown[][]) => {
      const out: Rec[] = [];
      for (const row of rows) {
        const [ts, mi, si, u, c, w, o, r, key, cost, sp] = row as [number, number, number, number, number, number, number, number, string | null, number | null, number];
        const model = models[mi];
        if (typeof ts !== 'number' || model === undefined) continue;
        out.push({ ts, model, session: sessions[si] ?? '', u, c, w, o, r, key: typeof key === 'string' ? key : null, cost: typeof cost === 'number' ? cost : null, speed: SPEEDS[sp] ?? 'standard' });
      }
      return out;
    };
    for (const [path, e] of Object.entries(doc.files)) {
      if (!e || typeof e.s !== 'number' || !e.p || !Array.isArray(e.r)) continue;
      const tail = Array.isArray(e.t) ? decode(e.t) : [];
      files.set(path, { provider: e.p, size: e.s, mtime: e.m, offset: e.o ?? e.s, state: e.cs ?? null, records: [...decode(e.r), ...tail], tail: tail.length });
    }
  }
  scanCache = { mtime, files };
  live.clear();
  return scanCache;
}

// ---------------------------------------------------------------- file walk

const live = new Map<string, FileState>();

async function walk(dir: string, out: string[], depth = 0) {
  if (depth > 6) return;
  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
}

async function codexFiles(sinceMs: number) {
  const out: string[] = [];
  for (let t = sinceMs - DAY; t <= Date.now() + DAY; t += DAY) {
    const d = new Date(t);
    const dir = join(CODEX_DIR, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    try {
      for (const f of await readdir(dir)) if (f.endsWith('.jsonl')) out.push(join(dir, f));
    } catch {
      // no sessions that day
    }
  }
  return out;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

interface Corpus { files: { path: string; provider: Kind; records: Rec[] }[]; liveFiles: number; cacheAt: number; scanMs: number }

/** Every transcript record of the last ~90 days, file by file in T3's order (Claude first, then Codex, then the rest). */
async function collect(): Promise<Corpus> {
  const t0 = Date.now();
  const cache = loadScanCache();
  const sinceMs = Date.now() - MAX_DAYS * DAY - MTIME_SLACK;
  const claude: string[] = [];
  await walk(CLAUDE_DIR, claude);
  const codex = await codexFiles(sinceMs);
  const kindOf = new Map<string, Kind>();
  for (const p of claude) kindOf.set(p, 'claude');
  for (const p of codex) kindOf.set(p, 'codex');
  for (const [p, e] of cache.files) if (!kindOf.has(p)) kindOf.set(p, e.provider);
  const order: Kind[] = ['claude', 'codex', 'grok', 'cursor', 'opencode', 'antigravity'];
  const paths = [...kindOf.keys()].sort((a, b) => order.indexOf(kindOf.get(a)!) - order.indexOf(kindOf.get(b)!));

  const result = new Map<string, FileState>();
  await pool(paths, 16, async (path) => {
    const provider = kindOf.get(path)!;
    const cached = cache.files.get(path);
    let st: { size: number; mtimeMs: number } | null = null;
    try {
      st = await stat(path);
    } catch {
      // deleted transcript: T3 keeps its usage until retention expires
    }
    if (!st) {
      if (cached && cached.mtime >= sinceMs) result.set(path, { provider, size: cached.size, mtime: cached.mtime, offset: cached.offset, state: cached.state, records: cached.records, live: false });
      return;
    }
    if (st.mtimeMs < sinceMs) return;
    const prev = live.get(path);
    if (prev && prev.size === st.size && prev.mtime === st.mtimeMs) return void result.set(path, prev);
    if (provider !== 'claude' && provider !== 'codex') {
      if (cached) result.set(path, { provider, size: cached.size, mtime: cached.mtime, offset: cached.offset, state: cached.state, records: cached.records, live: false });
      return;
    }
    let base: FileState;
    if (prev && st.size > prev.size) base = prev;
    else if (cached && st.size >= cached.size) {
      // resume where T3 stopped; its tail records get re-read from the offset
      base = { provider, size: cached.size, mtime: cached.mtime, offset: cached.offset, state: cached.state, records: cached.records.slice(0, cached.records.length - cached.tail), live: false };
      if (st.size === cached.size && cached.tail === 0) {
        base.mtime = st.mtimeMs;
        live.set(path, base);
        return void result.set(path, base);
      }
    } else base = { provider, size: 0, mtime: 0, offset: 0, state: null, records: [], live: true };
    try {
      const r = await readFrom(path, provider, base.offset, base.state, st.size);
      const next: FileState = { provider, size: st.size, mtime: st.mtimeMs, offset: r.offset, state: r.state, records: r.records.length ? [...base.records, ...r.records] : base.records, live: base.live || r.records.length > 0 };
      live.set(path, next);
      result.set(path, next);
    } catch {
      if (cached) result.set(path, { provider, size: cached.size, mtime: cached.mtime, offset: cached.offset, state: cached.state, records: cached.records, live: false });
    }
  });
  for (const p of [...live.keys()]) if (!result.has(p)) live.delete(p);
  const files = paths.filter((p) => result.has(p)).map((p) => ({ path: p, provider: result.get(p)!.provider, records: result.get(p)!.records }));
  return { files, liveFiles: paths.filter((p) => result.get(p)?.live).length, cacheAt: cache.mtime, scanMs: Date.now() - t0 };
}

// ---------------------------------------------------------------- aggregation (as T3's UsageAggregator + client merge)

interface Cell { costUsd: number; totalTokens: number }

function dayFormatter(tz: string) {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const memo = new Map<number, string | null>();
  const Q = 900_000;
  return (ms: number) => {
    const slot = Math.floor(ms / Q);
    let d = memo.get(slot);
    if (d === undefined) {
      const a = f.format(new Date(slot * Q));
      d = a === f.format(new Date((slot + 1) * Q - 1)) ? a : null;
      memo.set(slot, d);
    }
    return d ?? f.format(new Date(ms));
  };
}

function aggregate(corpus: Corpus, range: string, tz: string) {
  const days = RANGES[range] ?? 30;
  const hourly = days === 1;
  const now = Date.now();
  const toDay = dayFormatter(tz);
  const today = toDay(now);
  const [y, m, d] = today.split('-').map(Number);
  const sinceDay = new Date(Date.UTC(y, m - 1, d - (days - 1))).toISOString().slice(0, 10);
  const untilTime = Math.floor(now / 60_000) * 60_000;
  const sinceTime = untilTime - DAY;
  const p = loadPricing();

  // Codex sessions split across files (forks, resumes) are de-duplicated by content
  const firstFile = new Map<string, number>();
  const shared = new Set<string>();
  corpus.files.forEach((f, i) => {
    if (f.provider !== 'codex') return;
    let prev = '';
    for (const r of f.records) {
      if (!r.session || r.session === prev) continue;
      prev = r.session;
      const first = firstFile.get(r.session);
      if (first === undefined) firstFile.set(r.session, i);
      else if (first !== i) shared.add(r.session);
    }
  });

  const seen = new Set<string>();
  const tot = { costUsd: 0, uncached: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, records: 0, unpriced: 0, reported: 0, savings: 0 };
  const cat = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  const speed = { fast: 0, ultrafast: 0, premium: 0 };
  const prov = new Map<Kind, { costUsd: number; totalTokens: number; records: number; sessions: Set<string> }>();
  const models = new Map<string, { provider: Kind; model: string; costUsd: number; totalTokens: number; records: number; unpricedRecords: number; uncached: number; cached: number; cacheWrite: number; output: number }>();
  const series = new Map<string, Cell & { byProvider: Partial<Record<Kind, Cell>> }>();
  const lowMs = (hourly ? sinceTime : Date.parse(`${sinceDay}T00:00:00Z`) - 15 * H) - DAY;

  for (const f of corpus.files) {
    const occ = new Map<string, number>();
    for (const rec0 of f.records) {
      let key = rec0.key;
      if (f.provider === 'codex' && shared.has(rec0.session)) {
        const k = JSON.stringify([f.provider, rec0.session, rec0.ts, rec0.model, [rec0.u, rec0.c, rec0.w, rec0.o, rec0.r]]);
        const n = (occ.get(k) ?? 0) + 1;
        occ.set(k, n);
        key = `${k}:${n}`;
      }
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      if (rec0.ts < lowMs) continue;
      let bucket: string;
      if (hourly) {
        if (rec0.ts < sinceTime || rec0.ts >= untilTime) continue;
        bucket = new Date(sinceTime + Math.floor((rec0.ts - sinceTime) / H) * H).toISOString();
      } else {
        const day = toDay(rec0.ts);
        if (day < sinceDay || day > today) continue;
        bucket = day;
      }
      const model = p.aliases.get(rec0.model) ?? rec0.model;
      const pr = price(p, model, rec0, rec0.speed, rec0.cost);
      const tokens = rec0.u + rec0.c + rec0.w + rec0.o;
      tot.costUsd += pr.cost;
      tot.uncached += rec0.u;
      tot.cached += rec0.c;
      tot.cacheWrite += rec0.w;
      tot.output += rec0.o;
      tot.reasoning += rec0.r;
      tot.records++;
      tot.savings += pr.savings;
      if (pr.source === 'unpriced') tot.unpriced++;
      if (pr.source === 'reported') tot.reported++;
      if (pr.cat) {
        cat.input += pr.cat.input;
        cat.cacheRead += pr.cat.cacheRead;
        cat.cacheWrite += pr.cat.cacheWrite;
        cat.output += pr.cat.output;
      }
      if (rec0.speed === 'fast') speed.fast += pr.cost;
      if (rec0.speed === 'ultrafast') speed.ultrafast += pr.cost;
      speed.premium += pr.premium;

      const pv = prov.get(f.provider) ?? { costUsd: 0, totalTokens: 0, records: 0, sessions: new Set<string>() };
      pv.costUsd += pr.cost;
      pv.totalTokens += tokens;
      pv.records++;
      if (rec0.session) pv.sessions.add(rec0.session);
      prov.set(f.provider, pv);

      const mk = `${f.provider}\0${model}`;
      const mv = models.get(mk) ?? { provider: f.provider, model, costUsd: 0, totalTokens: 0, records: 0, unpricedRecords: 0, uncached: 0, cached: 0, cacheWrite: 0, output: 0 };
      mv.costUsd += pr.cost;
      mv.totalTokens += tokens;
      mv.records++;
      if (pr.source === 'unpriced') mv.unpricedRecords++;
      mv.uncached += rec0.u;
      mv.cached += rec0.c;
      mv.cacheWrite += rec0.w;
      mv.output += rec0.o;
      models.set(mk, mv);

      const sv = series.get(bucket) ?? { costUsd: 0, totalTokens: 0, byProvider: {} };
      sv.costUsd += pr.cost;
      sv.totalTokens += tokens;
      const bp = (sv.byProvider[f.provider] ??= { costUsd: 0, totalTokens: 0 });
      bp.costUsd += pr.cost;
      bp.totalTokens += tokens;
      series.set(bucket, sv);
    }
  }

  const totalTokens = tot.uncached + tot.cached + tot.cacheWrite + tot.output;
  const keys: string[] = [];
  if (hourly) for (let t = sinceTime; t < untilTime; t += H) keys.push(new Date(t).toISOString());
  else for (let t = Date.parse(`${sinceDay}T00:00:00Z`); t <= Date.parse(`${today}T00:00:00Z`); t += DAY) keys.push(new Date(t).toISOString().slice(0, 10));
  // hourly buckets start at the window start, not on the full hour
  const empty = () => ({ costUsd: 0, totalTokens: 0, byProvider: {} });
  const sessions = [...prov.values()].reduce((s, v) => s + v.sessions.size, 0);
  const providers = [...prov.entries()]
    .map(([provider, v]) => ({
      provider,
      label: LABEL[provider],
      costUsd: v.costUsd,
      totalTokens: v.totalTokens,
      records: v.records,
      sessions: v.sessions.size,
      costShare: tot.costUsd ? v.costUsd / tot.costUsd : 0,
      tokenShare: totalTokens ? v.totalTokens / totalTokens : 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    resolution: hourly ? 'hour' : 'day',
    timeZone: tz,
    sinceDay,
    untilDay: today,
    ...(hourly ? { sinceTime: new Date(sinceTime).toISOString(), untilTime: new Date(untilTime).toISOString() } : {}),
    totals: {
      costUsd: tot.costUsd,
      totalTokens,
      uncachedInputTokens: tot.uncached,
      cachedInputTokens: tot.cached,
      cacheCreationTokens: tot.cacheWrite,
      outputTokens: tot.output,
      reasoningTokens: tot.reasoning,
      records: tot.records,
      sessions,
      cacheSavingsUsd: tot.savings,
      unpricedShare: tot.records ? tot.unpriced / tot.records : 0,
      providerReportedShare: tot.records ? tot.reported / tot.records : 0,
    },
    categoryCost: { ...cat, unsplit: Math.max(0, tot.costUsd - sum4(cat)) },
    speedCost: { standard: Math.max(0, tot.costUsd - speed.fast - speed.ultrafast), fast: speed.fast, ultrafast: speed.ultrafast, premium: speed.premium },
    providers,
    models: [...models.values()]
      .map((v) => ({
        provider: v.provider,
        model: v.model,
        costUsd: v.costUsd,
        totalTokens: v.totalTokens,
        costShare: tot.costUsd ? v.costUsd / tot.costUsd : 0,
        tokenShare: totalTokens ? v.totalTokens / totalTokens : 0,
        unpriced: v.records > 0 && v.unpricedRecords === v.records,
        records: v.records,
        perMillion: v.totalTokens > 0 && v.unpricedRecords < v.records ? (v.costUsd / v.totalTokens) * 1e6 : null,
        cacheHit: v.uncached + v.cached + v.cacheWrite > 0 ? v.cached / (v.uncached + v.cached + v.cacheWrite) : null,
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens),
    series: keys.map((k) => ({ key: k, ...(series.get(k) ?? empty()) })),
  };
}

// ---------------------------------------------------------------- per project / thread, from T3's own turns

let db: DatabaseSync | null = null;

function openDb() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH, { readOnly: true, timeout: 1500 });
  db.exec('PRAGMA query_only = ON');
  return db;
}

function closeDb() {
  try {
    db?.close();
  } catch {
    // already closed
  }
  db = null;
}

function kindFor(instance: string, model: string): Kind {
  const i = instance.toLowerCase(), m = model.toLowerCase();
  if (i.startsWith('claude')) return 'claude';
  if (i.startsWith('codex')) return 'codex';
  if (i.startsWith('cursor')) return 'cursor';
  if (i.startsWith('grok')) return 'grok';
  if (i.startsWith('opencode')) return 'opencode';
  if (i.includes('antigravity') || i.includes('gemini')) return 'antigravity';
  if (/claude|opus|sonnet|haiku|fable/.test(m)) return 'claude';
  if (/gpt|codex/.test(m)) return 'codex';
  return 'cursor';
}

function threadCosts(range: string, tz: string) {
  const days = RANGES[range] ?? 30;
  const now = Date.now();
  let sinceMs: number;
  if (days === 1) sinceMs = Math.floor(now / 60_000) * 60_000 - DAY;
  else {
    // local midnight of the first day, like the transcript window
    const toDay = dayFormatter(tz);
    const [y, m, d] = toDay(now).split('-').map(Number);
    const startUtc = Date.UTC(y, m - 1, d - (days - 1));
    let t = startUtc - 14 * H;
    while (toDay(t) < new Date(startUtc).toISOString().slice(0, 10)) t += 15 * 60_000;
    sinceMs = t;
  }
  const since = new Date(sinceMs).toISOString();
  const runtime = parse<{ port?: number }>(readText(join(USERDATA, 'server-runtime.json')));
  const env = readText(join(USERDATA, 'environment-id')).trim();
  const webBase = `http://127.0.0.1:${runtime?.port ?? 3773}`;
  const p = loadPricing();
  const conn = openDb();
  const projects = new Map((conn.prepare('SELECT project_id, title FROM projection_projects').all() as Row[]).map((r) => [str(r.project_id), PROJECT_ALIASES[str(r.title)] ?? str(r.title)]));
  const ids = (conn.prepare('SELECT DISTINCT project_id FROM orchestration_v2_projection_threads').all() as Row[]).map((r) => str(r.project_id));
  const qThreads = conn.prepare(
    `SELECT thread_id, title, provider_instance_id, deleted_at,
            json_extract(payload_json, '$.modelSelection') AS ms, json_extract(payload_json, '$.lineage.parentThreadId') AS parent
       FROM orchestration_v2_projection_threads WHERE project_id = ? AND updated_at >= ?`,
  );
  const qTurns = conn.prepare(`SELECT completed_at, json_extract(payload_json, '$.turnTokenUsage') AS ttu FROM orchestration_v2_projection_provider_turns WHERE thread_id = ? AND completed_at >= ?`);

  const threads: { id: string; title: string; project: string; projectId: string; provider: Kind; model: string; costUsd: number; totalTokens: number; turns: number; lastAt: number; parentId: string | null; url: string | null }[] = [];
  for (const pid of ids) {
    for (const t of qThreads.all(pid, since) as Row[]) {
      const sel = parse<{ instanceId?: string; model?: string; options?: { id: string; value: unknown }[] }>(str(t.ms)) ?? {};
      const model = str(sel.model);
      const fast = sel.options?.some((o) => o.id === 'fastMode' && o.value === true) ?? false;
      let cost = 0, tokens = 0, turns = 0, lastAt = 0;
      for (const turn of qTurns.all(str(t.thread_id), since) as Row[]) {
        const u = parse<{ inputTokens?: number; cachedInputTokens?: number; cacheCreationTokens?: number; outputTokens?: number; reasoningTokens?: number }>(str(turn.ttu));
        if (!u) continue;
        const c = count(u.cachedInputTokens), w = count(u.cacheCreationTokens), o = count(u.outputTokens);
        const tk: Tokens = { u: Math.max(0, count(u.inputTokens) - c - w), c, w, o, r: count(u.reasoningTokens) };
        cost += price(p, p.aliases.get(model) ?? model, tk, fast ? 'fast' : 'standard', null).cost;
        tokens += tk.u + tk.c + tk.w + tk.o;
        turns++;
        lastAt = Math.max(lastAt, Date.parse(str(turn.completed_at)) || 0);
      }
      if (!turns) continue;
      const id = str(t.thread_id);
      threads.push({
        id,
        // empty title / project: the page fills in its own word for "untitled" / "unknown"
        title: str(t.title),
        project: projects.get(pid) ?? '',
        projectId: pid,
        provider: kindFor(str(t.provider_instance_id) || str(sel.instanceId), model),
        model,
        costUsd: cost,
        totalTokens: tokens,
        turns,
        lastAt,
        parentId: t.parent ? str(t.parent) : null,
        url: t.deleted_at || !env ? null : `${webBase}/${encodeURIComponent(env)}/${encodeURIComponent(id)}`,
      });
    }
  }
  const byProject = new Map<string, { id: string; title: string; threads: number; costUsd: number; totalTokens: number; providers: Partial<Record<Kind, number>> }>();
  for (const t of threads) {
    const key = t.project.toLowerCase();
    const v = byProject.get(key) ?? { id: t.projectId, title: t.project, threads: 0, costUsd: 0, totalTokens: 0, providers: {} };
    v.threads++;
    v.costUsd += t.costUsd;
    v.totalTokens += t.totalTokens;
    v.providers[t.provider] = (v.providers[t.provider] ?? 0) + t.costUsd;
    byProject.set(key, v);
  }
  threads.sort((a, b) => b.costUsd - a.costUsd);
  return {
    ok: true,
    costUsd: threads.reduce((s, t) => s + t.costUsd, 0),
    count: threads.length,
    projects: [...byProject.values()].sort((a, b) => b.costUsd - a.costUsd),
    threads: threads.slice(0, 25),
  };
}

// ---------------------------------------------------------------- plugin

function send(res: ServerResponse, code: number, body: string) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** GET /api/t3/costs?range=24h|7d|30d|90d[&tz=Europe/Vienna][&force=1] */
export function t3Costs(): Plugin {
  let corpus: { at: number; data: Promise<Corpus> } | null = null;
  const results = new Map<string, { at: number; body: string }>();
  const getCorpus = (force: boolean) => {
    if (!corpus || force || Date.now() - corpus.at > TTL) {
      const data = collect();
      corpus = { at: Date.now(), data };
      data.catch(() => {
        corpus = null;
      });
    }
    return corpus.data;
  };

  // the same API for `npm run dev` and for the built office (`npm start`, `vite preview`)
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.httpServer?.once('close', closeDb);
    server.middlewares.use('/api/t3/costs', async (req: IncomingMessage, res: ServerResponse) => {
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      const range = RANGES[q.get('range') ?? ''] ? q.get('range')! : '30d';
      const tz = q.get('tz') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const force = q.get('force') === '1';
      const key = `${range}|${tz}`;
      const hit = results.get(key);
      if (!force && hit && Date.now() - hit.at < TTL) return send(res, 200, hit.body);
      try {
        const c = await getCorpus(force);
        // failures go out as codes; the page words them in its own language
        let threads: ReturnType<typeof threadCosts> | { ok: false; code: 'db_missing' | 'threads_unreadable'; detail?: string };
        try {
          threads = existsSync(DB_PATH) ? threadCosts(range, tz) : { ok: false, code: 'db_missing' };
        } catch (e) {
          closeDb();
          threads = { ok: false, code: 'threads_unreadable', detail: (e as Error).message };
        }
        const pr = loadPricing();
        const body = JSON.stringify({
          ok: true,
          source: 't3',
          range,
          readAt: new Date().toISOString(),
          cacheAt: c.cacheAt ? new Date(c.cacheAt).toISOString() : null,
          liveFiles: c.liveFiles,
          scannedFiles: c.files.length,
          scanMs: c.scanMs,
          pricing: { fetchedAt: pr.fetchedAt ? new Date(pr.fetchedAt).toISOString() : null, knownModels: pr.table.size },
          ...aggregate(c, range, tz),
          t3: threads,
        });
        results.set(key, { at: Date.now(), body });
        send(res, 200, body);
      } catch (e) {
        send(res, 503, JSON.stringify({ ok: false, code: 'costs_unreadable', detail: (e as Error).message }));
      }
    });
  };

  return { name: 'office-t3-costs', configureServer: mount, configurePreviewServer: mount };
}
