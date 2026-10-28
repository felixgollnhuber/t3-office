/** Repeatable browser acceptance checks with synthetic accounts and an isolated database. No private T3 reads. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const dir = await mkdtemp(join(tmpdir(), 'building-browser-'));
process.env.BUILDING_DB = join(dir, 'building.sqlite');
delete process.env.T3_LOCAL_DATA;
const server = await createServer({ server: { host: 'localhost', port: 0, strictPort: false }, logLevel: 'error' });
let browser;
const errors = [];
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-webgl'] });
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  const privateRequests = [];
  for (const page of [owner, guest]) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => { if (/\/api\/(t3|board)/.test(r.url())) privateRequests.push(r.url()); });
  }
  const register = async (page, handle, name) => {
    await page.locator('#auth-form input[name="name"]').fill(name);
    await page.locator('#auth-form input[name="handle"]').fill(handle);
    await page.locator('#auth-form input[name="password"]').fill('synthetic-test-password');
    await page.locator('#auth-form button[type="submit"]').click();
    await page.waitForSelector('#office-title');
  };
  await owner.goto(base);
  await owner.waitForSelector('#auth-form');
  await mkdir('shots', { recursive: true });
  await owner.screenshot({ path: 'shots/building-welcome.png', fullPage: true });
  await register(owner, 'alice', 'Alice');
  assert.equal(await owner.locator('#office-title').textContent(), 'Alice’s office');
  await owner.getByRole('button', { name: 'Share simulated activity', exact: true }).click();
  await owner.waitForSelector('#office-room iframe');
  await owner.frameLocator('#office-room iframe').locator('canvas#scene').waitFor();
  await owner.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.__source?.threads().length === 8);
  await owner.getByRole('button', { name: '+ Invite a friend', exact: true }).click();
  await owner.locator('#invite-form select').selectOption('activity');
  await owner.locator('#invite-form button[type="submit"]').click();
  await owner.locator('#invite-result textarea').waitFor();
  const invite = await owner.locator('#invite-result textarea').inputValue();
  await owner.getByRole('button', { name: 'Close', exact: true }).click();
  await guest.goto(invite);
  await guest.waitForSelector('#auth-form');
  assert.ok(!guest.url().includes('#invite='));
  await register(guest, 'bobby', 'Bobby');
  await guest.locator('#accept-form button[type="submit"]').click();
  await guest.waitForFunction(() => document.querySelector('#office-title')?.textContent === 'Alice’s office');
  await guest.waitForSelector('#office-room iframe');
  await guest.waitForFunction(() => document.querySelector('iframe')?.contentWindow?.__source?.threads().length === 8);
  const call = (path, method = 'GET', body) => ownerContext.request.fetch(`${base}api/building${path}`, { method, data: body, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' } });
  // Source and renderer must share thread references, including status changes after the initial snapshot.
  const first = await owner.frameLocator('iframe').locator('body').evaluate(() => window.__source.threads()[0].id);
  await owner.getByRole('button', { name: 'Manage your office', exact: true }).click();
  await owner.getByRole('button', { name: 'Stop simulation', exact: true }).click();
  await owner.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal((await call('/publish', 'POST', { agents: [{ id: first, provider: 'codex', status: 'waiting' }] })).status(), 200);
  await guest.waitForFunction((id) => {
    const w = document.querySelector('iframe')?.contentWindow;
    return w?.__source?.threads().length === 1 && w.__world?.workers.get(id)?.thread.status === 'waiting';
  }, first);
  await call('/publish', 'POST', { agents: [{ id: first, provider: 'codex', status: 'idle' }] });
  await guest.waitForFunction((id) => document.querySelector('iframe')?.contentWindow?.__world?.workers.get(id)?.thread.status === 'idle', first);
  await owner.screenshot({ path: 'shots/building-office.png', fullPage: true });
  const ownerSession = await (await call('/session')).json();
  // Pause clears even an existing iframe. Resume does not resurrect a stored snapshot.
  await call('/office', 'POST', { paused: true });
  await guest.waitForFunction(() => !document.querySelector('#office-room iframe'));
  await call('/office', 'POST', { paused: false });
  const resumed = await (await call(`/offices/${ownerSession.office.id}`)).json();
  assert.equal(resumed.agents.length, 0);
  await call('/publish', 'POST', { agents: [{ id: first, provider: 'codex', status: 'running' }] });
  await guest.waitForSelector('#office-room iframe');
  const grants = await (await call('/grants')).json();
  await call(`/grants/${grants.grants[0].id}`, 'DELETE', {});
  await guest.waitForFunction(() => document.querySelector('#office-title')?.textContent === 'Bobby’s office');
  assert.equal((await guestContext.request.get(`${base}api/building/offices/${ownerSession.office.id}`)).status(), 404);
  assert.equal((await ownerContext.request.get(`${base}api/t3/status`)).status(), 404);
  assert.equal((await ownerContext.request.get(`${base}.local/building.sqlite`)).status(), 403);
  // A delayed pre-logout directory response must not restore the previous account after sign-out.
  let held;
  let release;
  const heldReady = new Promise((resolve) => { held = resolve; });
  const allowRelease = new Promise((resolve) => { release = resolve; });
  await guest.route('**/api/building/floors', async (route) => {
    const response = await route.fetch(); held(); await allowRelease; await route.fulfill({ response });
  });
  await heldReady;
  await guest.getByRole('button', { name: 'Sign out', exact: true }).click();
  await guest.waitForSelector('#auth-form');
  release();
  await guest.unrouteAll({ behavior: 'wait' });
  assert.equal(await guest.locator('#office-title').count(), 0);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(base);
  await mobile.waitForSelector('#auth-form');
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: 'shots/building-mobile.png', fullPage: true });
  await mobile.goto(`${base}?lang=de`);
  await mobile.getByRole('button', { name: 'Büro erstellen', exact: true }).waitFor();
  assert.deepEqual(privateRequests, [], 'Shared pages must not request private local T3 APIs.');
  assert.deepEqual(errors, [], 'No browser runtime errors.');
  console.log('PASS: two-user signup/invite/3D scene/status updates/pause/revocation/logout race, private endpoint isolation, mobile layout and German UI.');
} finally {
  await browser?.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
