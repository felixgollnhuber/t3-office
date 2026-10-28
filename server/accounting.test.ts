/** Synthetic accounting regressions; no private provider data or installed user caches are read. */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codexInitial, parseCodex, processedTokens } from './tokens.ts';

const root = mkdtempSync(join(tmpdir(), 'office-accounting-'));
process.env.T3_HOME = root; process.env.CODEX_HOME = join(root, 'codex'); process.env.CLAUDE_CONFIG_DIR = join(root, 'claude');
const { loadScanCache, collect, aggregate, readFrom } = await import('./costs.ts');
const userdata = join(root, 'userdata'); mkdirSync(userdata, { recursive: true });
after(() => rmSync(root, { recursive: true, force: true }));
const now = Math.floor(Date.now() / 60_000) * 60_000;
const time = now - 3_600_000;
const usage = (input = 100) => ({ input_tokens: input, cached_input_tokens: 40, cache_write_input_tokens: 10, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: input + 10 });
const multiply = (u: ReturnType<typeof usage>, n: number) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v * n]));
const event = (last: unknown, total?: unknown, at = time) => JSON.stringify({ type: 'event_msg', timestamp: new Date(at).toISOString(), payload: { type: 'token_count', info: { last_token_usage: last, ...(total === undefined ? {} : { total_token_usage: total }) } } });
const context = JSON.stringify({ type: 'turn_context', payload: { model: 'fixture-model' } });
const meta = JSON.stringify({ type: 'session_meta', timestamp: new Date(time - 100).toISOString(), payload: { id: 'synthetic-session' } });
const row = (u = 50, model = 0) => [time, model, 0, u, 40, 10, 10, 2, null, null, 0];
function cache(version: number, files: Record<string, unknown>) { return { version, models: ['fixture-model', 'fixture-rate', '<synthetic>'], sessions: ['synthetic-session'], files }; }
function guard(bytes: Buffer) { let hash = 0x811c9dc5; for (const b of bytes) { hash ^= b; hash = Math.imul(hash, 0x01000193); } return hash >>> 0; }

test('normalized turn totals include cache hits once and reasoning remains part of output', () => {
  assert.equal(processedTokens({ inputTokens: 600, cachedInputTokens: 400, cacheCreationTokens: 50, outputTokens: 20 }), 620);
  assert.equal(processedTokens({}), 0);
  assert.equal(processedTokens({ inputTokens: -3, outputTokens: Number.NaN }), 0);
});

test('identical-sized genuine Codex requests count, but replayed cumulative events do not', () => {
  const state = codexInitial(); parseCodex(context, state);
  assert.ok(parseCodex(event(usage(), multiply(usage(), 1)), state));
  assert.ok(parseCodex(event(usage(), multiply(usage(), 2)), state));
  assert.equal(parseCodex(event(usage(), multiply(usage(), 2)), state), null);
  const invalid = multiply(usage(), 4);
  assert.equal(parseCodex(event(usage(), invalid), state), null);
  assert.equal(state.malformedRecords, 1);
});

test('legacy events normalize field order and reset deduplication after zero usage', () => {
  const state = codexInitial(); parseCodex(context, state);
  assert.ok(parseCodex(event(usage()), state));
  assert.equal(parseCodex(event(Object.fromEntries(Object.entries(usage()).reverse())), state), null);
  const zero = Object.fromEntries(Object.keys(usage()).map((k) => [k, 0]));
  assert.equal(parseCodex(event(zero), state), null);
  assert.ok(parseCodex(event(usage()), state));
});

test('fork history establishes a baseline without swallowing a genuine identical child request', () => {
  const state = codexInitial();
  parseCodex(JSON.stringify({ type: 'session_meta', timestamp: new Date(time).toISOString(), payload: { id: 'child', forked_from_id: 'parent' } }), state);
  parseCodex(context, state);
  assert.equal(parseCodex(event(usage(), multiply(usage(), 1), time + 20), state), null);
  assert.ok(parseCodex(event(usage(), multiply(usage(), 2), time + 5000), state));
});

test('malformed Codex counters do not fabricate or double-count usage', () => {
  const state = codexInitial(); parseCodex(context, state);
  assert.equal(parseCodex(event({ ...usage(), cached_input_tokens: 101 }), state), null);
  assert.equal(parseCodex(event({ ...usage(), reasoning_output_tokens: 11 }), state), null);
  assert.equal(parseCodex(event(usage(), { ...usage(), total_tokens: -1 }), state), null);
  for (const field of ['cached_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens', 'total_tokens']) assert.equal(parseCodex(event({ ...usage(), [field]: null }), state), null);
  assert.equal(state.malformedRecords, 7);
});

test('the newest supported cache wins without summing overlapping older generations', () => {
  const dir = join(root, 'cache-selection'); mkdirSync(dir);
  writeFileSync(join(dir, 'usage-scan-cache-v5.json'), JSON.stringify(cache(5, { 'old-only': { p: 'codex', s: 1, m: now, r: [row(9999)], t: [] } })));
  writeFileSync(join(dir, 'usage-scan-cache-v9.json'), JSON.stringify(cache(9, { 'new-only': { p: 'codex', s: 1, m: now, o: 0, gl: 0, gh: 0, cs: codexInitial(), r: [row()], t: [] } })));
  const result = loadScanCache(dir);
  assert.equal(result.version, 9); assert.deepEqual([...result.files.keys()], ['new-only']);
});

test('v9 checkpoints preserve tail usage once, reconcile appends, reject rewrites and retain deleted history', async () => {
  const d = new Date(time);
  const codex = join(process.env.CODEX_HOME!, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  mkdirSync(codex, { recursive: true });
  const path = join(codex, 'synthetic.jsonl');
  const prefix = `${meta}\n${context}\n${event(usage(), multiply(usage(), 1))}\n`;
  const tail = event(usage(), multiply(usage(), 2), time + 1);
  writeFileSync(path, prefix + tail);
  const state = codexInitial(); [meta, context, event(usage(), multiply(usage(), 1))].forEach((line) => parseCodex(line, state));
  const offset = Buffer.byteLength(prefix), bytes = Buffer.from(prefix).subarray(-64);
  const retained = join(root, 'deleted-grok.jsonl');
  const entries = {
    [path]: { p: 'codex', s: Buffer.byteLength(prefix + tail), m: now, r: [row()], t: [[time + 1, ...row().slice(1)]], o: offset, gl: bytes.length, gh: guard(bytes), cs: state },
    [retained]: { p: 'grok', s: -1, m: now, r: [[time, 0, 0, 30, 10, 0, 10, 0, null, null, 0]], t: [], o: 0, gl: 0, gh: 0 },
  };
  writeFileSync(join(userdata, 'usage-scan-cache-v9.json'), JSON.stringify(cache(9, entries)));
  const claude = join(process.env.CLAUDE_CONFIG_DIR!, 'projects', 'synthetic'); mkdirSync(claude, { recursive: true });
  const message = (model: string, id: string) => JSON.stringify({ type: 'assistant', timestamp: new Date(time).toISOString(), sessionId: 'claude', message: { id, model, usage: { input_tokens: 30, cache_read_input_tokens: 40, cache_creation_input_tokens: 10, output_tokens: 20 } } });
  writeFileSync(join(claude, 'usage.jsonl'), `${message('<synthetic>', 'skip')}\n${message('fixture-model', 'real')}\n`);
  const sum = (corpus: Awaited<ReturnType<typeof collect>>) => aggregate(corpus, '24h', 'UTC', now).totals.totalTokens;
  let corpus = await collect(); assert.equal(corpus.cacheVersion, 9); assert.equal(sum(corpus), 370);
  appendFileSync(path, '\n'); corpus = await collect(); assert.equal(sum(corpus), 370);
  appendFileSync(path, `${event(usage(), multiply(usage(), 3), time + 2)}\n`); corpus = await collect(); assert.equal(sum(corpus), 480);
  const replacement = `${meta}\n${context}\n${event(usage(200), usage(200))}\n${'{}\n'.repeat(1000)}`;
  assert.ok(Buffer.byteLength(replacement) > Buffer.byteLength(prefix + tail));
  writeFileSync(path, replacement); corpus = await collect(); assert.equal(sum(corpus), 360);
  rmSync(path); corpus = await collect(); assert.equal(sum(corpus), 370);
  // Everything above is read-only: the authoritative cache must remain unchanged.
  assert.deepEqual(JSON.parse(readFileSync(join(userdata, 'usage-scan-cache-v9.json'), 'utf8')), cache(9, entries));
  // Old Codex checkpoints must be reparsed, not resumed with stale deduplication state.
  writeFileSync(path, `${meta}\n${context}\n${event(usage(), usage())}\n`);
  rmSync(join(userdata, 'usage-scan-cache-v9.json'));
  writeFileSync(join(userdata, 'usage-scan-cache-v5.json'), JSON.stringify(cache(5, { [path]: { ...entries[path], r: [row(9999)], t: [], cs: { model: 'fixture-model', lastUsageSignature: 'old' } } })));
  corpus = await collect(); assert.equal(corpus.cacheVersion, 5); assert.equal(sum(corpus), 210);
});

test('cached billing-model and priority tier price the same processed tokens without counting reasoning twice', () => {
  writeFileSync(join(userdata, 'usage-model-rates.json'), JSON.stringify({ fetchedAtMs: now, document: { 'fixture-rate': { input_cost_per_token: 1, output_cost_per_token: 4, cache_read_input_token_cost: 0.25, cache_creation_input_token_cost: 2, input_cost_per_token_priority: 2, output_cost_per_token_priority: 8, cache_read_input_token_cost_priority: 0.5, cache_creation_input_token_cost_priority: 4 } } }));
  const corpus = { files: [{ path: 'synthetic', provider: 'codex' as const, records: [{ ts: time, model: 'display-label', rateModel: 'fixture-rate', session: 'session', u: 50, c: 40, w: 10, o: 10, r: 2, key: null, cost: null, speed: 'fast' as const }] }], liveFiles: 0, cacheAt: now, scanMs: 0, cacheVersion: 9 };
  const result = aggregate(corpus, '24h', 'UTC', now);
  assert.equal(result.totals.totalTokens, 110); assert.equal(result.totals.costUsd, 240);
  // Display-model overrides beat both the billing model and provider-reported dollars.
  const settings = join(userdata, 'settings.json');
  writeFileSync(settings, JSON.stringify({ usagePriceOverrides: { 'display-label': { inputCostPerMillionTokens: 100000, outputCostPerMillionTokens: 200000, cacheReadCostPerMillionTokens: 0, cacheWriteCostPerMillionTokens: 0 } } }));
  utimesSync(settings, new Date(now + 1000), new Date(now + 1000));
  corpus.files[0].records[0].cost = 999 as any;
  assert.equal(aggregate(corpus, '24h', 'UTC', now).totals.costUsd, 7);
  // A model alias intentionally replaces the cached billing-model hint.
  writeFileSync(settings, JSON.stringify({ usageModelAliases: { 'display-label': 'fixture-rate' } }));
  utimesSync(settings, new Date(now + 2000), new Date(now + 2000));
  corpus.files[0].records[0].cost = null;
  corpus.files[0].records[0].rateModel = 'unknown-billing-model';
  assert.equal(aggregate(corpus, '24h', 'UTC', now).totals.costUsd, 240);
});

test('chunked reads reach EOF, preserve split UTF-8/CRLF lines and tentatively count the final usage once', async () => {
  const path = join(root, 'stream.jsonl');
  const source = [meta, context, JSON.stringify({ type: 'note', text: '🙂'.repeat(100) }), event(usage(), usage())].join('\r\n') + '\r\n' + event(usage(), multiply(usage(), 2));
  writeFileSync(path, source);
  const result = await readFrom(path, 'codex', 0, null, Buffer.byteLength(source), 31);
  assert.equal(result.records.length, 2); assert.equal(result.tail, 1);
  assert.equal(result.offset, Buffer.byteLength(source.slice(0, source.lastIndexOf('\n') + 1)));
  appendFileSync(path, '\n');
  const resumed = await readFrom(path, 'codex', result.offset, result.state, Buffer.byteLength(source) + 1, 17);
  assert.equal(resumed.records.length, 1); assert.equal(resumed.tail, 0);
  assert.equal(resumed.offset, Buffer.byteLength(source) + 1);
});

test('unreadable files are flagged with cached fallback or refuse an incomplete uncached total', async () => {
  const d = new Date(time);
  const path = join(process.env.CODEX_HOME!, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'), 'unreadable.jsonl');
  mkdirSync(path); // Reading a directory as a usage file fails deterministically, even when tests run as root.
  const v9 = join(userdata, 'usage-scan-cache-v9.json');
  writeFileSync(v9, JSON.stringify(cache(9, { [path]: { p: 'codex', s: 0, m: now, r: [row()], t: [], o: 0, gl: 0, gh: 0, cs: codexInitial() } })));
  const corpus = await collect(); assert.equal(corpus.readFailures, 1);
  assert.equal(corpus.files.find((f) => f.path === path)?.records.length, 1);
  rmSync(v9);
  await assert.rejects(collect(), /refusing to return incomplete totals/);
  rmSync(path, { recursive: true });
});
