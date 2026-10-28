/** Token accounting adapted from T3 Code (MIT, T3 Tools Inc.). See docs/licenses/t3-code-MIT.txt.
 * Matches the installed 0.1.3 Codex reconciliation rules and scan cache v9. */
export interface TurnUsage { inputTokens?: number; cachedInputTokens?: number; cacheCreationTokens?: number; outputTokens?: number }
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
/** Normalized T3 turn input already includes cached/cache-write input. Reasoning is part of output. */
export const processedTokens = (usage: TurnUsage) => count(usage.inputTokens) + count(usage.outputTokens);
export type Speed = 'standard' | 'fast' | 'ultrafast';
export interface UsageRecord { ts: number; model: string; session: string; u: number; c: number; w: number; o: number; r: number; key: string | null; cost: number | null; speed: Speed; rateModel?: string }
const FIELDS = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'] as const;
type CodexTokens = Record<(typeof FIELDS)[number], number>;
export interface CodexState {
  model: string; speed: Speed; sessionId: string; lastUsageSignature: string | null; lastCumulativeUsage: CodexTokens | null;
  malformedRecords: number; sawSessionMeta: boolean; suppressingForkCopies: boolean; forkCopyAnchorMs: number;
}
export const codexInitial = (): CodexState => ({ model: '', speed: 'standard', sessionId: '', lastUsageSignature: null, lastCumulativeUsage: null, malformedRecords: 0, sawSessionMeta: false, suppressingForkCopies: false, forkCopyAnchorMs: 0 });
const obj = (value: unknown): Record<string, any> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
function tokens(value: unknown): CodexTokens | null {
  const raw = obj(value); if (!raw) return null;
  const input = raw.input_tokens, output = raw.output_tokens;
  const usage: CodexTokens = { input_tokens: input, output_tokens: output, cached_input_tokens: raw.cached_input_tokens === undefined ? 0 : raw.cached_input_tokens, cache_write_input_tokens: raw.cache_write_input_tokens === undefined ? 0 : raw.cache_write_input_tokens, reasoning_output_tokens: raw.reasoning_output_tokens === undefined ? 0 : raw.reasoning_output_tokens, total_tokens: raw.total_tokens === undefined ? input + output : raw.total_tokens };
  if (!FIELDS.every((key) => Number.isSafeInteger(usage[key]) && usage[key] >= 0)) return null;
  if (usage.cached_input_tokens + usage.cache_write_input_tokens > input || usage.reasoning_output_tokens > output || usage.total_tokens < input + output) return null;
  return usage;
}
const combine = (a: CodexTokens | null, b: CodexTokens, sign = 1) => tokens(Object.fromEntries(FIELDS.map((key) => [key, (a?.[key] ?? 0) + sign * b[key]])));
export function isCodexState(value: unknown): value is CodexState {
  const state = obj(value);
  return !!state && typeof state.model === 'string' && ['standard', 'fast', 'ultrafast'].includes(state.speed) && typeof state.sessionId === 'string'
    && (state.lastUsageSignature === null || typeof state.lastUsageSignature === 'string')
    && (state.lastCumulativeUsage === null || tokens(state.lastCumulativeUsage) !== null)
    && Number.isSafeInteger(state.malformedRecords) && state.malformedRecords >= 0
    && typeof state.sawSessionMeta === 'boolean' && typeof state.suppressingForkCopies === 'boolean' && Number.isFinite(state.forkCopyAnchorMs);
}
const timestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
export function parseCodex(line: string, state: CodexState): UsageRecord | null {
  let record: Record<string, any> | null;
  try { record = obj(JSON.parse(line)); } catch { return null; }
  const payload = obj(record?.payload); if (!record || !payload) return null;
  if (record.type === 'session_meta') {
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payload.id ?? payload.session_id; if (typeof id === 'string') state.sessionId = id;
    const time = timestamp(record.timestamp);
    if (time !== null && (typeof payload.forked_from_id === 'string' || typeof obj(obj(obj(payload.source)?.subagent)?.thread_spawn)?.parent_thread_id === 'string')) { state.suppressingForkCopies = true; state.forkCopyAnchorMs = time; }
    return null;
  }
  if (record.type === 'turn_context') { if (typeof payload.model === 'string') state.model = payload.model; return null; }
  if (payload.type === 'thread_settings_applied') {
    const settings = obj(payload.thread_settings);
    if (settings) state.speed = settings.service_tier === 'priority' || settings.service_tier === 'fast' ? 'fast' : settings.service_tier === 'ultrafast' ? 'ultrafast' : 'standard';
    return null;
  }
  if (payload.type !== 'token_count') return null;
  const info = obj(payload.info), time = timestamp(record.timestamp);
  if (!info || time === null || !state.model) return null;
  const last = tokens(info.last_token_usage);
  const hasCumulative = info.total_token_usage !== undefined && info.total_token_usage !== null;
  const cumulative = hasCumulative ? tokens(info.total_token_usage) : null;
  if (state.suppressingForkCopies) {
    if (time - state.forkCopyAnchorMs < 1000) {
      state.forkCopyAnchorMs = time;
      const signature = last ? JSON.stringify(last) : null;
      if (cumulative) state.lastCumulativeUsage = cumulative;
      else if (!hasCumulative && last && signature !== state.lastUsageSignature) state.lastCumulativeUsage = combine(state.lastCumulativeUsage, last);
      state.lastUsageSignature = signature;
      return null;
    }
    state.suppressingForkCopies = false; state.lastUsageSignature = null;
  }
  const previous = state.lastCumulativeUsage;
  if (cumulative) state.lastCumulativeUsage = cumulative;
  if (!last || (hasCumulative && !cumulative)) { state.malformedRecords++; return null; }
  if (!last.input_tokens && !last.output_tokens) { state.lastUsageSignature = null; return null; }
  if (cumulative && previous && FIELDS.every((key) => cumulative[key] === previous[key])) return null;
  if (last.total_tokens !== last.input_tokens + last.output_tokens) { state.malformedRecords++; return null; }
  const signature = JSON.stringify(last);
  if (cumulative) {
    const restarted = FIELDS.every((key) => cumulative[key] === last[key]);
    const reconciled = previous ? FIELDS.every((key) => cumulative[key] - previous[key] === last[key]) : combine(cumulative, last, -1) !== null;
    if (!restarted && !reconciled) { state.malformedRecords++; return null; }
  } else {
    if (signature === state.lastUsageSignature) return null;
    const advanced = combine(previous, last);
    if (!advanced) { state.malformedRecords++; return null; }
    state.lastCumulativeUsage = advanced;
  }
  state.lastUsageSignature = signature;
  return { ts: time, model: state.model, session: state.sessionId, u: last.input_tokens - last.cached_input_tokens - last.cache_write_input_tokens, c: last.cached_input_tokens, w: last.cache_write_input_tokens, o: last.output_tokens, r: last.reasoning_output_tokens, key: null, cost: null, speed: state.speed };
}
