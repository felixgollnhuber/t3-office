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
  // Saving a room while signing out must not restore the account or navigate after logout.
  const stylePage = await context.newPage(); await stylePage.goto(`${base}?harness=1`);
  await stylePage.locator('#hud').getByRole('button', { name: 'Friends & characters', exact: true }).click();
  const styleMenu = stylePage.frameLocator('.office-friends-dialog iframe'); await styleMenu.locator('#invite-form').waitFor();
  await styleMenu.locator('#invite-form button[type="submit"]').click();
  const inviteLink = new URL(await styleMenu.locator('#invite-result textarea').inputValue());
  assert.equal(inviteLink.searchParams.has('theme'), false, 'Invite URLs must not disclose the owner theme to presence guests');
  await styleMenu.getByRole('button', { name: 'Office style', exact: true }).click();
  let releaseStyle, styleCaptured;
  const styleGate = new Promise((r) => { releaseStyle = r; }); const styleReady = new Promise((r) => { styleCaptured = r; });
  await stylePage.route('**/api/building/office', async (route) => { const response = await route.fetch(); styleCaptured(); await styleGate; await route.fulfill({ response }); });
  await styleMenu.locator('#style-form button[type="submit"]').click(); await styleReady;
  await styleMenu.getByRole('button', { name: 'Friends', exact: true }).click();
  await styleMenu.getByRole('button', { name: 'Sign out', exact: true }).click(); await styleMenu.locator('#auth-form').waitFor();
  releaseStyle(); await stylePage.unrouteAll({ behavior: 'wait' });
  await styleMenu.getByRole('button', { name: 'Sharing', exact: true }).click(); await styleMenu.locator('#auth-form').waitFor();
  assert.equal(new URL(stylePage.url()).searchParams.get('harness'), '1');
  assert.equal(await stylePage.evaluate(() => localStorage.getItem('office.appearance.v1')), null);
  await stylePage.close(); await request(context, '/login', { handle: 'alice', password });
  const leaving = await context.newPage(); await leaving.goto(`${base}?harness=1`);
  await leaving.locator('#hud').getByRole('button', { name: 'Friends & characters', exact: true }).click();
  const leavingMenu = leaving.frameLocator('.office-friends-dialog iframe'); await leavingMenu.locator('#invite-form').waitFor();
  await leavingMenu.getByRole('button', { name: 'Sharing', exact: true }).click();
  let releaseLeaving, leavingCaptured, publishedAfterLeaving = 0;
  const leavingGate = new Promise((r) => { releaseLeaving = r; }); const leavingReady = new Promise((r) => { leavingCaptured = r; });
  leaving.on('request', (r) => { if (r.url().endsWith('/api/building/publish')) publishedAfterLeaving++; });
  await leaving.route('**/api/building/office', async (route) => {
    if (route.request().frame() !== leaving.mainFrame()) return route.continue();
    const response = await route.fetch(); leavingCaptured(); await leavingGate; await route.fulfill({ response });
  });
  await leavingMenu.getByRole('button', { name: 'Share this office with my invited friends', exact: true }).click(); await leavingReady;
  await leaving.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
  releaseLeaving(); await leaving.unrouteAll({ behavior: 'wait' });
  await leaving.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal(publishedAfterLeaving, 0, 'Leaving or reloading during a pending start must not publish');
  await leaving.close();
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
  // Mutations from account A may never render secrets or restore state in account B.
  for (const kind of ['key', 'invite', 'name']) {
    await request(context, '/login', { handle: 'alice', password });
    const page = await context.newPage(); await page.goto(`${base}?view=friends`);
    await page.locator('#invite-form').waitFor();
    if (kind !== 'invite') await page.getByRole('button', { name: 'Sharing', exact: true }).click();
    let releaseMutation, capturedMutation;
    const gate = new Promise(r => { releaseMutation = r; }); const ready = new Promise(r => { capturedMutation = r; });
    const endpoint = kind === 'key' ? 'publisher-tokens' : kind === 'invite' ? 'invites' : 'office';
    await page.route(`**/api/building/${endpoint}`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); capturedMutation(); await gate; await route.fulfill({ response });
    });
    if (kind === 'key') await page.locator('[data-action="create-key"]').click();
    else await page.locator(`#${kind === 'invite' ? 'invite' : 'name'}-form button[type="submit"]`).click();
    await ready;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.locator('#auth-form').waitFor();
    await page.getByRole('button', { name: 'Already have an office? Sign in', exact: true }).click();
    await page.locator('#auth-form input[name="handle"]').fill('bobby'); await page.locator('#auth-form input[name="password"]').fill(password);
    await page.locator('#auth-form button[type="submit"]').click(); await page.locator('.account').waitFor();
    if (kind !== 'invite') await page.getByRole('button', { name: 'Sharing', exact: true }).click();
    releaseMutation(); await page.unrouteAll({ behavior: 'wait' }); await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await page.locator('#key-result textarea, #invite-result textarea').count(), 0, `Late ${kind} must not disclose the previous account secret`);
    await page.getByRole('button', { name: 'Friends', exact: true }).click();
    assert.match(await page.locator('.account').innerText(), /bobby/i, `Late ${kind} must not restore Alice`);
    await page.close();
  }
  console.log('PASS: stale accounts/style saves cannot survive logout; pagehide cancels pending publication; stop supersedes delayed unpause; stalled snapshots are covered and recover without a renderer.');
} finally { await browser?.close(); await server.close(); await rm(dir, { recursive: true, force: true }); }
