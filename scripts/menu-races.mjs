/** Consent and account-response races, exercised without a 3D renderer or private data. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const dir = await mkdtemp(join(tmpdir(), 'office-menu-races-'));
process.env.BUILDING_DB = join(dir, 'state.sqlite'); delete process.env.T3_LOCAL_DATA;
const harness = `<!doctype html><style>dialog{width:700px;height:700px}iframe{width:100%;height:100%;border:0}</style><div id="hud"><div class="clock"></div></div><script type="module">import {installOfficeMenu} from '/src/officemenu.ts';installOfficeMenu({threads:()=>[{id:'synthetic-agent',name:'Nova',provider:'codex',status:'running'}]},false);</script>`;
const sourceHarness = `<!doctype html><script type="module">import {SharedSource} from '/src/sharedsource.ts';window.__testsource=await SharedSource.connect(new URLSearchParams(location.search).get('floor'));</script>`;
const server = await createServer({ server: { host: 'localhost', port: 0, strictPort: false }, logLevel: 'error', plugins: [{ name: 'synthetic-menu-harness', configureServer(s) { s.middlewares.use((req, res, next) => { const kind = new URL(req.url, 'http://local').searchParams.get('harness'); if (!['1', 'source'].includes(kind)) return next(); res.setHeader('Content-Type', 'text/html'); res.end(kind === 'source' ? sourceHarness : harness); }); } }] });
let browser;
try {
  await server.listen(); const base = server.resolvedUrls.local[0]; browser = await chromium.launch();
  const context = await browser.newContext();
  const guest = await browser.newContext();
  const password = 'synthetic-test-password';
  const request = (ctx, path, body) => ctx.request.post(`${base}api/building${path}`, { data: body });
  assert.equal((await request(context, '/register', { handle: 'alice', name: 'Alice', password })).status(), 201);
  assert.equal((await request(guest, '/register', { handle: 'bobby', name: 'Bobby', password })).status(), 201);
  const stale = await context.newPage();
  let release; let captured; let finished;
  const gate = new Promise((r) => { release = r; }); const ready = new Promise((r) => { captured = r; }); const done = new Promise((r) => { finished = r; });
  let held = false;
  await stale.route('**/api/building/session', async (route) => {
    if (held) return route.continue(); held = true;
    const response = await route.fetch(); captured(); await gate; await route.fulfill({ response }); finished();
  });
  await stale.goto(`${base}?view=friends`); await ready;
  await stale.getByRole('button', { name: 'Already have an office? Sign in', exact: true }).click();
  await stale.locator('#auth-form input[name="handle"]').fill('bobby'); await stale.locator('#auth-form input[name="password"]').fill(password);
  await stale.locator('#auth-form button[type="submit"]').click(); await stale.locator('#invite-form').waitFor();
  await stale.getByRole('button', { name: 'Sign out', exact: true }).click(); await stale.locator('#auth-form').waitFor();
  release(); await done; await stale.unrouteAll({ behavior: 'wait' }); await stale.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(await stale.locator('.account').count(), 0, 'Late initial session must not restore a signed-out account'); await stale.close();
  for (const endpoint of ['session', 'office']) {
    await request(context, '/login', { handle: 'alice', password });
    const page = await context.newPage(); await page.goto(`${base}?harness=1`);
    await page.locator('#hud').getByRole('button', { name: 'Friends & characters', exact: true }).click();
    const menu = page.frameLocator('.office-friends-dialog iframe');
    await menu.locator('#invite-form').waitFor(); await menu.getByRole('button', { name: 'Sharing', exact: true }).click();
    let resume; let capture; let used = false; let published = 0;
    const gate = new Promise((r) => { resume = r; }); const ready = new Promise((r) => { capture = r; });
    page.on('request', (r) => { if (r.url().endsWith('/api/building/publish')) published++; });
    await page.route(`**/api/building/${endpoint}`, async (route) => {
      if (used || route.request().frame() !== page.mainFrame()) return route.continue();
      used = true; const response = await route.fetch(); capture(); await gate; await route.fulfill({ response });
    });
    await menu.getByRole('button', { name: 'Share this office with my invited friends', exact: true }).click(); await ready;
    await menu.getByRole('button', { name: 'Sign out', exact: true }).click(); resume();
    await menu.locator('#auth-form').waitFor(); await page.unrouteAll({ behavior: 'wait' });
    assert.equal(published, 0, `Pending ${endpoint} start must not publish after logout`);
    await request(context, '/login', { handle: 'alice', password });
    const state = await (await context.request.get(`${base}api/building/session`)).json();
    assert.equal(state.office.paused, true, `Stop must supersede delayed ${endpoint} start`);
    await page.close();
  }
  const state = await (await context.request.get(`${base}api/building/session`)).json();
  await request(context, '/office', { paused: false });
  await request(context, '/publish', { agents: [{ id: 'synthetic-agent', provider: 'codex', status: 'running' }] });
  const network = await context.newPage(); let requests = 0; const heldRoutes = [];
  await network.route(`**/api/building/offices/${state.office.id}`, (route) => {
    if (++requests > 1) { heldRoutes.push(route); return; }
    return route.continue();
  });
  await network.goto(`${base}?harness=source&floor=${state.office.id}`);
  await network.waitForFunction(() => window.__testsource?.threads().length === 1);
  await network.locator('.shared-connection-cover').waitFor({ timeout: 20_000 });
  for (const route of heldRoutes) await route.abort().catch(() => {});
  await network.unrouteAll({ behavior: 'ignoreErrors' });
  await network.waitForFunction(() => window.__testsource?.threads().length === 1 && !document.querySelector('.shared-connection-cover'), { timeout: 20_000 });
  await network.close();
  console.log('PASS: stale accounts/pending sharing cannot survive logout; stop supersedes delayed unpause; stalled snapshots are covered and recover without a renderer.');
} finally { await browser?.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }
