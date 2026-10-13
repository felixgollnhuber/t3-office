import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Read-only bridge to the local T3 Code app.
 *
 * T3's own HTTP/WebSocket API needs a paired auth session, so this reads the server's
 * projection tables in ~/.t3/userdata/statev2.sqlite through a read-only, query_only
 * connection (WAL is honoured, nothing is ever written) plus the provider caches in
 * ~/.t3/caches/*.json, where T3 keeps the rate-limit windows it shows in its usage UI.
 * Every query goes through an index: the database is >10 GB and node:sqlite is synchronous.
 *
 * Language-neutral: anything the office shows as text leaves here as a code plus raw values
 * (see Label, the `reason` codes and UNKNOWN_PROJECT); src/t3source.ts turns those into words.
 */

type Provider = 'claude' | 'codex' | 'cursor' | 'gemini';
type Status = 'running' | 'waiting' | 'idle' | 'failed' | 'completed';
type ToolKind = 'terminal' | 'search' | 'edit' | 'web' | 'test';
type Row = Record<string, unknown>;

const T3_HOME = process.env.T3_HOME ?? join(homedir(), '.t3');
const USERDATA = join(T3_HOME, 'userdata');
const CACHES = join(T3_HOME, 'caches');
const DB_PATH = join(USERDATA, 'statev2.sqlite');

const MIN = 60_000, H = 60 * MIN;
const COMPLETED_FOR = 2 * MIN;
const FAILED_FOR = 30 * MIN;
const MAX_THREADS = 80;
const ACTIVE_RUN = ['queued', 'preparing', 'starting', 'running', 'waiting'];
const PROJECT_ALIASES: Record<string, string> = { 'No project': 'Scratch' };
/** stands in for the title of a project that no longer exists; the client shows its own word for it */
const UNKNOWN_PROJECT = '@unknown';

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : Number(v) || 0);
const ms = (v: unknown) => (v ? Date.parse(str(v)) || 0 : 0);
const json = <T,>(v: unknown): T | null => {
  if (typeof v !== 'string' || !v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
};
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// ---------------------------------------------------------------- runtime / files

interface Runtime {
  pid: number;
  port: number;
  origin: string;
  startedAt: string;
}

function readRuntime(): Runtime | null {
  return json<Runtime>(safeRead(join(USERDATA, 'server-runtime.json')));
}

function safeRead(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function alive(pid: number) {
  if (!pid) return false;
  try {
    // signal 0 only checks that the process exists
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function environmentId() {
  return safeRead(join(USERDATA, 'environment-id')).trim();
}

interface Availability {
  ok: boolean;
  /** 'db-missing' | 'not-running' | 'no-runtime', with the path or pid in `detail` */
  reason?: string;
  detail?: string;
  runtime: Runtime | null;
  running: boolean;
}

function availability(): Availability {
  const runtime = readRuntime();
  if (!existsSync(DB_PATH)) return { ok: false, reason: 'db-missing', detail: DB_PATH, runtime, running: false };
  const running = !!runtime && alive(runtime.pid);
  if (!running) return runtime ? { ok: false, reason: 'not-running', detail: String(runtime.pid), runtime, running } : { ok: false, reason: 'no-runtime', runtime, running };
  return { ok: true, runtime, running };
}

// ---------------------------------------------------------------- database

let db: DatabaseSync | null = null;

function open() {
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

function all(sql: string, ...params: (string | number | null)[]): Row[] {
  return open().prepare(sql).all(...params) as Row[];
}

function get(sql: string, ...params: (string | number | null)[]): Row | undefined {
  return open().prepare(sql).get(...params) as Row | undefined;
}

// ---------------------------------------------------------------- providers / rates

interface ProviderCache {
  instanceId: string;
  driver: string;
  displayName: string;
  enabled: boolean;
  status?: string;
  usageLimits?: {
    checkedAt?: string;
    windows?: { id: string; kind: string; label: string; usedPercent: number; windowDurationMins?: number; resetsAt?: string }[];
    resetCredits?: { availableCount?: number; nextExpiresAt?: string };
    unavailable?: { reason?: string };
  };
}

let providerCache: { at: number; list: ProviderCache[] } | null = null;

function providers(): ProviderCache[] {
  if (providerCache && Date.now() - providerCache.at < 5000) return providerCache.list;
  const list: ProviderCache[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(CACHES).filter((f) => f.endsWith('.json'));
  } catch {
    // no caches yet
  }
  for (const f of files) {
    const d = json<Partial<ProviderCache> & { models?: unknown }>(safeRead(join(CACHES, f)));
    if (!d || !d.driver) continue;
    list.push({
      instanceId: d.instanceId ?? f.replace(/\.json$/, ''),
      driver: d.driver,
      displayName: d.displayName ?? d.driver,
      enabled: d.enabled !== false,
      status: d.status,
      usageLimits: d.usageLimits,
    });
  }
  providerCache = { at: Date.now(), list };
  return list;
}

function providerFor(instanceId: string, model: string): Provider {
  const driver = providers().find((p) => p.instanceId === instanceId)?.driver ?? instanceId;
  const d = driver.toLowerCase();
  if (d.startsWith('claude')) return 'claude';
  if (d.startsWith('codex')) return 'codex';
  if (d.startsWith('cursor')) return 'cursor';
  if (d.includes('gemini') || d.includes('antigravity')) return 'gemini';
  const m = model.toLowerCase();
  if (m.includes('claude') || m.includes('opus') || m.includes('sonnet')) return 'claude';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('gpt') || m.includes('codex')) return 'codex';
  return 'cursor';
}

function providerLabel(instanceId: string) {
  return providers().find((p) => p.instanceId === instanceId)?.displayName ?? instanceId;
}

type Rate = { input_cost_per_token?: number; output_cost_per_token?: number; cache_read_input_token_cost?: number; cache_creation_input_token_cost?: number };
let rates: { mtime: number; doc: Record<string, Rate> } | null = null;

function rateFor(model: string): Rate | null {
  const path = join(USERDATA, 'usage-model-rates.json');
  try {
    const mtime = statSync(path).mtimeMs;
    if (!rates || rates.mtime !== mtime) rates = { mtime, doc: (json<{ document: Record<string, Rate> }>(safeRead(path))?.document ?? {}) as Record<string, Rate> };
  } catch {
    return null;
  }
  const doc = rates.doc;
  for (const k of [model, `openai/${model}`, `anthropic/${model}`, model.replace(/-fast$/, ''), model.replace(/\./g, '-')]) {
    const r = doc[k];
    if (r && typeof r.input_cost_per_token === 'number') return r;
  }
  return null;
}

interface TurnUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  outputTokens?: number;
}

/** API-list-price equivalent of one finished turn (the subscriptions don't bill per token). */
function turnCost(model: string, u: TurnUsage) {
  const r = rateFor(model);
  if (!r) return 0;
  const cached = u.cachedInputTokens ?? 0, created = u.cacheCreationTokens ?? 0;
  const fresh = Math.max(0, (u.inputTokens ?? 0) - cached - created);
  return (
    fresh * (r.input_cost_per_token ?? 0) +
    cached * (r.cache_read_input_token_cost ?? r.input_cost_per_token ?? 0) +
    created * (r.cache_creation_input_token_cost ?? r.input_cost_per_token ?? 0) +
    (u.outputTokens ?? 0) * (r.output_cost_per_token ?? 0)
  );
}

const freshTokens = (u: TurnUsage) => Math.max(0, (u.inputTokens ?? 0) - (u.cachedInputTokens ?? 0)) + (u.outputTokens ?? 0);

// ---------------------------------------------------------------- activity labels

interface ItemRow {
  id: string;
  type: string;
  status: string;
  at: number;
  tool: string;
  cmd: string;
  ipath: string;
  icmd: string;
  ipat: string;
  iurl: string;
  file: string;
  text: string;
  title: string;
  pattern: string;
  /** shell commands only: the process exit code where the provider reports one (Codex, Cursor), and the end of the output */
  exit: number | null;
  tail: string;
}

/** A tool call in neutral form: `raw` is shown as it is, every other code is worded by the client around `v`. */
interface Label {
  code: 'raw' | 'script' | 'edit' | 'web' | 'webSearch' | 'find' | 'fileSearch' | 'read' | 'waiting' | 'compact' | 'delegate';
  v?: string;
}
const raw = (v: string): Label => ({ code: 'raw', v });

/** the columns describe() needs; shared by the snapshot and the thread reader */
const ITEM_COLS = `turn_item_id AS id, type, status, updated_at AS at,
              json_extract(payload_json, '$.toolName') AS tool,
              CASE WHEN type = 'command_execution' THEN substr(json_extract(payload_json, '$.input'), 1, 600) END AS cmd,
              CASE WHEN type = 'command_execution' THEN json_extract(payload_json, '$.exitCode') END AS ec,
              CASE WHEN type = 'command_execution' THEN substr(json_extract(payload_json, '$.output'), -900) END AS tail,
              CASE WHEN type = 'dynamic_tool' THEN coalesce(json_extract(payload_json, '$.input.path'), json_extract(payload_json, '$.input.file_path'), json_extract(payload_json, '$.input.target_file')) END AS ipath,
              CASE WHEN type = 'dynamic_tool' THEN substr(json_extract(payload_json, '$.input.command'), 1, 600) END AS icmd,
              CASE WHEN type IN ('dynamic_tool', 'file_search') THEN substr(coalesce(json_extract(payload_json, '$.input.pattern'), json_extract(payload_json, '$.input.glob_pattern'), json_extract(payload_json, '$.input.query')), 1, 120) END AS ipat,
              CASE WHEN type = 'dynamic_tool' THEN substr(json_extract(payload_json, '$.input.url'), 1, 200) END AS iurl,
              json_extract(payload_json, '$.fileName') AS file,
              substr(coalesce(json_extract(payload_json, '$.title'), json_extract(payload_json, '$.input.title')), 1, 160) AS title,
              json_extract(payload_json, '$.patterns[0]') AS pattern`;

function itemRow(r: Row): ItemRow {
  return {
    id: str(r.id), type: str(r.type), status: str(r.status), at: ms(r.at), tool: str(r.tool), cmd: str(r.cmd), ipath: str(r.ipath), icmd: str(r.icmd),
    ipat: str(r.ipat), iurl: str(r.iurl), file: str(r.file), text: str(r.text), title: str(r.title), pattern: str(r.pattern),
    exit: typeof r.ec === 'number' || typeof r.ec === 'bigint' ? Number(r.ec) : null, tail: str(r.tail),
  };
}

/** the command as typed: without the provider's `/bin/zsh -lc "…"` wrapper and a leading `cd dir &&` */
function unwrap(cmd: string) {
  let c = cmd.trim();
  const m = c.match(/^\/bin\/(?:ba|z)?sh\s+-l?c\s+(["'])/);
  if (m) {
    c = c.slice(m[0].length);
    if (c.endsWith(m[1])) c = c.slice(0, -1);
  }
  return c.replace(/^cd\s+\S+\s*(&&|;)\s*/, '').trim();
}

function unwrapShell(cmd: string): Label {
  const c = unwrap(cmd).split('\n')[0].trim();
  const heredoc = c.match(/^(python3?|node|bash|sh|zsh|ruby)\b[^<]*<<-?\s*['"]?\w+['"]?\s*$/);
  return heredoc ? { code: 'script', v: heredoc[1] } : raw(c);
}

/** What one simple command (between `&&`, `;`, `|`) is, judged by the program it starts, not by words that merely occur in it. */
type Part = 'tests' | 'check' | 'search' | 'web' | 'edit' | null;

/** the words of a simple command without env assignments and wrappers like `env -i`, `npx`, `uv run`, `python -m`, `node path/to/bin` */
function words(part: string) {
  const w = part.trim().split(/\s+/).filter(Boolean);
  for (let guard = 0; guard < 12 && w.length; guard++) {
    const h = w[0];
    if (/^\w+=/.test(h)) w.shift();
    else if (/^(env|time|command|exec|sudo|nice|caffeinate|npx|bunx|uvx)$/.test(h)) {
      w.shift();
      while (w.length && /^-/.test(w[0])) w.shift();
    } else if (h === 'timeout') w.splice(0, 2);
    else if (/^(pnpm|yarn|bundle)$/.test(h) && /^(exec|dlx)$/.test(w[1] ?? '')) w.splice(0, 2);
    else if (h === 'bun' && w[1] === 'x') w.splice(0, 2);
    else if (/^(uv|poetry|pipenv|pdm|hatch|rye)$/.test(h) && w[1] === 'run') w.splice(0, 2);
    else if (/^python[\d.]*$/.test(h) && w.includes('-m')) w.splice(0, w.indexOf('-m') + 1);
    else if (h === 'node' && !w.includes('--test') && /[\/.]/.test(w.find((x, i) => i > 0 && !x.startsWith('-')) ?? '')) {
      // node node_modules/vitest/vitest.mjs run …
      w.shift();
      while (w.length && /^-/.test(w[0])) w.shift();
    } else break;
  }
  if (w.length) w[0] = basename(w[0]).replace(/\.(m?js|cjs|ts|py|sh)$/, '');
  return w;
}

const TEST_RUNNERS = /^(vitest|jest|pytest|py\.test|mocha|ava|phpunit|rspec|tox|nox|ctest|karma|bats|behave|unittest|nosetests|cypress|nextest)$/;
const CHECKERS = /^(tsc|vue-tsc|tsgo|eslint|biome|oxlint|ruff|mypy|pyright|swiftlint|golangci-lint|actionlint|shellcheck|stylelint)$/;
const TEST_SCRIPT = /^(t|tests?|e2e|spec|unit)$|(^|[:_.-])(tests?|e2e|spec|vitest|jest|playwright)([:_.-]|$)/;
const CHECK_SCRIPT = /(^|[:_.-])(typecheck|type-check|types|tsc|lint|check)([:_.-]|$)/;

function partKind(part: string): Part {
  const w = words(part);
  const head = w[0] ?? '';
  const args = w.slice(1).filter((x) => !x.startsWith('-'));
  const sub = args[0] ?? '';
  if (TEST_RUNNERS.test(head)) return 'tests';
  if (CHECKERS.test(head)) return 'check';
  if (head === 'playwright') return sub === 'test' ? 'tests' : null;
  if (head === 'xcodebuild') return args.some((a) => a === 'test' || a === 'test-without-building') ? 'tests' : null;
  if (head === 'node') return w.includes('--test') ? 'tests' : null;
  if (/^(npm|pnpm|yarn|bun)$/.test(head)) {
    // npm run -w pkg test:unit, pnpm --filter web test, yarn typecheck
    const script = w.slice(1).filter((x, i, a) => !x.startsWith('-') && !/^(-w|-F|-C|--filter|--workspace|--prefix|--dir|--cwd)$/.test(a[i - 1] ?? '') && !/^(run|run-script)$/.test(x))[0] ?? '';
    return TEST_SCRIPT.test(script) ? 'tests' : CHECK_SCRIPT.test(script) ? 'check' : null;
  }
  if (/^(cargo|go|swift|deno|dotnet|flutter|dart|mix|zig|rails|rake|mvn|mvnw|gradle|gradlew|make|just|turbo|nx|tuist|forge)$/.test(head)) {
    if (/^(tests?|nextest|spec|e2e)$/.test(sub) || (/^(turbo|nx)$/.test(head) && TEST_SCRIPT.test(args[1] ?? ''))) return 'tests';
    if (/^(check|clippy|vet|lint|typecheck)$/.test(sub)) return 'check';
    return null;
  }
  if (/^(rg|grep|find|fd|ls|cat|head|tail|tree|wc|ag|stat|file|jq)$/.test(head)) return head === 'cat' && />/.test(part) ? 'edit' : 'search';
  if (head === 'sed' || head === 'perl') return w.some((x) => /^-[a-z]*i/.test(x)) ? 'edit' : head === 'sed' ? 'search' : null;
  if (head === 'git') return sub === 'grep' ? 'search' : null;
  if (head === 'curl' || head === 'wget') return /(^|[\s'"])(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(part) ? null : 'web';
  return null;
}

interface Shell {
  kind: ToolKind;
  label: Label;
  /** set when the command ran tests: the test command itself and whether the exit status of the whole line is the test's */
  tests?: { cmd: string; exitCounts: boolean };
}

/** a shell command as an event; quoted text and heredoc bodies do not count, only the programs that are started */
export function shell(cmd: string): Shell {
  const l = unwrapShell(cmd);
  const label = l.code === 'raw' ? raw(clip(l.v ?? '', 42)) : l;
  // quoted strings keep their length, so the offsets below still point into the real text
  const full = unwrap(cmd);
  const heredoc = full.search(/<<-?\s*['"]?\w/);
  const text = heredoc >= 0 ? full.slice(0, full.indexOf('\n', heredoc) >= 0 ? full.indexOf('\n', heredoc) : full.length) : full;
  const masked = text.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (q) => 'Q'.repeat(q.length));
  const parts: { text: string; kind: Part; sep: string }[] = [];
  const re = /&&|\|\||;|\||\n/g;
  let from = 0;
  for (let m = re.exec(masked); ; m = re.exec(masked)) {
    const to = m ? m.index : masked.length;
    if (masked.slice(from, to).trim()) parts.push({ text: text.slice(from, to).trim(), kind: partKind(masked.slice(from, to)), sep: m ? m[0] : '' });
    if (!m) break;
    from = m.index + m[0].length;
  }
  const ti = parts.findIndex((p) => p.kind === 'tests');
  if (ti >= 0) {
    // `npm test | tail` or `npm test; echo done` hide the exit status of the tests; `a && npm test && b` does not
    const exitCounts = heredoc < 0 && parts.slice(ti).every((p) => p.sep === '' || p.sep === '&&');
    // the label is the test command without its environment: `A=1 env -i ./node_modules/.bin/vitest run x` -> `vitest run x`
    const bare = parts[ti].text.replace(/^(?:env(?:\s+-\S+)*\s+)?(?:\w+=(?:'[^']*'|"[^"]*"|\S*)\s+)*/, '').replace(/^(?:\.\/)?node_modules\/\.bin\//, '');
    return { kind: 'test', label, tests: { cmd: clip(bare || parts[ti].text, 42), exitCounts } };
  }
  if (parts.some((p) => p.kind === 'check')) return { kind: 'test', label };
  if (l.code !== 'raw') return { kind: 'terminal', label };
  const first = parts[0]?.kind;
  return { kind: first === 'search' || first === 'web' || first === 'edit' ? first : 'terminal', label };
}

const TESTS_FAILED = /\b[1-9]\d* (?:failed|failing|failures?)\b|^FAIL\b|--- FAIL|test result: FAILED|\*\* TEST FAILED \*\*|\bFAILED \(|Test run with .* failed|error: test failed|npm ERR! Test failed/m;
const TESTS_PASSED = /\b[1-9]\d* (?:passed|passing)\b|test result: ok|\*\* TEST SUCCEEDED \*\*|^ok\s+\S+\s+[\d(]|^PASS\b|^OK\b|Test run with .* passed|Executed \d+ tests?, with 0 failures|All tests passed/m;

/**
 * How a finished test run went: the exit status where it is the test's own, otherwise the runner's summary at the
 * end of the output. null while it runs, when it was cancelled, or when neither says anything.
 */
export function testResult(it: Pick<ItemRow, 'status' | 'exit' | 'tail'>, exitCounts: boolean): boolean | null {
  if (it.status !== 'completed' && it.status !== 'failed') return null;
  const exit = it.exit ?? (it.status === 'completed' ? 0 : 1);
  if (exitCounts) return exit === 0;
  const tail = it.tail.replace(/\x1b\[[0-9;]*m/g, '');
  if (TESTS_FAILED.test(tail)) return false;
  if (TESTS_PASSED.test(tail)) return true;
  return exit === 0 ? null : false;
}

function shortTool(name: string) {
  return name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, '').replace(/^[\w-]+\./, '');
}

interface Described {
  kind: ToolKind;
  label: Label;
  tests?: Shell['tests'];
}

/** Maps a turn item to an office event: the desk icon kind plus a short speech-bubble label. */
function describe(it: ItemRow): Described | 'compact' | null {
  switch (it.type) {
    case 'command_execution':
      return shell(it.cmd);
    case 'file_change':
      return { kind: 'edit', label: { code: 'edit', v: it.file ? basename(it.file) : '' } };
    case 'web_search': {
      let host = '';
      try {
        host = it.pattern ? new URL(it.pattern).host : '';
      } catch {
        host = clip(it.pattern, 30);
      }
      return { kind: 'web', label: host ? { code: 'web', v: host } : { code: 'webSearch' } };
    }
    case 'file_search':
      return { kind: 'search', label: it.ipat ? { code: 'find', v: clip(it.ipat, 30) } : { code: 'fileSearch' } };
    case 'compaction':
      return 'compact';
    case 'subagent':
      // handing work to a subagent; there is no desk icon for it, so it shows as a terminal call with its own wording
      return { kind: 'terminal', label: { code: 'delegate', v: clip(it.title, 36) } };
    case 'dynamic_tool': {
      const t = shortTool(it.tool);
      const lower = t.toLowerCase();
      if (/^(shell|bash|exec|terminal|run_terminal)/.test(lower) && it.icmd) return shell(it.icmd);
      if (/^(read|view|open)/.test(lower)) return { kind: 'search', label: it.ipath ? { code: 'read', v: basename(it.ipath) } : raw(t) };
      if (/(grep|glob|search|find|semantic)/.test(lower) && !/web/.test(lower)) return { kind: 'search', label: raw(it.ipat ? clip(`${t} "${it.ipat}"`, 42) : t) };
      if (/(write|edit|replace|patch|delete|notebook)/.test(lower)) return { kind: 'edit', label: { code: 'edit', v: basename(it.ipath || t) } };
      if (/^(delegate_task|t3_thread_launch|create_threads|task|agent)$/.test(lower)) return { kind: 'terminal', label: { code: 'delegate', v: clip(it.title, 36) } };
      // driving a browser or a device preview is hands-on work, not looking something up
      if (/^(browser_|preview_|device_|html_)/.test(lower)) return { kind: 'terminal', label: raw(clip(it.iurl ? `${t} ${it.iurl.replace(/^https?:\/\//, '')}` : t, 42)) };
      if (/(web|fetch|http|url|docs|firecrawl|context7)/.test(lower)) return { kind: 'web', label: raw(it.iurl ? clip(it.iurl.replace(/^https?:\/\//, ''), 40) : t) };
      return { kind: 'terminal', label: raw(clip(it.title || t, 42)) };
    }
  }
  return null;
}

// ---------------------------------------------------------------- teams

interface TeamSlot {
  index: number;
  owner: string | null;
}

/** Sticky project -> pod assignment for the life of the dev server, so workers don't swap pods between polls. */
const teamOf = new Map<string, number>();
const owners: TeamSlot[] = [0, 1, 2, 3].map((index) => ({ index, owner: null }));

function assignTeams(projects: { key: string; score: number; count: number }[]) {
  const present = new Set(projects.map((p) => p.key));
  for (const key of [...teamOf.keys()]) if (!present.has(key)) teamOf.delete(key);
  for (const slot of owners) if (slot.owner && !present.has(slot.owner)) slot.owner = null;
  // a pod whose owner left goes to its biggest guest
  for (const slot of owners) {
    if (slot.owner) continue;
    const guest = projects.filter((p) => teamOf.get(p.key) === slot.index).sort((a, b) => b.score - a.score)[0];
    if (guest) slot.owner = guest.key;
  }
  const load = [0, 0, 0, 0];
  for (const p of projects) if (teamOf.has(p.key)) load[teamOf.get(p.key)!] += p.count;
  for (const p of [...projects].sort((a, b) => b.score - a.score)) {
    if (teamOf.has(p.key)) continue;
    const free = owners.find((s) => !s.owner);
    const team = free ? free.index : load.indexOf(Math.min(...load));
    if (free) free.owner = p.key;
    teamOf.set(p.key, team);
    load[team] += p.count;
  }
}

// ---------------------------------------------------------------- command lines (who runs whom)

interface Order {
  id: string;
  at: number;
  kind: 'launch' | 'send';
  target: string;
  text: string;
}

/** Per thread: every thread it launched or messaged through the T3 MCP tools, scanned incrementally. */
const scans = new Map<string, { ordinal: number; launched: Map<string, number>; sent: Map<string, number>; orders: Order[] }>();

function commands(threadId: string) {
  let s = scans.get(threadId);
  if (!s) {
    s = { ordinal: -1, launched: new Map(), sent: new Map(), orders: [] };
    scans.set(threadId, s);
  }
  const rows = all(
    `SELECT turn_item_id AS id, ordinal, status, updated_at AS at, json_extract(payload_json, '$.toolName') AS tool,
            json_extract(payload_json, '$.input.threadId') AS tin,
            substr(coalesce(json_extract(payload_json, '$.input.message'), json_extract(payload_json, '$.input.prompt'), json_extract(payload_json, '$.input.title')), 1, 240) AS msg,
            json_extract(payload_json, '$.input.title') AS title,
            json_extract(payload_json, '$.output.structuredContent.threadId') AS tout,
            json_extract(payload_json, '$.output.structuredContent.threads') AS touts
       FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ? AND ordinal > ? AND type = 'dynamic_tool'
        AND (json_extract(payload_json, '$.toolName') LIKE '%t3_thread_launch'
          OR json_extract(payload_json, '$.toolName') LIKE '%t3_thread_send'
          OR json_extract(payload_json, '$.toolName') LIKE '%create_threads')
      ORDER BY ordinal`,
    threadId,
    s.ordinal,
  );
  let upTo = s.ordinal;
  for (const r of rows) {
    // still running: look at it again next time, unless it has been stuck for a while
    const open = !['completed', 'failed', 'cancelled', 'declined', 'interrupted'].includes(str(r.status));
    if (open && Date.now() - ms(r.at) < 10 * 60_000) break;
    upTo = num(r.ordinal);
    if (str(r.status) !== 'completed') continue;
    const tool = str(r.tool), at = ms(r.at);
    const push = (kind: Order['kind'], target: string, text: string) => {
      if (!target || target === threadId) return;
      (kind === 'launch' ? s!.launched : s!.sent).set(target, at);
      s!.orders.push({ id: `${str(r.id)}:${target}`, at, kind, target, text: clip(text.replace(/\s+/g, ' ').trim(), 120) });
    };
    if (tool.endsWith('t3_thread_launch')) push('launch', str(r.tout), str(r.title) || str(r.msg));
    else if (tool.endsWith('t3_thread_send')) push('send', str(r.tin), str(r.msg));
    else for (const t of json<{ threadId?: string; title?: string }[]>(r.touts) ?? []) push('launch', str(t.threadId), str(t.title));
  }
  s.ordinal = upTo;
  if (s.orders.length > 30) s.orders.splice(0, s.orders.length - 30);
  return s;
}

// ---------------------------------------------------------------- pull requests

type PrState = 'open' | 'draft' | 'merged' | 'closed';
type Checks = 'passing' | 'failing' | 'pending' | null;

interface PrOut {
  /** host/owner/repo#number */
  key: string;
  number: number;
  title: string;
  url: string;
  state: PrState;
  checks: Checks;
  linkedAt: number;
}

const prState = (state: string, draft: unknown): PrState => {
  const s = state.toLowerCase();
  return s === 'merged' || s === 'closed' ? s : draft ? 'draft' : 'open';
};
const checksOf = (v: string): Checks => {
  const s = v.toLowerCase();
  if (/^(passing|passed|success)$/.test(s)) return 'passing';
  if (/^(failing|failed|failure|error)$/.test(s)) return 'failing';
  return /^(pending|running|expected|queued|in_progress)$/.test(s) ? 'pending' : null;
};

/** PR state straight from GitHub, newer than the snapshot T3 keeps; filled by refreshPrs */
const ghPrs = new Map<string, { at: number; state: PrState; checks: Checks }>();
const ghSync = { at: 0, busy: false, offUntil: 0 };
const GH_EVERY = 60_000;
const GH_MAX = 24;

/** The PRs T3 has linked to a thread (its agents link them, T3 keeps a snapshot of each), newest first. */
function pullRequests(threadId: string): PrOut[] {
  const rows = all(
    `SELECT host, repository, number, url, linked_at,
            json_extract(snapshot_json, '$.state') AS state, json_extract(snapshot_json, '$.isDraft') AS draft,
            json_extract(snapshot_json, '$.checksState') AS checks, json_extract(snapshot_json, '$.syncedAt') AS synced,
            substr(json_extract(snapshot_json, '$.title'), 1, 80) AS title
       FROM projection_thread_pull_requests WHERE thread_id = ?`,
    threadId,
  );
  return rows
    .map((r): PrOut => {
      const key = `${str(r.host)}/${str(r.repository)}#${num(r.number)}`;
      const gh = ghPrs.get(key);
      const fresh = gh && gh.at > ms(r.synced) ? gh : null;
      return {
        key,
        number: num(r.number),
        title: str(r.title),
        url: str(r.url),
        state: fresh?.state ?? prState(str(r.state), r.draft),
        checks: fresh ? fresh.checks : checksOf(str(r.checks)),
        linkedAt: ms(r.linked_at),
      };
    })
    .sort((a, b) => b.linkedAt - a.linkedAt)
    .slice(0, 8);
}

/**
 * Asks GitHub for the state and check status of the open PRs in the office: one batched `gh api graphql` call, at
 * most once a minute, in the background. Without gh, or without a login, this stays off and T3's snapshot is all there is.
 */
function refreshPrs(prs: PrOut[]) {
  const now = Date.now();
  if (ghSync.busy || now < ghSync.offUntil || now - ghSync.at < GH_EVERY) return;
  const want = new Map<string, { owner: string; repo: string; number: number }>();
  for (const p of prs) {
    if (p.state !== 'open' && p.state !== 'draft') continue;
    const m = p.key.match(/^github\.com\/([\w.-]+)\/([\w.-]+)#(\d+)$/);
    if (m && want.size < GH_MAX) want.set(p.key, { owner: m[1], repo: m[2], number: Number(m[3]) });
  }
  for (const key of ghPrs.keys()) if (!prs.some((p) => p.key === key)) ghPrs.delete(key);
  if (!want.size) return;
  ghSync.at = now;
  ghSync.busy = true;
  const keys = [...want.keys()];
  const query = `query {${keys
    .map((k, i) => {
      const p = want.get(k)!;
      return ` p${i}: repository(owner: "${p.owner}", name: "${p.repo}") { pullRequest(number: ${p.number}) { state isDraft commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }`;
    })
    .join('')} }`;
  execFile('gh', ['api', 'graphql', '-f', `query=${query}`], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 }, (err, out) => {
    ghSync.busy = false;
    type Node = { pullRequest?: { state?: string; isDraft?: boolean; commits?: { nodes?: { commit?: { statusCheckRollup?: { state?: string } | null } }[] } } | null } | null;
    // a repository gh may not see fails the call but still answers for the others
    const data = json<{ data?: Record<string, Node> }>(out)?.data;
    if (!data) {
      // no gh, not logged in, offline: try again much later, and never when the binary is missing
      ghSync.offUntil = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT' ? Infinity : Date.now() + 10 * MIN;
      return;
    }
    keys.forEach((k, i) => {
      const pr = data[`p${i}`]?.pullRequest;
      if (!pr?.state) return;
      ghPrs.set(k, { at: Date.now(), state: prState(pr.state, pr.isDraft), checks: checksOf(str(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state)) });
    });
  });
}

// ---------------------------------------------------------------- thread reader

interface TranscriptItem {
  id: string;
  at: number;
  role: 'user' | 'assistant' | 'tool' | 'note';
  /** messages: the text, cut to MESSAGE_CHARS (`more` says so) */
  text?: string;
  more?: boolean;
  /** user messages: typed by the user, or sent by another thread */
  by?: 'user' | 'agent';
  /** tool calls: one line, worded by the client; notes: 'compact' or 'error' */
  kind?: ToolKind | 'compact' | 'error';
  label?: Label;
  state?: 'running' | 'failed';
}

const MESSAGE_CHARS = 1400;
const READER_TYPES = ['user_message', 'assistant_message', 'command_execution', 'dynamic_tool', 'file_change', 'web_search', 'file_search', 'compaction', 'subagent', 'error'];

/** The last `limit` things that happened in one thread, oldest first: messages in (capped) full, tool calls as one line each. */
function transcript(threadId: string, limit: number) {
  const head = get(`SELECT title, updated_at FROM orchestration_v2_projection_threads WHERE thread_id = ? AND deleted_at IS NULL`, threadId);
  if (!head) return null;
  const rows = all(
    `SELECT ${ITEM_COLS},
            CASE WHEN type IN ('assistant_message', 'user_message') THEN substr(json_extract(payload_json, '$.text'), 1, ${MESSAGE_CHARS + 1})
                 WHEN type = 'error' THEN substr(json_extract(payload_json, '$.failure.message'), 1, 300) END AS text,
            json_extract(payload_json, '$.createdBy') AS author,
            coalesce(json_extract(payload_json, '$.startedAt'), updated_at) AS started
       FROM orchestration_v2_projection_turn_items
      WHERE thread_id = ? AND type IN (${READER_TYPES.map(() => '?').join(',')})
      ORDER BY ordinal DESC LIMIT ?`,
    threadId,
    ...READER_TYPES,
    limit,
  );
  const items: TranscriptItem[] = [];
  for (const r of rows.reverse()) {
    const it = itemRow(r);
    const at = ms(r.started) || it.at;
    if (it.type === 'user_message' || it.type === 'assistant_message') {
      const text = it.text.trim();
      if (!text) continue;
      const more = text.length > MESSAGE_CHARS;
      items.push({
        id: it.id, at, role: it.type === 'user_message' ? 'user' : 'assistant', text: more ? text.slice(0, MESSAGE_CHARS) : text, ...(more ? { more } : {}),
        ...(it.type === 'user_message' ? { by: str(r.author) === 'user' ? ('user' as const) : ('agent' as const) } : {}),
      });
      continue;
    }
    if (it.type === 'error') {
      items.push({ id: it.id, at, role: 'note', kind: 'error', text: clip(it.text || it.title, 300) });
      continue;
    }
    const d = describe(it);
    if (!d) continue;
    if (d === 'compact') {
      items.push({ id: it.id, at, role: 'note', kind: 'compact' });
      continue;
    }
    // a search that finds nothing exits with 1; that is an answer, not a failure
    const failed = d.tests ? testResult(it, d.tests.exitCounts) === false : d.kind !== 'search' && (it.status === 'failed' || (it.exit ?? 0) !== 0);
    const state = failed ? 'failed' : ['completed', 'failed', 'cancelled', 'declined', 'interrupted'].includes(it.status) ? undefined : 'running';
    items.push({ id: it.id, at, role: 'tool', kind: d.kind, label: d.label, ...(state ? { state } : {}) });
  }
  return { ok: true, source: 't3', id: threadId, title: str(head.title), fetchedAt: new Date().toISOString(), items };
}

// ---------------------------------------------------------------- snapshot

interface ThreadOut {
  id: string;
  title: string;
  provider: Provider;
  providerInstanceId: string;
  providerLabel: string;
  model: string;
  status: Status;
  runStatus: string;
  pending: string | null;
  team: number;
  projectId: string;
  project: string;
  parentId: string | null;
  /** the thread that launched this one (or, for user-started orchestrators, keeps messaging it) */
  managerId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** the latest turn item, run or request; `updatedAt` also moves when the thread is only renamed or sorted */
  lastActiveAt: number;
  runStartedAt: number;
  runCompletedAt: number;
  toolCalls: number;
  files: number;
  context: number;
  contextTokens: number;
  tokens: number;
  cost: number;
  tps: number;
  /** what the thread is doing: waiting, its latest tool call, or (raw) its latest message */
  activity: Label;
  message: string;
  events: WireEvent[];
  /** pull requests T3 has linked to the thread, newest first */
  prs: PrOut[];
  url: string;
}

interface WireEvent {
  id: string;
  kind: ToolKind | 'compact';
  label: Label;
  at: number;
  /** a test run: `ok` stays null until it has finished with a result that can be told */
  tests?: { cmd: string; ok: boolean | null };
}

const tpsPrev = new Map<string, { used: number; at: number; tps: number }>();

function tpsFor(id: string, used: number, at: number, running: boolean) {
  const prev = tpsPrev.get(id);
  let tps = 0;
  if (running && prev && at > prev.at && used >= prev.used) tps = Math.min(600, ((used - prev.used) / (at - prev.at)) * 1000);
  else if (running && prev) tps = prev.tps * 0.85;
  tpsPrev.set(id, { used, at, tps });
  return Math.round(tps);
}

function snapshot(hours: number, seats: number) {
  const now = Date.now();
  const since = new Date(now - hours * H).toISOString();
  const env = environmentId();
  const runtime = readRuntime();
  const webBase = runtime ? `http://127.0.0.1:${runtime.port}` : 'http://127.0.0.1:3773';
  const inList = ACTIVE_RUN.map(() => '?').join(',');

  const activeRuns = all(`SELECT thread_id, status, requested_at FROM orchestration_v2_projection_runs WHERE status IN (${inList})`, ...ACTIVE_RUN);
  const pendingReqs = all(`SELECT thread_id, kind, created_at FROM orchestration_v2_projection_runtime_requests WHERE status = 'pending' AND kind != 'auth_refresh'`);
  const runsBy = new Map<string, string[]>();
  for (const r of activeRuns) runsBy.set(str(r.thread_id), [...(runsBy.get(str(r.thread_id)) ?? []), str(r.status)]);
  const pendingBy = new Map(pendingReqs.map((r) => [str(r.thread_id), str(r.kind)]));

  const rows = all(
    `SELECT thread_id, project_id, title, provider_instance_id, default_provider, created_at, updated_at, payload_json
       FROM orchestration_v2_projection_threads
      WHERE archived_at IS NULL AND deleted_at IS NULL AND updated_at >= ?
      UNION
     SELECT thread_id, project_id, title, provider_instance_id, default_provider, created_at, updated_at, payload_json
       FROM orchestration_v2_projection_threads
      WHERE archived_at IS NULL AND deleted_at IS NULL
        AND thread_id IN (SELECT thread_id FROM orchestration_v2_projection_runs WHERE status IN (${inList}))`,
    since,
    ...ACTIVE_RUN,
  );

  const projectRows = all('SELECT project_id, title, workspace_root FROM projection_projects WHERE deleted_at IS NULL');
  const projectTitle = new Map(projectRows.map((p) => [str(p.project_id), PROJECT_ALIASES[str(p.title)] ?? str(p.title)]));

  interface Cand {
    row: Row;
    payload: Record<string, any>;
    active: string[];
    pending: string | null;
  }
  const cands: Cand[] = [];
  for (const row of rows) {
    const payload = json<Record<string, any>>(row.payload_json) ?? {};
    const id = str(row.thread_id);
    const active = runsBy.get(id) ?? [];
    const pending = pendingBy.get(id) ?? null;
    const live = active.length > 0 || !!pending;
    if (!live) {
      if (payload.settledAt) continue;
      if (payload.snoozedUntil && ms(payload.snoozedUntil) > now) continue;
    }
    cands.push({ row, payload, active, pending });
  }

  const out: ThreadOut[] = [];
  for (const c of cands) {
    const id = str(c.row.thread_id);
    const instance = str(c.row.provider_instance_id) || str(c.row.default_provider);
    const latest = get(
      `SELECT status, requested_at, completed_at, json_extract(payload_json, '$.startedAt') AS started, json_extract(payload_json, '$.modelSelection.model') AS model
         FROM orchestration_v2_projection_runs WHERE thread_id = ? ORDER BY ordinal DESC LIMIT 1`,
      id,
    );
    const model = str(latest?.model) || str(c.payload.modelSelection?.model) || '';
    const runStatus = str(latest?.status) || 'none';
    const completedAt = ms(latest?.completed_at);

    let status: Status;
    if (c.pending) status = 'waiting';
    else if (c.active.some((s) => s === 'running' || s === 'starting' || s === 'preparing')) status = 'running';
    else if (c.active.includes('waiting')) status = 'waiting';
    else if (c.active.includes('queued')) status = 'running';
    else if (runStatus === 'failed') status = now - completedAt < FAILED_FOR ? 'failed' : 'idle';
    else if (runStatus === 'completed') status = now - completedAt < COMPLETED_FOR ? 'completed' : 'idle';
    else status = 'idle';

    // tokens, context and cost from the provider turns
    const turns = all(
      `SELECT status, started_at, json_extract(payload_json, '$.tokenUsage') AS tu, json_extract(payload_json, '$.turnTokenUsage') AS ttu
         FROM orchestration_v2_projection_provider_turns WHERE thread_id = ?`,
      id,
    );
    let tokens = 0, cost = 0, lastTu: { usedTokens?: number; maxTokens?: number; updatedAt?: string } | null = null, lastStart = '';
    for (const t of turns) {
      const ttu = json<TurnUsage>(t.ttu);
      if (ttu) {
        tokens += freshTokens(ttu);
        cost += turnCost(model, ttu);
      }
      const tu = json<{ usedTokens?: number; maxTokens?: number; updatedAt?: string }>(t.tu);
      if (tu && str(t.started_at) >= lastStart) {
        lastStart = str(t.started_at);
        lastTu = tu;
      }
    }
    const used = lastTu?.usedTokens ?? 0;
    const context = lastTu?.maxTokens ? Math.min(100, (used / lastTu.maxTokens) * 100) : 0;
    const tps = tpsFor(id, used, ms(lastTu?.updatedAt), status === 'running');

    const counts = all(`SELECT type, count(*) AS n FROM orchestration_v2_projection_turn_items WHERE thread_id = ? GROUP BY type`, id);
    const count = (types: string[]) => counts.filter((r) => types.includes(str(r.type))).reduce((s, r) => s + num(r.n), 0);

    const items = all(
      `SELECT ${ITEM_COLS},
              CASE WHEN type = 'assistant_message' THEN substr(json_extract(payload_json, '$.text'), 1, 400) END AS text
         FROM orchestration_v2_projection_turn_items
        WHERE thread_id = ? AND type NOT IN ('reasoning', 'todo_list', 'checkpoint', 'notification')
        ORDER BY ordinal DESC LIMIT 24`,
      id,
    );
    const events: ThreadOut['events'] = [];
    let message = '';
    let lastItemAt = 0;
    for (const r of items) {
      const it = itemRow(r);
      lastItemAt = Math.max(lastItemAt, it.at);
      if (it.type === 'assistant_message') {
        if (!message && it.text.trim()) message = clip(it.text.split(/(?<=[.!?])\s/)[0], 90);
        continue;
      }
      if (events.length >= 12) continue;
      const d = describe(it);
      if (!d) continue;
      if (d === 'compact') events.push({ id: it.id, kind: 'compact', label: { code: 'compact' }, at: it.at });
      else events.push({ id: it.id, kind: d.kind, label: d.label, at: it.at, ...(d.tests ? { tests: { cmd: d.tests.cmd, ok: testResult(it, d.tests.exitCounts) } } : {}) });
    }
    events.reverse();
    const lastTool = [...events].reverse().find((e) => e.kind !== 'compact');

    const projectId = str(c.row.project_id);
    const lineage = c.payload.lineage ?? {};
    out.push({
      id,
      title: str(c.row.title),
      provider: providerFor(instance, model),
      providerInstanceId: instance,
      providerLabel: providerLabel(instance),
      model,
      status,
      runStatus: c.pending ? `pending:${c.pending}` : c.active[0] ?? runStatus,
      pending: c.pending,
      team: 0,
      projectId,
      project: projectTitle.get(projectId) ?? UNKNOWN_PROJECT,
      parentId: lineage.parentThreadId ? str(lineage.parentThreadId) : null,
      managerId: null,
      createdBy: str(c.payload.createdBy),
      createdAt: ms(c.row.created_at),
      updatedAt: ms(c.row.updated_at),
      lastActiveAt: Math.max(lastItemAt, completedAt, ms(latest?.started), ms(latest?.requested_at)) || ms(c.row.updated_at),
      runStartedAt: ms(latest?.started) || ms(latest?.requested_at),
      runCompletedAt: completedAt,
      toolCalls: count(['command_execution', 'dynamic_tool', 'file_change', 'web_search', 'file_search']),
      files: count(['file_change']),
      context: Math.round(context * 10) / 10,
      contextTokens: used,
      tokens,
      cost: Math.round(cost * 100) / 100,
      tps,
      activity: status === 'waiting' ? { code: 'waiting' } : (lastTool?.label ?? raw(message)),
      message,
      events,
      prs: [],
      url: env ? `${webBase}/${encodeURIComponent(env)}/${encodeURIComponent(id)}` : webBase,
    });
  }

  // keep the most relevant threads; parents stay when a child is kept
  const prio: Record<Status, number> = { running: 0, waiting: 1, failed: 2, completed: 3, idle: 4 };
  out.sort((a, b) => prio[a.status] - prio[b.status] || b.updatedAt - a.updatedAt);
  const kept = out.slice(0, MAX_THREADS);
  const byId = new Map(out.map((t) => [t.id, t]));
  for (const t of [...kept]) {
    const p = t.parentId ? byId.get(t.parentId) : undefined;
    if (p && !kept.includes(p)) kept.push(p);
  }
  const keptIds = new Set(kept.map((t) => t.id));
  for (const t of kept) if (t.parentId && !keptIds.has(t.parentId)) t.parentId = null;
  for (const t of kept) t.prs = pullRequests(t.id);
  refreshPrs(kept.flatMap((t) => t.prs));

  // command lines: follow every launch chain down from the threads in the office (also through threads
  // that aren't seated right now); messages only count from user-started threads to agent-started ones
  const roots = kept.filter((t) => !t.parentId);
  const keptRoot = new Set(roots.map((t) => t.id));
  const launcher = new Map<string, string>();
  const queue = roots.map((t) => t.id);
  const scanned = new Set<string>();
  while (queue.length && scanned.size < 240) {
    const id = queue.shift()!;
    if (scanned.has(id)) continue;
    scanned.add(id);
    for (const child of commands(id).launched.keys()) {
      if (!launcher.has(child)) launcher.set(child, id);
      if (!scanned.has(child)) queue.push(child);
    }
  }
  for (const t of roots) {
    const seen = new Set([t.id]);
    let m = launcher.get(t.id);
    while (m && !keptRoot.has(m) && !seen.has(m)) {
      seen.add(m);
      m = launcher.get(m);
    }
    if (m && keptRoot.has(m) && m !== t.id) {
      t.managerId = m;
      continue;
    }
    if (t.createdBy === 'user') continue;
    let bestAt = -1;
    for (const u of roots) {
      if (u.id === t.id || u.createdBy !== 'user') continue;
      const sAt = commands(u.id).sent.get(t.id);
      if (sAt !== undefined && sAt > bestAt) [t.managerId, bestAt] = [u.id, sAt];
    }
  }
  const cmd = new Map(roots.map((t) => [t.id, commands(t.id)]));
  const reports = new Map<string, number>();
  for (const t of roots) {
    const seen = new Set<string>();
    for (let m = t.managerId; m && !seen.has(m); m = byId.get(m)?.managerId ?? null) {
      seen.add(m);
      reports.set(m, (reports.get(m) ?? 0) + 1);
    }
  }
  const bossRank = (t: ThreadOut) => (reports.get(t.id) ?? 0) + (/\b(chef|main|orchestr)/i.test(t.title) ? 0.5 : 0) + (t.createdBy === 'user' ? 0.25 : 0);
  const bossT = roots.filter((t) => (reports.get(t.id) ?? 0) >= 2).sort((a, b) => bossRank(b) - bossRank(a))[0];
  const boss = bossT
    ? { id: bossT.id, reports: reports.get(bossT.id) ?? 0, orders: cmd.get(bossT.id)!.orders.filter((o) => now - o.at < 15 * 60_000).slice(-10) }
    : null;

  // projects -> 4 pods; subagents sit with their root thread
  const rootOf = (t: ThreadOut): ThreadOut => {
    let cur = t;
    for (let i = 0; i < 8 && cur.parentId; i++) cur = byId.get(cur.parentId) ?? cur;
    return cur;
  };
  const keyOf = (t: ThreadOut) => rootOf(t).project.toLowerCase();
  const projects = new Map<string, { key: string; score: number; count: number; titles: Set<string>; ids: Set<string> }>();
  for (const t of kept) {
    const k = keyOf(t);
    const p = projects.get(k) ?? { key: k, score: 0, count: 0, titles: new Set<string>(), ids: new Set<string>() };
    p.count++;
    p.score += (t.status === 'running' ? 5 : t.status === 'waiting' ? 4 : 1) + Math.max(0, 1 - (now - t.updatedAt) / (hours * H));
    p.titles.add(rootOf(t).project);
    p.ids.add(rootOf(t).projectId);
    projects.set(k, p);
  }
  assignTeams([...projects.values()]);
  for (const t of kept) t.team = teamOf.get(keyOf(t)) ?? 0;

  const teams = owners.map((slot) => {
    const members = [...projects.values()].filter((p) => teamOf.get(p.key) === slot.index).sort((a, b) => b.score - a.score);
    const owner = members.find((m) => m.key === slot.owner) ?? members[0];
    const name = owner ? [...owner.titles][0] : '';
    const guests = members.length - (owner ? 1 : 0);
    return {
      index: slot.index,
      name,
      short: name ? clip(name, 14) + (guests > 0 ? ` +${guests}` : '') : '',
      overflowOf: null,
      projects: members.map((m) => ({ title: [...m.titles][0], ids: [...m.ids], threads: m.count })),
    };
  });

  // parents before children, so the office can seat interns next to them
  const depth = (t: ThreadOut) => {
    let d = 0;
    for (let cur = t; cur.parentId && d < 8; d++) cur = byId.get(cur.parentId) ?? { ...cur, parentId: null };
    return d;
  };
  kept.sort((a, b) => depth(a) - depth(b) || prio[a.status] - prio[b.status] || b.updatedAt - a.updatedAt);

  // today's totals: finished runs, fresh tokens and API-equivalent cost since local midnight
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const dayIso = midnight.toISOString();
  const runsToday = num(get(`SELECT count(*) AS n FROM orchestration_v2_projection_runs WHERE status = 'completed' AND completed_at >= ?`, dayIso)?.n);
  const turnRows = all(
    `SELECT p.thread_id, json_extract(p.payload_json, '$.turnTokenUsage') AS ttu, json_extract(t.payload_json, '$.modelSelection.model') AS model
       FROM orchestration_v2_projection_provider_turns p LEFT JOIN orchestration_v2_projection_threads t ON t.thread_id = p.thread_id
      WHERE p.completed_at >= ?`,
    dayIso,
  );
  let dayTokens = 0, dayCost = 0;
  for (const r of turnRows) {
    const u = json<TurnUsage>(r.ttu);
    if (!u) continue;
    dayTokens += freshTokens(u);
    dayCost += turnCost(str(r.model), u);
  }
  const queued = activeRuns.filter((r) => str(r.status) === 'queued').length;

  return {
    ok: true,
    source: 't3',
    fetchedAt: new Date(now).toISOString(),
    environmentId: env,
    webBase,
    windowHours: hours,
    boss,
    teams,
    threads: kept,
    totals: {
      runs: runsToday,
      tokens: dayTokens,
      cost: Math.round(dayCost * 100) / 100,
      queued,
      running: kept.filter((t) => t.status === 'running').length,
      waiting: kept.filter((t) => t.status === 'waiting').length,
      candidates: out.length,
    },
  };
}

// ---------------------------------------------------------------- usage

const DAY_MIN = 24 * 60;
/** Cursor windows the client has an explanatory note for */
const CURSOR_NOTES = ['autoPercentUsed', 'apiPercentUsed'];
const GROUP_LABEL: Record<Provider, string> = { codex: 'Codex', claude: 'Claude', cursor: 'Cursor', gemini: 'Gemini' };

function usage() {
  const now = Date.now();
  type Win = NonNullable<NonNullable<ProviderCache['usageLimits']>['windows']>[number];
  const groups = new Map<Provider, { provider: Provider; label: string; checkedAt: string; instances: { p: ProviderCache; windows: Win[] }[] }>();
  /** reason: 'no-data' | 'no-provider' | 'unavailable' (T3's own words in `detail`) */
  const missing: { provider: string; instanceId: string; reason: string; detail?: string }[] = [];
  for (const p of providers()) {
    const provider = providerFor(p.instanceId, '');
    if (!p.enabled) continue;
    const windows = p.usageLimits?.windows ?? [];
    if (!windows.length) {
      const why = p.usageLimits?.unavailable?.reason;
      missing.push({ provider, instanceId: p.instanceId, ...(why ? { reason: 'unavailable', detail: why } : { reason: 'no-data' }) });
      continue;
    }
    const g = groups.get(provider) ?? { provider, label: GROUP_LABEL[provider], checkedAt: '', instances: [] };
    g.instances.push({ p, windows });
    if ((p.usageLimits?.checkedAt ?? '') > g.checkedAt) g.checkedAt = p.usageLimits?.checkedAt ?? '';
    groups.set(provider, g);
  }

  const pace = (w: Win, resetAt: number) => {
    const dur = (w.windowDurationMins ?? (w.kind === 'monthly' ? 30 * DAY_MIN : w.kind === 'weekly' ? 7 * DAY_MIN : 300)) * MIN;
    const elapsed = Math.min(1, Math.max(0, 1 - (resetAt - now) / dur));
    return w.usedPercent - elapsed * 100;
  };

  const order: Provider[] = ['codex', 'claude', 'cursor', 'gemini'];
  const out = order
    .filter((p) => groups.has(p))
    .map((provider) => {
      const g = groups.get(provider)!;
      const ids: string[] = [];
      for (const inst of g.instances) for (const w of inst.windows) if (!ids.includes(w.id)) ids.push(w.id);
      const pools = ids.map((wid) => {
        const hits = g.instances.map((inst) => ({ inst, w: inst.windows.find((w) => w.id === wid) })).filter((h): h is { inst: (typeof g.instances)[number]; w: Win } => !!h.w);
        const w0 = hits[0].w;
        const accounts =
          g.instances.length > 1
            ? hits
                .map(({ inst, w }) => ({
                  name: inst.p.displayName,
                  left: Math.max(0, 1 - w.usedPercent / 100),
                  resetAt: ms(w.resetsAt),
                  ...(inst.p.usageLimits?.resetCredits?.availableCount ? { badge: inst.p.usageLimits.resetCredits.availableCount } : {}),
                }))
                .sort((a, b) => a.left - b.left)
            : undefined;
        const left = accounts ? accounts.reduce((s, a) => s + a.left, 0) / accounts.length : Math.max(0, 1 - w0.usedPercent / 100);
        const resetAt = accounts ? Math.min(...accounts.map((a) => a.resetAt)) : ms(w0.resetsAt);
        const ahead = hits.reduce((s, h) => s + pace(h.w, ms(h.w.resetsAt)), 0) / hits.length;
        const trend = w0.kind === 'session' ? 'session' : ahead > 3 ? 'up' : ahead < -3 ? 'down' : 'flat';
        return {
          id: `${provider}-${wid.replace(/_/g, '-')}`,
          label: w0.label,
          left,
          resetAt,
          trend,
          ...(trend === 'up' || trend === 'down' ? { delta: `${ahead > 0 ? '+' : ''}${Math.round(ahead)}%` } : {}),
          ...(provider === 'cursor' && CURSOR_NOTES.includes(wid) ? { note: wid } : {}),
          ...(accounts ? { accounts } : {}),
          kind: w0.kind,
        };
      });
      return { provider, label: g.label, pools, checkedAt: g.checkedAt };
    });
  for (const p of order) if (!groups.has(p) && !missing.some((m) => m.provider === p)) missing.push({ provider: p, instanceId: '', reason: 'no-provider' });
  return { ok: true, source: 't3', fetchedAt: new Date(now).toISOString(), groups: out, missing };
}

// ---------------------------------------------------------------- plugin

function send(res: ServerResponse, code: number, body: unknown) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function query(req: IncomingMessage) {
  return new URL(req.url ?? '/', 'http://x').searchParams;
}

/** /api/t3/status, /api/t3/threads, /api/t3/thread?id=, /api/t3/usage (GET, read-only) and POST /api/t3/focus (brings the desktop app to the front). */
export function t3Api(): Plugin {
  const cache = new Map<string, { at: number; code: number; body: string }>();
  const cached = (key: string, ttl: number, build: () => { code: number; body: unknown }) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit;
    const r = build();
    const entry = { at: Date.now(), code: r.code, body: JSON.stringify(r.body) };
    cache.set(key, entry);
    return entry;
  };
  const guarded = (build: () => unknown, force: boolean) => {
    const a = availability();
    if (!a.ok && !(force && existsSync(DB_PATH))) return { code: 503, body: { ok: false, reason: a.reason, detail: a.detail, running: a.running } };
    try {
      return { code: 200, body: build() };
    } catch (e) {
      closeDb();
      return { code: 503, body: { ok: false, reason: 'read-failed', detail: (e as Error).message } };
    }
  };

  // the same API for `npm run dev` and for the built office (`npm start`, `vite preview`)
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.httpServer?.once('close', closeDb);
    server.middlewares.use('/api/t3', (req, res, next) => {
      const path = (req.url ?? '/').split('?')[0];
      const q = query(req);
      const force = q.get('force') === '1';
      if (path === '/status') {
        const a = availability();
        return send(res, a.ok ? 200 : 503, {
          ok: a.ok,
          reason: a.reason,
          detail: a.detail,
          running: a.running,
          pid: a.runtime?.pid ?? null,
          port: a.runtime?.port ?? null,
          startedAt: a.runtime?.startedAt ?? null,
          environmentId: environmentId(),
          db: DB_PATH,
        });
      }
      if (path === '/threads') {
        const hours = Math.min(72, Math.max(1, Number(q.get('hours')) || 12));
        const seats = Math.min(12, Math.max(1, Number(q.get('seats')) || 6));
        const r = cached(`threads:${hours}:${seats}:${force}`, 2000, () => guarded(() => snapshot(hours, seats), force));
        return send(res, r.code, r.body);
      }
      if (path === '/thread') {
        const id = q.get('id') ?? '';
        const limit = Math.min(120, Math.max(10, Number(q.get('limit')) || 60));
        const r = cached(`thread:${id}:${limit}:${force}`, 1500, () => {
          const g = guarded(() => transcript(id, limit), force);
          return g.code === 200 && !g.body ? { code: 404, body: { ok: false, reason: 'no-thread' } } : g;
        });
        return send(res, r.code, r.body);
      }
      if (path === '/usage') {
        const r = cached(`usage:${force}`, 5000, () => guarded(usage, force));
        return send(res, r.code, r.body);
      }
      if (path === '/focus' && req.method === 'POST') {
        execFile('open', ['-b', 'com.t3tools.t3code'], (err) => send(res, err ? 500 : 200, { ok: !err, reason: err?.message }));
        return;
      }
      next();
    });
  };

  return { name: 'office-t3-api', configureServer: mount, configurePreviewServer: mount };
}
