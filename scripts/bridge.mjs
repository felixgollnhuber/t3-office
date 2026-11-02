#!/usr/bin/env node
/** Explicitly launched, publish-only bridge. Raw work stays local; only opaque IDs, providers and statuses leave. */
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const PROVIDERS = new Set(['claude', 'codex', 'cursor', 'gemini']);
const STATUSES = new Set(['running', 'waiting', 'idle', 'failed', 'completed']);
const loopback = (hostname) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function filterSnapshot(snapshot, salt) {
  if (!snapshot || !Array.isArray(snapshot.threads)) throw new Error('Local office returned an invalid snapshot.');
  const seen = new Set();
  return snapshot.threads.filter((t) => {
    if (!t || typeof t.id !== 'string' || !PROVIDERS.has(t.provider) || !STATUSES.has(t.status) || seen.has(t.id)) return false;
    seen.add(t.id); return true;
  }).slice(0, 24).map((t) => ({
    id: createHmac('sha256', salt).update(t.id).digest('hex').slice(0, 32), provider: t.provider, status: t.status,
  }));
}

export function validateEndpoints(serverText, sourceText) {
  const server = new URL(serverText);
  const source = new URL(sourceText);
  for (const url of [server, source]) {
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an origin URL without credentials, a path, query or fragment.');
  }
  if (server.protocol !== 'https:' && !(server.protocol === 'http:' && loopback(server.hostname))) throw new Error('Use HTTPS for a remote building server.');
  if (!loopback(source.hostname) || !['http:', 'https:'].includes(source.protocol)) throw new Error('The source must be a local loopback office.');
  return { server, source };
}

export async function bridgeOnce({ server, source, token, salt, fetcher = fetch }) {
  let agents;
  try {
    const response = await fetcher(new URL('/api/t3/threads?hours=12&seats=6', source), { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error('Source unavailable.');
    agents = filterSnapshot(await response.json(), salt);
  } catch {
    // Clear old activity when the companion stops; never publish a guessed/demo fallback as real data.
    await send({ server, token, agents: [], fetcher });
    return { available: false, count: 0 };
  }
  await send({ server, token, agents, fetcher });
  return { available: true, count: agents.length };
}

async function send({ server, token, agents, fetcher = fetch }) {
  const response = await fetcher(new URL('/api/building/publish', server), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ agents }),
  });
  if (!response.ok) throw new Error(`Publishing refused (HTTP ${response.status}). Check pause state or revoke and replace the publisher key.`);
}

async function main(args) {
  if (args.includes('--help') || !args.length) {
    console.log('Usage: npm run bridge -- --server https://building.example --source http://localhost:5174 --token-file /path/to/publisher.key [--once]');
    console.log('Run a separate loopback companion with T3_LOCAL_DATA=1 npm run dev -- --port 5174. Creating a key does not start sharing; explicitly running this bridge does.');
    return;
  }
  const value = (name) => { const i = args.indexOf(name); if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing ${name}.`); return args[i + 1]; };
  const { server, source } = validateEndpoints(value('--server'), args.includes('--source') ? value('--source') : 'http://localhost:5174');
  const publisherToken = (await readFile(value('--token-file'), 'utf8')).trim();
  if (!/^[\w-]{43}$/.test(publisherToken)) throw new Error('The publisher key file is invalid.');
  // Keep aliases stable across bridge restarts without disclosing the original thread ID.
  // Rotating the publisher key deliberately starts a new pseudonymous identity space.
  const salt = createHmac('sha256', publisherToken).update('t3-office character identities v1').digest();
  let stopped = false;
  const stop = () => { stopped = true; };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log('Sharing anonymous agent IDs, provider and status. No titles, prompts, paths, messages, costs or tool output are published.');
  try {
    do {
      const result = await bridgeOnce({ server, source, token: publisherToken, salt });
      console.log(result.available ? `Published ${result.count} anonymous agents.` : 'Local office unavailable; activity cleared.');
      if (args.includes('--once')) return;
      for (let i = 0; i < 10 && !stopped; i++) await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (!stopped);
  } finally {
    if (stopped) await send({ server, token: publisherToken, agents: [] }).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
