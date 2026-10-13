#!/usr/bin/env node
// Start T3 Office: build it once, then serve it together with the local read-only T3 API and open the browser.
// usage: t3-office [--port 5173] [--no-open] [--build]      (npm start passes --build)
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `T3 Office: your T3 Code threads as a pixel-art office.

usage: t3-office [options]

  --port <n>   port to listen on (default 5173, or the next free one)
  --no-open    do not open the browser
  --build      rebuild the office before starting
  -h, --help   show this help

Environment: T3_HOME, CLAUDE_CONFIG_DIR, CODEX_HOME override where T3 Code and the providers keep their data.
The pinboard reads office.config.json from the directory you start in.`;

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(HELP);
  process.exit(0);
}

// node:sqlite, which reads T3 Code's database, is available without a flag from 22.13 on
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`T3 Office needs Node.js 22.13 or newer, this is ${process.version}. Get a current one at https://nodejs.org`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : undefined;
if (port !== undefined && !(port > 0 && port < 65536)) {
  console.error('--port needs a number between 1 and 65535');
  process.exit(1);
}

const { build, preview } = await import('vite');
if (args.includes('--build') || !existsSync(join(root, 'dist', 'index.html'))) {
  console.log('Building the office …');
  await build({ root, logLevel: 'warn' });
}
const server = await preview({ root, preview: { port, open: !args.includes('--no-open') } });
console.log('\n  T3 Office is open for business.');
server.printUrls();
console.log('\n  Press Ctrl+C to close up.\n');
