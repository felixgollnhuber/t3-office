#!/usr/bin/env node
/** Explicit local-only launcher: the original own-office experience plus optional friends menu. */
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const index = args.indexOf('--port');
const port = index < 0 ? 5173 : Number(args[index + 1]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Choose a port between 1 and 65535.');
process.env.T3_LOCAL_DATA = '1';
const { createServer } = await import('vite');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: 'localhost', port, strictPort: true } });
await server.listen();
console.log('Your local office is ready. Private T3 data stays local; sharing is off until you explicitly enable it in Friends & characters.');
server.printUrls();
