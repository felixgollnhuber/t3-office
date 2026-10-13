import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { t3Api } from './server/t3.ts';
import { t3Costs } from './server/costs.ts';

interface ProjectRef {
  owner: string;
  number: number;
}

const QUERY = `query($o: String!, $n: Int!, $after: String) {
  repositoryOwner(login: $o) {
    ... on ProjectV2Owner {
      projectV2(number: $n) {
        title
        url
        field(name: "Status") { ... on ProjectV2SingleSelectField { options { name color } } }
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            updatedAt
            status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
            content {
              __typename
              ... on Issue { number title url state repository { nameWithOwner } labels(first: 4) { nodes { name color } } assignees(first: 3) { nodes { login } } }
              ... on PullRequest { number title url state repository { nameWithOwner } labels(first: 4) { nodes { name color } } assignees(first: 3) { nodes { login } } }
              ... on DraftIssue { title }
            }
          }
        }
      }
    }
  }
}`;

const gh = (args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile('gh', args, { maxBuffer: 20 * 1024 * 1024, timeout: 20000 }, (err, out, errOut) => (err ? reject(new Error(errOut || err.message)) : resolve(out))),
  );

/** the project does not exist (or gh may not see it); the client words this itself */
class NotFound extends Error {}

async function fetchProject(ref: ProjectRef) {
  const items: unknown[] = [];
  let after: string | null = null;
  let head: { title: string; url: string; field?: { options: { name: string; color: string }[] } } | null = null;
  for (let page = 0; page < 12; page++) {
    const args = ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `o=${ref.owner}`, '-F', `n=${ref.number}`];
    if (after) args.push('-f', `after=${after}`);
    const res = JSON.parse(await gh(args));
    const p = res.data?.repositoryOwner?.projectV2;
    if (!p) throw new NotFound();
    head = p;
    items.push(...p.items.nodes);
    if (!p.items.pageInfo.hasNextPage) break;
    after = p.items.pageInfo.endCursor;
  }
  type Node = {
    id: string;
    updatedAt: string;
    status?: { name?: string } | null;
    content?: {
      __typename: string;
      number?: number;
      title: string;
      url?: string;
      state?: string;
      repository?: { nameWithOwner: string };
      labels?: { nodes: { name: string; color: string }[] };
      assignees?: { nodes: { login: string }[] };
    } | null;
  };
  const columns = (head!.field?.options ?? []).map((o) => ({ name: o.name, color: o.color }));
  return {
    id: `${ref.owner}/${ref.number}`,
    title: head!.title,
    url: head!.url,
    columns,
    items: (items as Node[])
      .filter((n) => n.content)
      .map((n) => ({
        id: n.id,
        // no status: the client names that column in its own language
        status: n.status?.name ?? '',
        title: n.content!.title,
        number: n.content!.number,
        url: n.content!.url,
        repo: n.content!.repository?.nameWithOwner,
        state: n.content!.state,
        kind: n.content!.__typename === 'PullRequest' ? 'pr' : n.content!.__typename === 'DraftIssue' ? 'draft' : 'issue',
        labels: n.content!.labels?.nodes ?? [],
        assignees: (n.content!.assignees?.nodes ?? []).map((a) => a.login),
        updatedAt: n.updatedAt,
      })),
  };
}

/** /api/board: GitHub Projects listed in office.config.json, read through the local gh CLI, cached for a minute. */
function githubBoard(): Plugin {
  let cache: { at: number; body: string } | null = null;
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/api/board', async (req, res) => {
      const force = req.url?.includes('refresh=1');
      if (!force && cache && Date.now() - cache.at < 60_000) {
        res.setHeader('content-type', 'application/json');
        res.end(cache.body);
        return;
      }
      let projects: ProjectRef[] = [];
      try {
        const cfg = JSON.parse(await readFile('office.config.json', 'utf8'));
        projects = cfg.github?.projects ?? [];
      } catch {
        // no config: the client falls back to demo notes
      }
      const out = await Promise.all(
        projects.map((p) =>
          fetchProject(p).catch((e: Error) =>
            e instanceof NotFound ? { id: `${p.owner}/${p.number}`, error: 'not-found' } : { id: `${p.owner}/${p.number}`, error: 'gh', errorDetail: e.message.trim().split('\n')[0] },
          ),
        ),
      );
      const body = JSON.stringify({ configured: projects.length > 0, fetchedAt: new Date().toISOString(), projects: out });
      cache = { at: Date.now(), body };
      res.setHeader('content-type', 'application/json');
      res.end(body);
    });
  };
  return { name: 'office-github-board', configureServer: mount, configurePreviewServer: mount };
}

/** Chrome resolves localhost to ::1 here; old 127.0.0.1 bookmarks get forwarded and then redirected by index.html. */
function ipv4Bridge(): Plugin {
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.httpServer?.once('listening', () => {
      const addr = server.httpServer!.address();
      if (!addr || typeof addr === 'string' || addr.address === '127.0.0.1') return;
      net
        .createServer((sock) => {
          const up = net.connect(addr.port, addr.address);
          sock.pipe(up).pipe(sock);
          up.on('error', () => sock.destroy());
          sock.on('error', () => up.destroy());
        })
        .on('error', () => {})
        .listen(addr.port, '127.0.0.1');
    });
  };
  return { name: 'office-ipv4-bridge', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig({
  server: { host: 'localhost', port: 5173, strictPort: true },
  // `npm start` / `npx t3-office`: the built office with the same local API; takes the next free port if 5173 is busy
  preview: { host: 'localhost', port: 5173 },
  // three.js and the whole office in one chunk is fine for a page that is served locally
  build: { chunkSizeWarningLimit: 1500 },
  plugins: [githubBoard(), ipv4Bridge(), t3Api(), t3Costs()],
});
